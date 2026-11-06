/**
 * Settlement: the AI judges, and settlement executes the exit the jury chose.
 *
 * This module is the runtime.js side of TinySVM (the contract format for exit
 * programs is in exitprogram.js). It holds:
 *
 *   jsRuntime       the reference runtime: the jury pay rule (runtime.js
 *                   `buildDiff`), the built-in programs (escrow, bond, ledger)
 *                   and the three exit programs, in exact integer math
 *   settle          run a sealed ruling's exit program on a contract's state
 *
 * TinySVM (packages/tinysvm) implements the same runtime interface by running
 * the same programs as sBPF in LiteSVM. Neither runtime decides anything: they
 * take the ruling as given. When both run, any disagreement is a fault.
 *
 * Amounts in exit programs, bonds and the ledger are integer base units of an
 * existing token (for USDC, 1 = 0.000001 USDC). Errors are the integer codes
 * the sBPF programs return, so a rejection compares exactly like a success.
 * @module @verafyharness/core/settle
 */
import { buildDiff } from './runtime.js'
import { BELOW_BAR } from './asc.js'
import { EXIT_PROGRAMS, ENTRIES, checkParams, accountKey } from './exitprogram.js'

const U64_MAX = (1n << 64n) - 1n
const I64_MAX = (1n << 63n) - 1n

/** Error codes shared by both runtimes (programs/abi/src/lib.rs and each program). */
export const CODES = Object.freeze({
  1: 'bad input', 2: 'bad accounts', 3: 'account too small', 4: 'overflow', 5: 'does not conserve totals', 6: 'out of bounds',
  100: 'program rule refused it', 101: 'program rule refused it',
})

/* ------------------------------------------------------------------------- */
/* The reference runtime. Every function mirrors one sBPF program exactly.    */
/* ------------------------------------------------------------------------- */

const err = code => ({ ok: false, code, error: CODES[code] ?? `code ${code}` })
const big = x => BigInt(x)
const num = x => (x <= BigInt(Number.MAX_SAFE_INTEGER) && x >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(x) : x.toString())

function conserve(list) {
  return list.reduce((s, [, d]) => s + d, 0n) === 0n
}

function transfersOut(list) {
  if (list.length > 16) return err(3)
  if (!conserve(list)) return err(5)
  return { ok: true, transfers: list.map(([key, d]) => ({ key, delta: num(d) })) }
}

/** graded_payout.claim */
function gradedClaim(state, { percent, coverage, pot, beneficiary }) {
  const pct = big(percent)
  if (pct > 100n) return err(6)
  const reserve = big(state.reserve), paid = big(state.paid), claims = big(state.claims)
  const owed = big(coverage) * pct / 100n
  const pay = owed < reserve ? owed : reserve
  if (pay > I64_MAX) return err(4)
  const out = transfersOut(pay > 0n ? [[pot, -pay], [beneficiary, pay]] : [])
  if (!out.ok) return out
  if (paid + pay > U64_MAX || claims + 1n > U64_MAX) return err(4)
  return { ...out, state: { reserve: num(reserve - pay), paid: num(paid + pay), claims: num(claims + 1n) } }
}

/** ranked_split.split */
function rankedSplit(_state, { ranking, prize, shares, pot, entrants }) {
  const k = shares.length
  const n = entrants.length
  if (k === 0 || k + 1 > 16 || n > 32) return err(1)
  if (k !== ranking.length || k > n) return err(1)
  if (shares.reduce((s, x) => s + big(x), 0n) !== 1_000_000n) return err(1)
  const seen = new Set()
  for (const r of ranking) {
    if (r >= n || seen.has(r)) return err(6)
    seen.add(r)
  }
  const P = big(prize)
  if (P > I64_MAX) return err(4)
  const list = [[pot, -P]]
  let total = 0n
  for (let i = 0; i < k; i++) {
    const pay = P * big(shares[i]) / 1_000_000n
    total += pay
    list.push([entrants[ranking[i]], pay])
  }
  list[1][1] += P - total
  const out = transfersOut(list)
  return out.ok ? { ...out, state: {} } : out
}

/** milestone_escrow.release */
function milestoneRelease(state, { milestone, tranches, pot, contractor }) {
  const m = tranches.length
  if (m === 0 || m > 64) return err(1)
  if (milestone >= m) return err(6)
  const released = new Set(state.released)
  if (released.has(milestone)) return err(100)
  const t = big(tranches[milestone])
  if (t > I64_MAX) return err(4)
  const out = transfersOut([[pot, -t], [contractor, t]])
  if (!out.ok) return out
  const paid = big(state.paid) + t
  if (paid > U64_MAX) return err(4)
  return { ...out, state: { released: [...released, milestone].sort((a, b) => a - b), paid: num(paid) } }
}

const EXIT_IMPL = { graded_payout: { claim: gradedClaim }, ranked_split: { split: rankedSplit }, milestone_escrow: { release: milestoneRelease } }

/** The state an exit program starts from. */
export function initialState(program, args = {}) {
  if (program === 'graded_payout') return { reserve: args.reserve ?? 0, paid: 0, claims: 0 }
  if (program === 'milestone_escrow') return { released: [], paid: 0 }
  return {}
}

/** bond: lock, release, slash. There is no spend. */
function bondApply(state, op, amount) {
  let dep = big(state.deposited), locked = big(state.locked), slashed = big(state.slashed), released = big(state.released)
  const a = big(amount)
  if (op === 'lock') {
    dep += a; locked += a
    if (dep > U64_MAX || locked > U64_MAX) return err(4)
  } else if (op === 'release') {
    if (a > locked) return err(101)
    locked -= a; released += a
    if (released > U64_MAX) return err(4)
  } else if (op === 'slash') {
    if (a > locked) return err(100)
    locked -= a; slashed += a
    if (slashed > U64_MAX) return err(4)
  } else return err(1)
  if (locked + slashed + released !== dep) return err(5)
  return { ok: true, state: { deposited: num(dep), locked: num(locked), slashed: num(slashed), released: num(released) } }
}

/** ledger: apply a transfer list to a balance table with a fixed capacity. */
function ledgerApply(table, transfers, capacity) {
  if (table.length > capacity) return err(2)
  if (!conserve(transfers.map(t => [t.key, big(t.delta)]))) return err(5)
  const rows = table.map(r => ({ key: r.key, balance: big(r.balance) }))
  for (const t of transfers) {
    const d = big(t.delta)
    if (d === 0n) continue
    let row = rows.find(r => r.key === t.key)
    if (!row) {
      if (d < 0n) return err(100)
      if (rows.length === capacity) return err(3)
      row = { key: t.key, balance: 0n }
      rows.push(row)
    }
    const nb = row.balance + d
    if (nb < 0n) return err(100)
    if (nb > U64_MAX) return err(4)
    row.balance = nb
  }
  return { ok: true, table: rows.map(r => ({ key: r.key, balance: num(r.balance) })) }
}

/** escrow.hold and escrow.release, on `{held, released, pot}`. */
function escrowOp(state, input) {
  const held = big(state.held), released = big(state.released)
  if (input.op === 'hold') {
    if (state.pot && state.pot !== input.key) return err(101)
    if (held + big(input.amount) > U64_MAX) return err(4)
    return { ok: true, state: { held: num(held + big(input.amount)), released: state.released, pot: input.key } }
  }
  if (input.op === 'release') {
    if (input.transfers.length > 16) return err(1)
    let taken = 0n
    for (const t of input.transfers) if (big(t.delta) < 0n) { if (t.key !== state.pot) return err(101); taken += -big(t.delta) }
    if (!conserve(input.transfers.map(t => [t.key, big(t.delta)]))) return err(5)
    if (taken > held) return err(100)
    return { ok: true, state: { held: num(held - taken), released: num(released + taken), pot: state.pot } }
  }
  return err(1)
}

/**
 * The jury pay rule as integer micro-units: runtime.js `buildDiff`, with each
 * delta converted by Math.round(delta * 1e6). This is the side TinySVM's
 * `escrow` program is compared against.
 * @param {{escrow: number, split: {jurors: number, auditors: number, storage: number, sealer?: number}, counted: string[], passed: boolean, sealer: string | object, pay?: {from: string, to: string, amount: number}, id?: string, escalation?: object}} input - the ruling's pay inputs.
 * @returns {{ok: true, diff: {account: string, delta: number}[]}} the diff in micro-units.
 */
function juryMicro(input) {
  const asc = { id: input.id ?? 'contract', escalation: input.escalation, payment: { escrow: input.escrow, split: input.split } }
  const exit = { effect: input.pay ? { type: 'pay', ...input.pay } : { type: 'record' } }
  const diff = buildDiff(asc, exit, input.passed, input.counted, input.sealer)
  return { ok: true, diff: diff.map(d => ({ account: d.account, delta: Math.round(d.delta * 1e6) })) }
}

/**
 * The reference runtime. TinySVM implements the same five methods; its
 * methods return promises, these return values.
 */
export const jsRuntime = Object.freeze({
  name: 'runtime.js',
  jury: input => juryMicro(input),
  escrow: input => escrowOp(input.state, input),
  bond: ({ state, op, amount }) => bondApply(state, op, amount),
  ledger: ({ table, transfers, capacity }) => ledgerApply(table, transfers, capacity),
  exit: ({ program, entry, input, state }) => {
    const fn = EXIT_IMPL[program]?.[entry]
    if (!fn) return err(1)
    return fn(state ?? initialState(program), input)
  },
})

/**
 * The input an exit program runs on: its args, the ruling's params, and every
 * account name replaced by its ledger key. Also returns the key-to-name map.
 * @param {object} exitProgram - the exit's `exitProgram`.
 * @param {Record<string, unknown>} params - the ruling's params (already checked).
 * @returns {{program: string, entry: string, input: object, names: Map<string, string>}} the call.
 */
export function exitCall(exitProgram, params) {
  const program = EXIT_PROGRAMS[exitProgram.programHash]
  const entry = ENTRIES[program][exitProgram.entry]
  const raw = { ...(exitProgram.args ?? {}), ...(params ?? {}) }
  const names = new Map()
  const input = {}
  for (const f of entry.fields) {
    let v = raw[f]
    if (entry.accounts.includes(f)) {
      v = Array.isArray(v) ? v.map(n => { const k = accountKey(n); names.set(k, n); return k }) : (() => { const k = accountKey(v); names.set(k, v); return k })()
    }
    input[f] = v
  }
  return { program, entry: exitProgram.entry, input, names }
}

/**
 * Settle a sealed ruling: run its exit's program, if it has one, on the
 * contract's current state. A ruling below the bar never reaches a paying exit,
 * and params are bounds-checked before anything runs.
 * @param {object} asc - the contract.
 * @param {object} ruling - the sealed ruling (its `exit`, `passed` and `params`).
 * @param {{state?: object, runtime?: object}} [options] - the program's state
 *   from the last settlement (defaults to its initial state), and the runtime
 *   (defaults to jsRuntime; use packages/tinysvm for TinySVM or both).
 * @returns {object | Promise<object>} `{ok, program, transfers: [{account, delta}], state}` in base units, or `{ok: false, problems}`.
 */
export function settle(asc, ruling, { state, runtime = jsRuntime } = {}) {
  const exit = asc.exits.find(e => e.outcome === ruling.exit)
  if (!exit) return { ok: false, problems: [`exit "${ruling.exit}" is not declared by the contract`] }
  if (!exit.exitProgram) return { ok: true, program: null, transfers: [], state: state ?? null }
  if (!ruling.passed || exit.outcome === BELOW_BAR) return { ok: false, problems: ['a ruling below the bar never reaches a paying exit'] }
  const problems = checkParams(exit.exitProgram.params ?? {}, ruling.params ?? (Object.keys(exit.exitProgram.params ?? {}).length ? null : {}))
  if (problems.length) return { ok: false, problems }
  const call = exitCall(exit.exitProgram, ruling.params)
  const st = state ?? initialState(call.program, exit.exitProgram.args)
  const finish = r => r.ok
    ? { ok: true, program: call.program, transfers: r.transfers.map(t => ({ account: call.names.get(t.key) ?? t.key, delta: t.delta })), state: r.state }
    : { ok: false, program: call.program, code: r.code, problems: [`${call.program}.${call.entry} refused: ${r.error}`] }
  const r = runtime.exit({ program: call.program, entry: call.entry, input: call.input, state: st, programHash: exit.exitProgram.programHash, computeCap: exit.exitProgram.computeCap })
  return typeof r?.then === 'function' ? r.then(finish) : finish(r)
}

