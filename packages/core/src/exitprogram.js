/**
 * Exit programs in the contract format: the optional `exitProgram` an exit may
 * declare, `{programHash, entry, params, args}`, its params schema, and the
 * validator that bounds a ruling's params before any runtime executes.
 *
 *   programHash  SHA-256 of the sBPF program (packages/tinysvm/programs.lock.json)
 *   entry        the program's entry point
 *   params       what the jury supplies, each with bounds: an integer grade or
 *                percentage {type: "integer", min, max}, or a ranking
 *                {type: "ranking", size, of}
 *   args         everything else the entry takes, fixed when the contract is
 *                written: amounts in base units, account names
 *   computeCap   optional compute cap for the exit, in compute units
 *
 * The field is optional. A contract without it validates, hashes and rules
 * exactly as before.
 * @module @verafyharness/core/exitprogram
 */
import { createHash } from 'node:crypto'

const BELOW_BAR = '*below-bar'

/**
 * The exit programs a contract may declare, by the SHA-256 of their sBPF
 * binary (packages/tinysvm/programs.lock.json). A test keeps this table and
 * the lock file equal.
 */
export const EXIT_PROGRAMS = Object.freeze({
  e449115b16b47e34cf0aec4250458108edab11f09b9861217d348eab4c51f0e4: 'graded_payout',
  '0f31de8218bb47ab22e550b2fa6ff182f5489067f9b51d4cf5f8bbc89dd3968f': 'ranked_split',
  ea7421526e5170539cd9b73e28fa92a2a21e0cb29dc819d87a8d4fc131031fc2: 'milestone_escrow',
})

/** The hash of each exit program, by name. */
export const PROGRAM_HASHES = Object.freeze(Object.fromEntries(Object.entries(EXIT_PROGRAMS).map(([h, n]) => [n, h])))

/**
 * Each exit program's entry: the fields it takes, which of them a ruling may
 * supply as params (and of which type), and which are accounts.
 */
export const ENTRIES = Object.freeze({
  graded_payout: { claim: { fields: ['percent', 'coverage', 'pot', 'beneficiary'], optional: ['reserve'], params: { percent: 'integer' }, accounts: ['pot', 'beneficiary'], state: true } },
  ranked_split: { split: { fields: ['ranking', 'prize', 'shares', 'pot', 'entrants'], params: { ranking: 'ranking' }, accounts: ['pot', 'entrants'], state: false } },
  milestone_escrow: { release: { fields: ['milestone', 'tranches', 'pot', 'contractor'], params: { milestone: 'integer' }, accounts: ['pot', 'contractor'], state: true } },
})

const HEX64 = /^[0-9a-f]{64}$/

/** What each field holds. Amounts are whole base units, below 2^53 so JSON carries them exactly. */
const FIELD_TYPES = {
  percent: 'uint', coverage: 'uint', reserve: 'uint', prize: 'uint', milestone: 'uint',
  shares: 'uint[]', tranches: 'uint[]', ranking: 'uint[]',
  pot: 'account', beneficiary: 'account', contractor: 'account', entrants: 'account[]',
}
const uint = x => Number.isSafeInteger(x) && x >= 0
const isAccount = x => typeof x === 'string' && x.length > 0
const fits = (type, v) => type === 'uint' ? uint(v)
  : type === 'uint[]' ? Array.isArray(v) && v.length > 0 && v.every(uint)
  : type === 'account' ? isAccount(v)
  : Array.isArray(v) && v.length > 0 && v.every(isAccount)

/**
 * The ledger key for an account name: SHA-256 of the name, as both runtimes use it.
 * @param {string} name - an account such as `pot:insurance` or `wallet:alice`.
 * @returns {string} 64 hex characters.
 */
export function accountKey(name) {
  return createHash('sha256').update(String(name), 'utf8').digest('hex')
}

/**
 * Check one exit's `exitProgram`: a declared program, a known entry, a params
 * schema that only names the entry's param fields, and args that supply every
 * other field.
 * @param {object} exit - a contract exit.
 * @param {number} i - its index, for messages.
 * @returns {string[]} problems; empty when valid or absent.
 */
export function validateExitProgram(exit, i) {
  const ep = exit?.exitProgram
  if (ep === undefined) return []
  const at = `exits[${i}].exitProgram`
  const p = []
  if (exit.outcome === BELOW_BAR) p.push(`${at}: a ruling below the bar never reaches a paying exit, so "${BELOW_BAR}" cannot declare an exit program`)
  if (!HEX64.test(ep?.programHash ?? '')) { p.push(`${at}.programHash must be a SHA-256 hex digest`); return p }
  const name = EXIT_PROGRAMS[ep.programHash]
  if (!name) { p.push(`${at}.programHash is not a known exit program`); return p }
  const entry = ENTRIES[name][ep.entry]
  if (!entry) { p.push(`${at}.entry must be one of ${Object.keys(ENTRIES[name]).join(', ')} for ${name}`); return p }
  const params = ep.params ?? {}
  const args = ep.args ?? {}
  if (typeof params !== 'object' || Array.isArray(params)) p.push(`${at}.params must be an object`)
  if (typeof args !== 'object' || Array.isArray(args)) p.push(`${at}.args must be an object`)
  for (const [k, s] of Object.entries(params)) {
    if (!(k in entry.params)) { p.push(`${at}.params.${k} is not a parameter of ${name}.${ep.entry}`); continue }
    if (s?.type !== entry.params[k]) { p.push(`${at}.params.${k}.type must be "${entry.params[k]}"`); continue }
    if (s.type === 'integer' && !(Number.isSafeInteger(s.min) && Number.isSafeInteger(s.max) && s.min >= 0 && s.min <= s.max)) p.push(`${at}.params.${k} needs integer bounds 0 <= min <= max`)
    if (s.type === 'ranking' && !(Number.isSafeInteger(s.size) && s.size >= 1)) p.push(`${at}.params.${k}.size must be a positive integer`)
  }
  for (const f of entry.fields) {
    const inParams = f in params
    const inArgs = f in args
    if (inParams && inArgs) p.push(`${at}: ${f} is both a param and an arg`)
    if (!inParams && !inArgs) p.push(`${at}: ${f} must be given in params or args`)
  }
  for (const k of Object.keys(args)) if (!entry.fields.includes(k) && !(entry.optional ?? []).includes(k)) p.push(`${at}.args.${k} is not a field of ${name}.${ep.entry}`)
  if (name === 'graded_payout' && args.reserve !== undefined && !(Number.isSafeInteger(args.reserve) && args.reserve >= 0)) p.push(`${at}.args.reserve must be a whole number of base units`)
  for (const [k, v] of Object.entries(args)) if (FIELD_TYPES[k] && !fits(FIELD_TYPES[k], v)) p.push(`${at}.args.${k} must be ${{ uint: 'a whole number', 'uint[]': 'a list of whole numbers', account: 'an account name', 'account[]': 'a list of account names' }[FIELD_TYPES[k]]}`)
  if (ep.computeCap !== undefined && !(Number.isSafeInteger(ep.computeCap) && ep.computeCap >= 1 && ep.computeCap <= 1_400_000)) p.push(`${at}.computeCap must be an integer from 1 to 1400000`)
  return p
}

/**
 * Every structured parameter the contract's exits ask the jury for, by name.
 * @param {object} asc - the contract.
 * @returns {Record<string, object>} the merged params schema; empty for a contract with no exit programs.
 */
export function paramsSchema(asc) {
  const out = {}
  for (const e of asc?.exits ?? []) for (const [k, s] of Object.entries(e.exitProgram?.params ?? {})) out[k] ??= s
  return out
}

/**
 * Check structured params against a params schema. This runs before any
 * runtime executes: an out-of-range grade is rejected here.
 * @param {Record<string, object>} schema - the params schema.
 * @param {Record<string, unknown> | null | undefined} params - the ruling's params.
 * @returns {string[]} problems; empty when every param is present and in bounds.
 */
export function checkParams(schema, params) {
  const p = []
  if (params === null || typeof params !== 'object' || Array.isArray(params)) return Object.keys(schema).length ? ['params are missing'] : []
  for (const k of Object.keys(params)) if (!(k in schema)) p.push(`params.${k} is not declared by the contract`)
  for (const [k, s] of Object.entries(schema)) {
    const v = params[k]
    if (v === undefined) { p.push(`params.${k} is missing`); continue }
    if (s.type === 'integer') {
      if (!Number.isSafeInteger(v)) p.push(`params.${k} must be an integer`)
      else if (v < s.min || v > s.max) p.push(`params.${k} is ${v}, outside [${s.min}, ${s.max}]`)
    } else if (s.type === 'ranking') {
      const of = s.of
      if (!Array.isArray(v) || v.length !== s.size) p.push(`params.${k} must rank exactly ${s.size}`)
      else if (!v.every(x => Number.isSafeInteger(x) && x >= 0 && (of === undefined || x < of))) p.push(`params.${k} must hold entrant indexes${of === undefined ? '' : ` below ${of}`}`)
      else if (new Set(v).size !== v.length) p.push(`params.${k} ranks an entrant twice`)
    }
  }
  return p
}

/**
 * The params a ruling carries: one value per declared param, from the counted
 * votes that chose the winning answer. Integers take the lower median; a
 * ranking takes the one most of those votes gave (ties go to the
 * lexicographically smallest). Votes without params do not count. Returns null
 * when no vote supplied a param.
 * @param {Record<string, object>} schema - the params schema.
 * @param {{answer: unknown, params?: object}[]} votes - the counted votes.
 * @param {unknown} answer - the winning answer.
 * @returns {Record<string, unknown> | null} the params.
 */
export function aggregateParams(schema, votes, answer) {
  const keys = Object.keys(schema)
  if (!keys.length) return null
  const out = {}
  for (const k of keys) {
    const vals = votes.filter(v => v.answer === answer && v.params && v.params[k] !== undefined).map(v => v.params[k])
    if (!vals.length) return null
    if (schema[k].type === 'integer') {
      const xs = vals.filter(Number.isSafeInteger).sort((a, b) => a - b)
      if (!xs.length) return null
      out[k] = xs[Math.floor((xs.length - 1) / 2)]
    } else {
      const tally = new Map()
      for (const r of vals) { const s = JSON.stringify(r); tally.set(s, (tally.get(s) ?? 0) + 1) }
      const [best] = [...tally.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]
      out[k] = JSON.parse(best)
    }
  }
  return out
}

