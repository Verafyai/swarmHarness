#!/usr/bin/env node
/**
 * Rule on a contract with a jury of harnesses, then settle the ruling on
 * Solana through the verafy_ruling program. Each harness signs its own commit
 * and reveal with its harness key.
 *
 *   node packages/solana/scripts/settle.mjs --rpc https://api.devnet.solana.com \
 *     --program <address> --payer <keypair.json> [--asc examples/market-resolution.json] [--live] [--checks] [--out file]
 *
 * Without --live the jury answers from examples/mock-answers.json (scripted,
 * no model calls). --checks also sends transactions that must fail: a reveal
 * that does not match its commitment, a commit from a key that holds no seat,
 * and a seal before every seat revealed.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { createHash, randomBytes } from 'node:crypto'
import { Harness, mockProvider, openaiProvider, ascHash, apiKeyFromEnv } from '../../core/src/index.js'
import { rpc as rpcClient, keypair, identitySigner, buildTx, createAccountIx, settleRuling, rulingCommitment, encode, rulingIx, RULING_SIZE, programError } from '../src/index.js'

const ROOT = new URL('../../../', import.meta.url).pathname
const { values: a } = parseArgs({ options: { rpc: { type: 'string', default: 'http://127.0.0.1:8899' }, program: { type: 'string' }, payer: { type: 'string' }, asc: { type: 'string', default: 'examples/market-resolution.json' }, live: { type: 'boolean' }, checks: { type: 'boolean' }, out: { type: 'string' } } })
if (!a.program || !a.payer) { console.error('need --program and --payer'); process.exit(2) }

const asc = JSON.parse(readFileSync(join(ROOT, a.asc), 'utf8'))
const config = JSON.parse(readFileSync(join(ROOT, 'verafy.config.json'), 'utf8'))
const script = JSON.parse(readFileSync(join(ROOT, 'examples/mock-answers.json'), 'utf8'))
const size = asc.payment?.jury?.size ?? 5
const pool = config.pool.slice(0, size)
const provider = a.live ? openaiProvider({ baseURL: config.provider.baseURL, apiKey: apiKeyFromEnv() }) : mockProvider(script)
const options = asc.question.answer.options
const h = ascHash(asc)

// The jury rules off chain, exactly as in `verafy run`.
const jury = pool.map(p => new Harness({ ...p, provider }))
for (const j of jury) await j.commit(asc)
const reveals = jury.map(j => j.reveal(h))
const votes = reveals.map((r, i) => {
  const answer = options.indexOf(r.vote.answer)
  if (answer < 0) throw new Error(`${r.harness} answered ${r.vote.answer}, not an option`)
  return { keypair: identitySigner(jury[i].identity), answer, reasoningHash: createHash('sha256').update(r.vote.reasoning ?? '').digest('hex'), harness: r.harness, label: r.vote.answer }
})
console.log(`jury: ${votes.map(v => `${v.harness} ${v.label}`).join(', ')}`)

const rpc = rpcClient(a.rpc)
const payer = keypair(JSON.parse(readFileSync(a.payer, 'utf8')))
const bar = Math.round((asc.payment?.bar ?? 0.8) * 1_000_000)
const summary = JSON.stringify({ asc: asc.id, ascHash: h, options, bar: asc.payment?.bar, jury: votes.map(v => v.harness) }).slice(0, 512)
const result = await settleRuling({ rpc, programId: a.program, payer, contractHash: h, votes, barPpm: bar, summary, say: s => console.log(`  ${s}`) })
const s = result.state
console.log(`ruling account ${result.ruling}: ${s.status}, answer ${options[s.answer]} with ${s.agree} of ${s.seats} (bar ${s.barPpm / 1e4}%)`)

const checks = {}
if (a.checks) {
  const expectFail = async (name, ixs, signers) => {
    try { await rpc.send(buildTx(ixs, payer, [payer, ...signers], await rpc.blockhash())); checks[name] = 'ACCEPTED (wrong)'; process.exitCode = 1 }
    catch (err) { checks[name] = programError(err)?.name ?? err.message.slice(0, 80) }
    console.log(`  must fail: ${name} -> ${checks[name]}`)
  }
  const acct = keypair()
  const lamports = await rpc.rent(RULING_SIZE)
  const v0 = votes[0]
  await rpc.send(buildTx([createAccountIx(payer, acct, lamports, RULING_SIZE, a.program), rulingIx(a.program, acct.publicKey, payer.publicKey, encode.open(h, bar, [v0.keypair.publicKey, votes[1].keypair.publicKey]))], payer, [payer, acct], await rpc.blockhash()))
  const salt = randomBytes(32)
  const stranger = keypair()
  await expectFail('commit from a key with no seat', [rulingIx(a.program, acct.publicKey, stranger.publicKey, encode.commit(0, rulingCommitment(h, 0, v0.answer, v0.reasoningHash, salt)))], [stranger])
  await expectFail('reveal before commit', [rulingIx(a.program, acct.publicKey, v0.keypair.publicKey, encode.reveal(0, v0.answer, v0.reasoningHash, salt))], [v0.keypair])
  await rpc.send(buildTx([rulingIx(a.program, acct.publicKey, v0.keypair.publicKey, encode.commit(0, rulingCommitment(h, 0, v0.answer, v0.reasoningHash, salt)))], payer, [payer, v0.keypair], await rpc.blockhash()))
  await expectFail('reveal of a different answer', [rulingIx(a.program, acct.publicKey, v0.keypair.publicKey, encode.reveal(0, (v0.answer + 1) % options.length, v0.reasoningHash, salt))], [v0.keypair])
  await expectFail('seal before every seat revealed', [rulingIx(a.program, acct.publicKey, payer.publicKey, encode.seal('early'))], [])
  await expectFail('seal by someone other than the opener', [rulingIx(a.program, acct.publicKey, stranger.publicKey, encode.seal('x'))], [stranger])
}

const record = { rpc: a.rpc, program: a.program, ruling: result.ruling, asc: asc.id, ascHash: h, state: s, signatures: result.signatures, checks, at: new Date().toISOString(), answers: a.live ? 'live' : 'scripted' }
if (a.out) writeFileSync(a.out, JSON.stringify(record, null, 2) + '\n')
