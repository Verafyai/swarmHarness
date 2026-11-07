/**
 * TinySVM for Verafy Harness: exact settlement next to the AI.
 *
 * The AI judges, and TinySVM settles. It decides nothing: it executes the exit
 * the jury chose, as sBPF programs in LiteSVM, and every node can re-run it.
 *
 * This package is optional. It drives the engine sidecar (engine/, a Rust
 * binary speaking JSON lines over stdio) and implements the same runtime
 * interface as `jsRuntime` in @verafyharness/core. `dualRuntime` runs both and
 * treats any disagreement as a fault. Nothing here is the default runtime:
 * promotion needs Rex.
 *
 * With the engine missing, `findEngine` says why and nothing else changes.
 * @module @verafyharness/tinysvm
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { canonical, CODES, escrowAccount, carryAccount, accountFor, jsRuntime } from '../../core/src/index.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const LOCK = JSON.parse(readFileSync(new URL('../programs.lock.json', import.meta.url), 'utf8'))
const BUILTIN = Object.fromEntries(Object.entries(LOCK.programs).map(([n, p]) => [n, p.sha256]))
const TRANSFERS_ACCOUNT = 4 + 16 * 40

/**
 * Where the engine and its programs are, or why they are not there.
 * `TINYSVM_ENGINE` overrides the binary path; `TINYSVM_PROGRAMS` the program directory.
 * @returns {{ok: true, engine: string, programs: string} | {ok: false, reason: string}} the result.
 */
export function findEngine() {
  const engine = process.env.TINYSVM_ENGINE ?? `${ROOT}engine/target/release/tinysvm`
  const programs = process.env.TINYSVM_PROGRAMS ?? `${ROOT}programs/target/deploy`
  if (!existsSync(engine)) return { ok: false, reason: `TinySVM engine not built (${engine} is missing; run packages/tinysvm/scripts/build.sh)` }
  const missing = Object.keys(LOCK.programs).filter(n => !existsSync(`${programs}/${n}.so`))
  if (missing.length) return { ok: false, reason: `TinySVM programs not built (${missing.join(', ')} missing from ${programs}; needs cargo-build-sbf)` }
  return { ok: true, engine, programs }
}

/** A disagreement between runtimes, or an engine failure the reference runtime would never produce. */
export class SettlementFault extends Error {
  constructor(message, detail) {
    super(message)
    this.name = 'SettlementFault'
    this.detail = detail
  }
}

/** The engine sidecar: one child process, requests matched to replies by id. */
export class Engine {
  /**
   * Start the engine and read its program list.
   * @param {{engine?: string, programs?: string}} [where] - paths; defaults to `findEngine()`.
   * @returns {Promise<Engine>} the started engine.
   */
  static async start(where = findEngine()) {
    if (!where.ok && !where.engine) throw new Error(where.reason)
    const e = new Engine(where)
    e.hello = await e.request({ op: 'hello' })
    if (!e.hello.ok) throw new Error(`TinySVM engine refused to start: ${e.hello.error?.message}`)
    for (const [n, p] of Object.entries(LOCK.programs)) {
      if (e.hello.programs[n]?.sha256 !== p.sha256) throw new Error(`TinySVM engine loaded ${n} as ${e.hello.programs[n]?.sha256}; the lock pins ${p.sha256}`)
    }
    return e
  }

  constructor({ engine, programs }) {
    this.next = 1
    this.waiting = new Map()
    this.buffer = ''
    this.child = spawn(engine, [], { env: { ...process.env, TINYSVM_PROGRAMS: programs, TINYSVM_LOCK: `${ROOT}programs.lock.json` }, stdio: ['pipe', 'pipe', 'inherit'] })
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk
      let i
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i)
        this.buffer = this.buffer.slice(i + 1)
        if (!line.trim()) continue
        const msg = JSON.parse(line)
        if (msg.fatal) { for (const w of this.waiting.values()) w.reject(new Error(`TinySVM engine: ${msg.error.message}`)); this.waiting.clear(); continue }
        const w = this.waiting.get(msg.id)
        if (w) { this.waiting.delete(msg.id); w.resolve(msg) }
      }
    })
    this.child.on('exit', code => {
      for (const w of this.waiting.values()) w.reject(new Error(`TinySVM engine exited (${code})`))
      this.waiting.clear()
    })
  }

  /**
   * Send one request.
   * @param {object} req - `{op: 'hello'}` or `{op: 'run', ...}`.
   * @returns {Promise<object>} the reply.
   */
  request(req) {
    const id = this.next++
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject })
      this.child.stdin.write(JSON.stringify({ ...req, id }) + '\n')
    })
  }

  /** Stop the engine. */
  close() {
    this.child.stdin.end()
    this.child.kill()
  }
}

/* --------------------------------------------------------------------------- */
/* Encoding. Little-endian, exactly what the programs read (programs/abi).     */
/* --------------------------------------------------------------------------- */

const U64_MAX = (1n << 64n) - 1n
const enc = {
  u8(x) { if (!(Number.isInteger(x) && x >= 0 && x <= 255)) throw new RangeError(`${x} does not fit in a u8`); return Buffer.from([x]) },
  u32(x) { if (!(Number.isInteger(x) && x >= 0 && x <= 0xffffffff)) throw new RangeError(`${x} does not fit in a u32`); const b = Buffer.alloc(4); b.writeUInt32LE(x); return b },
  u64(x) { const v = BigInt(x); if (v < 0n || v > U64_MAX) throw new RangeError(`${x} does not fit in a u64`); const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b },
  i64(x) { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(x)); return b },
  f64(x) { const b = Buffer.alloc(8); b.writeDoubleLE(x); return b },
  key(hex) { const b = Buffer.from(hex, 'hex'); if (b.length !== 32) throw new RangeError('a key is 32 bytes'); return b },
}
const num = x => (x <= BigInt(Number.MAX_SAFE_INTEGER) && x >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(x) : x.toString())
const u64s = (buf, n) => Array.from({ length: n }, (_, i) => buf.readBigUInt64LE(i * 8))

function transfersBytes(list) {
  return Buffer.concat([enc.u32(list.length), ...list.flatMap(t => [enc.key(t.key), enc.i64(t.delta)])])
}

function readTransfers(buf) {
  const n = buf.readUInt32LE(0)
  return Array.from({ length: n }, (_, i) => ({ key: buf.subarray(4 + i * 40, 36 + i * 40).toString('hex'), delta: num(buf.readBigInt64LE(36 + i * 40)) }))
}

function result(reply) {
  if (reply.ok) return reply
  if (reply.error?.custom !== undefined) return { ok: false, code: reply.error.custom, error: CODES[reply.error.custom] ?? `code ${reply.error.custom}`, computeUnits: reply.computeUnits }
  throw new SettlementFault(`TinySVM engine failed: ${reply.error?.message}`, reply)
}

/**
 * The TinySVM runtime: the same five methods as `jsRuntime`, run as sBPF.
 * Every result also carries `computeUnits`, which the comparison ignores.
 * @param {Engine} engine - a started engine.
 * @returns {object} the runtime.
 */
export function tinySvmRuntime(engine) {
  const run = (instructions, accounts, extra = {}) => engine.request({ op: 'run', accounts, instructions, ...extra }).then(result)
  const hexOf = b => b.toString('hex')
  return {
    name: 'tinysvm',
    engine,

    async jury(input) {
      const pay = input.pay?.amount ? input.pay.amount : 0
      const data = Buffer.concat([enc.u8(0), enc.f64(input.escrow), enc.f64(input.split.jurors), enc.f64(input.split.auditors), enc.f64(input.split.storage), enc.u32(input.counted.length), enc.u8(input.passed ? 1 : 0), enc.f64(pay)])
      const r = await run([{ program: BUILTIN.escrow, accounts: [{ name: 'out', writable: true }], data: hexOf(data) }], [{ name: 'out', owner: BUILTIN.escrow, data: '00'.repeat(64) }])
      if (!r.ok) return r
      const d = Array.from({ length: 8 }, (_, i) => num(Buffer.from(r.accounts.out, 'hex').readBigInt64LE(i * 8)))
      // Layout only: which account each delta belongs to, in buildDiff's order. The math ran in the program.
      const asc = { id: input.id ?? 'contract', escalation: input.escalation }
      const diff = !input.passed
        ? [{ account: escrowAccount(asc), delta: d[4] }, { account: carryAccount(asc), delta: d[5] }]
        : [
            ...input.counted.map(id => ({ account: `harness:${id}`, delta: d[0] })),
            { account: 'pool:auditors', delta: d[1] },
            { account: 'pool:storage', delta: d[2] },
            { account: accountFor(input.sealer), delta: d[3] },
            { account: escrowAccount(asc), delta: d[4] },
            ...(pay ? [{ account: input.pay.from, delta: d[6] }, { account: input.pay.to, delta: d[7] }] : []),
          ]
      return { ok: true, diff, computeUnits: r.computeUnits }
    },

    async escrow(input) {
      const st = Buffer.concat([enc.u64(input.state.held), enc.u64(input.state.released), input.state.pot ? enc.key(input.state.pot) : Buffer.alloc(32)])
      const accounts = [{ name: 'state', owner: BUILTIN.escrow, data: hexOf(st) }]
      let ix
      if (input.op === 'hold') ix = { program: BUILTIN.escrow, accounts: [{ name: 'state', writable: true }], data: hexOf(Buffer.concat([enc.u8(1), enc.key(input.key), enc.u64(input.amount)])) }
      else if (input.op === 'release') {
        accounts.push({ name: 'list', owner: 'system', data: hexOf(transfersBytes(input.transfers)) })
        ix = { program: BUILTIN.escrow, accounts: [{ name: 'state', writable: true }, { name: 'list', writable: false }], data: '02' }
      } else ix = { program: BUILTIN.escrow, accounts: [{ name: 'state', writable: true }], data: '09' }
      const r = await run([ix], accounts)
      if (!r.ok) return r
      const b = Buffer.from(r.accounts.state, 'hex')
      const [held, released] = u64s(b, 2)
      const pot = b.subarray(16, 48)
      return { ok: true, state: { held: num(held), released: num(released), pot: pot.every(x => x === 0) ? undefined : pot.toString('hex') }, computeUnits: r.computeUnits }
    },

    async bond({ state, op, amount }) {
      const tag = { lock: 0, release: 1, slash: 2 }[op] ?? 3
      const st = Buffer.concat([state.deposited, state.locked, state.slashed, state.released].map(enc.u64))
      const r = await run([{ program: BUILTIN.bond, accounts: [{ name: 'bond', writable: true }], data: hexOf(Buffer.concat([enc.u8(tag), enc.u64(amount)])) }], [{ name: 'bond', owner: BUILTIN.bond, data: hexOf(st) }])
      if (!r.ok) return r
      const [deposited, locked, slashed, released] = u64s(Buffer.from(r.accounts.bond, 'hex'), 4).map(num)
      return { ok: true, state: { deposited, locked, slashed, released }, computeUnits: r.computeUnits }
    },

    async ledger({ table, transfers, capacity }) {
      const t = Buffer.alloc(4 + capacity * 40)
      t.writeUInt32LE(table.length, 0)
      table.forEach((row, i) => { enc.key(row.key).copy(t, 4 + i * 40); t.writeBigUInt64LE(BigInt(row.balance), 36 + i * 40) })
      const r = await run([{ program: BUILTIN.ledger, accounts: [{ name: 'table', writable: true }], data: hexOf(Buffer.concat([enc.u8(0), transfersBytes(transfers)])) }], [{ name: 'table', owner: BUILTIN.ledger, data: hexOf(t) }])
      if (!r.ok) return r
      const b = Buffer.from(r.accounts.table, 'hex')
      const n = b.readUInt32LE(0)
      return { ok: true, table: Array.from({ length: n }, (_, i) => ({ key: b.subarray(4 + i * 40, 36 + i * 40).toString('hex'), balance: num(b.readBigUInt64LE(36 + i * 40)) })), computeUnits: r.computeUnits }
    },

    async exit({ program, entry, input, state, programHash, computeCap }) {
      const hash = programHash ?? BUILTIN[program]
      const extra = { allow: [hash], ...(computeCap ? { computeCap } : {}) }
      const out = { name: 'out', owner: hash, data: '00'.repeat(TRANSFERS_ACCOUNT) }
      let r
      if (program === 'graded_payout' && entry === 'claim') {
        const st = Buffer.concat([state.reserve, state.paid, state.claims].map(enc.u64))
        const data = Buffer.concat([enc.u8(0), enc.u64(input.percent), enc.u64(input.coverage), enc.key(input.pot), enc.key(input.beneficiary)])
        r = await run([{ program: hash, accounts: [{ name: 'state', writable: true }, { name: 'out', writable: true }], data: hexOf(data) }], [{ name: 'state', owner: hash, data: hexOf(st) }, out], extra)
        if (!r.ok) return r
        const [reserve, paid, claims] = u64s(Buffer.from(r.accounts.state, 'hex'), 3).map(num)
        return { ok: true, transfers: readTransfers(Buffer.from(r.accounts.out, 'hex')), state: { reserve, paid, claims }, computeUnits: r.computeUnits }
      }
      if (program === 'ranked_split' && entry === 'split') {
        const data = Buffer.concat([enc.u8(0), enc.u64(input.prize), enc.u8(input.shares.length), ...input.shares.map(enc.u32), enc.u8(input.entrants.length), ...input.ranking.map(enc.u8), enc.key(input.pot), ...input.entrants.map(enc.key)])
        r = await run([{ program: hash, accounts: [{ name: 'out', writable: true }], data: hexOf(data) }], [out], extra)
        if (!r.ok) return r
        return { ok: true, transfers: readTransfers(Buffer.from(r.accounts.out, 'hex')), state: {}, computeUnits: r.computeUnits }
      }
      if (program === 'milestone_escrow' && entry === 'release') {
        const mask = state.released.reduce((m, i) => m | (1n << BigInt(i)), 0n)
        const st = Buffer.concat([enc.u64(mask), enc.u64(state.paid)])
        const data = Buffer.concat([enc.u8(0), enc.u8(input.milestone), enc.u8(input.tranches.length), ...input.tranches.map(enc.u64), enc.key(input.pot), enc.key(input.contractor)])
        r = await run([{ program: hash, accounts: [{ name: 'state', writable: true }, { name: 'out', writable: true }], data: hexOf(data) }], [{ name: 'state', owner: hash, data: hexOf(st) }, out], extra)
        if (!r.ok) return r
        const b = Buffer.from(r.accounts.state, 'hex')
        const m = b.readBigUInt64LE(0)
        const released = Array.from({ length: 64 }, (_, i) => i).filter(i => (m >> BigInt(i)) & 1n)
        return { ok: true, transfers: readTransfers(Buffer.from(r.accounts.out, 'hex')), state: { released, paid: num(b.readBigUInt64LE(8)) }, computeUnits: r.computeUnits }
      }
      return { ok: false, code: 1, error: CODES[1] }
    },
  }
}

const strip = r => { if (!r || typeof r !== 'object') return r; const { computeUnits, ...rest } = r; return rest }

/**
 * Run two runtimes side by side. Every call goes to both; any disagreement
 * (a different diff, state, or error code) throws a SettlementFault. The
 * reference result is returned, with the other runtime's compute units.
 * @param {object} [reference] - the reference runtime (default jsRuntime).
 * @param {object} other - the runtime to check against it (TinySVM).
 * @returns {object} a runtime with the same methods, all async.
 */
export function dualRuntime(reference = jsRuntime, other) {
  const out = { name: `${reference.name}+${other.name}`, faults: 0 }
  for (const m of ['jury', 'escrow', 'bond', 'ledger', 'exit']) {
    out[m] = async input => {
      const [a, b] = await Promise.all([reference[m](input), other[m](input)])
      if (canonical(strip(a)) !== canonical(strip(b))) {
        out.faults++
        throw new SettlementFault(`${reference.name} and ${other.name} disagree on ${m}`, { method: m, input, [reference.name]: a, [other.name]: b })
      }
      return { ...a, computeUnits: b?.computeUnits }
    }
  }
  return out
}

// svmLLM: an optional third runtime for the integer programs (research track, Part H).
export { findSvmllm, SvmllmEngine, svmllmRuntime, crossRuntime } from './svmllm.js'
