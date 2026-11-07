/**
 * The verafy_ruling program's client: instruction encoders, the commitment a
 * juror makes, the account layout reader, and `settleRuling`, which carries a
 * harness ruling (contract hash, jury, revealed votes) onto Solana.
 *
 * The program checks commit before reveal, every reveal against its
 * commitment, and agreement against the bar. It runs no model. Its vote is an
 * answer index into the contract's options.
 *
 * @module @verafyharness/solana/ruling
 */
import { createHash, randomBytes } from 'node:crypto'
import { b58decode, b58encode, buildTx, createAccountIx, keypair } from './tx.js'

export const RULING_SIZE = 80 + 8 * 104 + 2 + 512
export const STATUS = ['empty', 'open', 'sealed', 'below-bar']
export const ERRORS = { 1: 'bad input', 2: 'bad accounts', 3: 'small account', 6: 'out of bounds', 100: 'wrong state', 101: 'not authorized', 102: 'bad reveal', 103: 'out of order', 104: 'not all revealed' }

const k32 = v => (typeof v === 'string' ? (/^[0-9a-f]{64}$/i.test(v) ? Buffer.from(v, 'hex') : Buffer.from(b58decode(v))) : Buffer.from(v))

/** sha256(contract || index || answer || reasoning || salt), as the program computes it. */
export function rulingCommitment(contractHash, index, answer, reasoningHash, salt) {
  return createHash('sha256').update(k32(contractHash)).update(Buffer.from([index, answer])).update(k32(reasoningHash)).update(k32(salt)).digest()
}

const ix = (programId, ruling, signer, data) => ({ programId: k32(programId), keys: [{ pubkey: ruling, isSigner: false, isWritable: true }, { pubkey: signer, isSigner: true, isWritable: false }], data: Uint8Array.from(data) })

export const encode = {
  open: (contractHash, barPpm, jurors) => { const d = Buffer.alloc(1 + 32 + 4 + 1 + 32 * jurors.length); d[0] = 0; k32(contractHash).copy(d, 1); d.writeUInt32LE(barPpm, 33); d[37] = jurors.length; jurors.forEach((j, i) => k32(j).copy(d, 38 + 32 * i)); return d },
  commit: (index, commitment) => Buffer.concat([Buffer.from([1, index]), k32(commitment)]),
  reveal: (index, answer, reasoningHash, salt) => Buffer.concat([Buffer.from([2, index, answer]), k32(reasoningHash), k32(salt)]),
  seal: summary => { const s = Buffer.from(summary, 'utf8'); if (s.length > 512) throw new Error('summary is over 512 bytes'); const d = Buffer.alloc(3 + s.length); d[0] = 3; d.writeUInt16LE(s.length, 1); s.copy(d, 3); return d },
}

/** Read a ruling account. */
export function decodeRuling(data) {
  const b = Buffer.from(data)
  if (b.subarray(0, 8).toString('latin1') !== 'VRFYRUL1') return { status: STATUS[b[8]] ?? 'unknown' }
  const n = b[9]
  const jurors = []
  for (let i = 0; i < n; i++) {
    const at = 80 + 104 * i
    jurors.push({ key: b58encode(b.subarray(at, at + 32)), commitment: b.subarray(at + 32, at + 64).toString('hex'), reasoningHash: b.subarray(at + 64, at + 96).toString('hex'), answer: b[at + 96], state: ['seated', 'committed', 'revealed'][b[at + 97]] })
  }
  const len = b.readUInt16LE(912)
  return { status: STATUS[b[8]], seats: n, answer: b[10], agree: b[11], barPpm: b.readUInt32LE(12), contractHash: b.subarray(16, 48).toString('hex'), opener: b58encode(b.subarray(48, 80)), jurors, summary: b.subarray(914, 914 + len).toString('utf8') }
}

/** The program's error code, from a failed transaction or a preflight error. */
export function programError(err) {
  const c = err?.err?.InstructionError?.[1]?.Custom ?? err?.data?.err?.InstructionError?.[1]?.Custom
  return c === undefined ? null : { code: c, name: ERRORS[c] ?? 'unknown' }
}

/**
 * Settle one ruling on Solana: create the ruling account, open it, commit and
 * reveal each juror's vote, and seal it.
 * @param {object} o
 * @param {ReturnType<import('./tx.js').rpc>} o.rpc - RPC client.
 * @param {string} o.programId - the deployed verafy_ruling address.
 * @param {object} o.payer - keypair that pays rent and fees and opens the ruling.
 * @param {string} o.contractHash - the contract's hash (hex).
 * @param {{keypair: object, answer: number, reasoningHash: string}[]} o.votes - one per seat.
 * @param {number} [o.barPpm] - agreement bar in parts per million.
 * @param {string} [o.summary] - up to 512 bytes, stored on the account.
 * @param {Function} [o.say] - progress sink.
 * @returns {Promise<{ruling: string, signatures: Record<string,string>, state: object}>}
 */
export async function settleRuling({ rpc, programId, payer, contractHash, votes, barPpm = 800_000, summary = '', say = () => {} }) {
  const account = keypair()
  const signatures = {}
  const send = async (name, ixs, signers) => { signatures[name] = await rpc.send(buildTx(ixs, payer, [payer, ...signers], await rpc.blockhash())); say(`${name}: ${signatures[name]}`) }
  const lamports = await rpc.rent(RULING_SIZE)
  const jurors = votes.map(v => v.keypair.publicKey)
  await send('open', [createAccountIx(payer, account, lamports, RULING_SIZE, k32(programId)), ix(programId, account.publicKey, payer.publicKey, encode.open(contractHash, barPpm, jurors))], [account])
  const salts = votes.map(() => randomBytes(32))
  for (let i = 0; i < votes.length; i++) {
    const c = rulingCommitment(contractHash, i, votes[i].answer, votes[i].reasoningHash, salts[i])
    await send(`commit ${i}`, [ix(programId, account.publicKey, votes[i].keypair.publicKey, encode.commit(i, c))], [votes[i].keypair])
  }
  for (let i = 0; i < votes.length; i++) {
    await send(`reveal ${i}`, [ix(programId, account.publicKey, votes[i].keypair.publicKey, encode.reveal(i, votes[i].answer, votes[i].reasoningHash, salts[i]))], [votes[i].keypair])
  }
  await send('seal', [ix(programId, account.publicKey, payer.publicKey, encode.seal(summary))], [])
  const state = decodeRuling((await rpc.account(account.address)).data)
  return { ruling: account.address, signatures, state }
}

export { ix as rulingIx }
