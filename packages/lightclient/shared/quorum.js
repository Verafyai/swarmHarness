/**
 * Read the same thing from N independent RPC endpoints and accept it only when
 * they agree. This is the part every reader in this package shares.
 *
 * One round asks every endpoint at once. Each answer is sorted into one of four
 * verdicts:
 *
 *   agree     fresh, and in the largest group of identical answers
 *   dissent   fresh, but a different answer
 *   stale     its slot (or block) is below the floor, or too far behind the
 *             newest answer in the round; it is rejected and never counted
 *   error     no answer, an RPC error, a timeout, or the wrong chain
 *
 * Then the round is settled:
 *
 *   every endpoint agrees           agreed
 *   a strict majority agrees        a split: the policy decides. The default,
 *                                   "reject-and-retry", asks again and returns
 *                                   unknown if the split holds. "accept-majority"
 *                                   accepts and records the dissent.
 *   a stale or failed endpoint      retried; unknown if it does not recover
 *   no majority (all different)     unknown at once. Disagreement is never
 *                                   resolved by guessing.
 *
 * Every result records its sources (id, operator, origin host, slot, verdict)
 * and the commitment level it was read at. Sources never carry a URL path,
 * query string or header, so no key can reach a result or a log.
 *
 * @module @verafyharness/lightclient/shared/quorum
 */
import { createHash } from 'node:crypto'

export const POLICIES = ['reject-and-retry', 'accept-majority']

/** Canonical JSON: sorted keys at every level, BigInt as a decimal string. */
export function canonical(v) {
  if (typeof v === 'bigint') return JSON.stringify(v.toString())
  if (v === undefined) return 'null'
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  return `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
}

/** SHA-256 hex of a value's canonical JSON. */
export function valueHash(v) {
  return createHash('sha256').update(canonical(v)).digest('hex')
}

/**
 * Strip anything that could carry a key out of an error message: URLs, query
 * strings and long opaque runs.
 * @param {unknown} e - an error or message.
 * @returns {string} a message safe to record.
 */
export function safeError(e) {
  const m = String(e?.message ?? e ?? 'error')
  return m.replace(/https?:\/\/\S+/g, '<url>').replace(/[?&][\w-]*(key|token|secret)[\w-]*=\S+/gi, '<redacted>').replace(/\b[A-Za-z0-9_-]{40,}\b/g, '<redacted>').slice(0, 200)
}

const KEY_FIELDS = ['key', 'apiKey', 'api_key', 'token', 'secretValue', 'password', 'authorization']
const KEYISH_QUERY = /[?&][\w-]*(key|token|secret|auth)[\w-]*=/i

/**
 * Check an endpoint list before any read. Endpoints name an API plugged into
 * the API router; a key, if one is needed, is a keyblock secret (`secret`) or
 * an environment reference (`secretEnv`) on that API entry, never a value.
 * @param {{id: string, operator: string, api: string}[]} endpoints - the endpoints.
 * @param {{n?: number, minOperators?: number, apis?: Map<string, object>}} [options] -
 *   how many endpoints to read (default 3), how many distinct operators they must
 *   span (default 2), and the router's API entries, to check their base URLs.
 * @returns {object[]} the first `n` endpoints.
 */
export function checkEndpoints(endpoints, { n = 3, minOperators = 2, apis } = {}) {
  if (!Array.isArray(endpoints)) throw new Error('lightclient: endpoints must be a list')
  if (!(Number.isInteger(n) && n >= 1)) throw new Error('lightclient: n must be a positive integer')
  if (endpoints.length < n) throw new Error(`lightclient: ${n} endpoints are required, ${endpoints.length} configured`)
  const chosen = endpoints.slice(0, n)
  const ids = new Set()
  for (const e of chosen) {
    if (!e?.id || !e?.operator || !e?.api) throw new Error('lightclient: every endpoint needs id, operator and api (an API router entry)')
    if (ids.has(e.id)) throw new Error(`lightclient: endpoint id "${e.id}" appears twice`)
    ids.add(e.id)
    for (const f of KEY_FIELDS) if (e[f] !== undefined) throw new Error(`lightclient: endpoint "${e.id}" holds a raw "${f}"; put the key in the keyblock (secret) or an environment reference (secretEnv) on its API entry`)
    const api = apis?.get?.(e.api)
    if (apis && !api) throw new Error(`lightclient: endpoint "${e.id}" names API "${e.api}", which is not plugged into the router`)
    if (api) {
      for (const f of KEY_FIELDS) if (api[f] !== undefined) throw new Error(`lightclient: API "${e.api}" holds a raw "${f}"; use secret or secretEnv`)
      if (KEYISH_QUERY.test(api.baseURL ?? '')) throw new Error(`lightclient: API "${e.api}" has a key in its URL; use secret or secretEnv with auth "query:<param>"`)
    }
  }
  const ops = new Set(chosen.map(e => e.operator))
  if (ops.size < minOperators) throw new Error(`lightclient: the ${n} endpoints span ${ops.size} operator(s); at least ${minOperators} are required`)
  return chosen
}

/** The host of a URL, for labeling a source. Never the path or query. */
export function originOf(url) {
  try { return new URL(url).host } catch { return 'unknown' }
}

function withTimeout(p, ms) {
  let t
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms) })]).finally(() => clearTimeout(t))
}

const wait = ms => new Promise(r => setTimeout(r, ms))

/**
 * One round across every endpoint.
 * @returns {{sources: object[], groups: Map<string, object[]>, top: number | null}} the sorted answers.
 */
async function round(endpoints, readOne, { minSlot, maxLag, timeoutMs, describe }) {
  const answers = await Promise.allSettled(endpoints.map(e => withTimeout(Promise.resolve().then(() => readOne(e)), timeoutMs)))
  const sources = endpoints.map((e, i) => {
    const a = answers[i]
    const base = { id: e.id, operator: e.operator, origin: describe(e) }
    if (a.status === 'rejected') return { ...base, slot: null, verdict: 'error', error: safeError(a.reason) }
    const slot = Number(a.value.slot)
    if (!Number.isFinite(slot)) return { ...base, slot: null, verdict: 'error', error: 'answer carried no slot' }
    return { ...base, slot, value: a.value.value, valueHash: valueHash(a.value.value) }
  })
  const answered = sources.filter(s => s.verdict !== 'error')
  const top = answered.length ? Math.max(...answered.map(s => s.slot)) : null
  for (const s of answered) {
    if (minSlot !== undefined && s.slot < minSlot) { s.verdict = 'stale'; s.error = `slot ${s.slot} is below the floor ${minSlot}` }
    else if (maxLag !== undefined && top - s.slot > maxLag) { s.verdict = 'stale'; s.error = `slot ${s.slot} is ${top - s.slot} behind the newest answer ${top}; the limit is ${maxLag}` }
  }
  const groups = new Map()
  for (const s of sources) {
    if (s.verdict) continue
    if (!groups.has(s.valueHash)) groups.set(s.valueHash, [])
    groups.get(s.valueHash).push(s)
  }
  return { sources, groups, top }
}

/**
 * Read across endpoints and settle on one answer or on unknown.
 * @param {object[]} endpoints - from `checkEndpoints`.
 * @param {(endpoint: object) => Promise<{value: unknown, slot: number}>} readOne - one endpoint's answer.
 * @param {{chain: string, commitment: string, method: string, policy?: string, retries?: number, retryDelayMs?: number,
 *   timeoutMs?: number, minSlot?: number, maxLag?: number, minOperators?: number, describe?: (e: object) => string}} options
 * @returns {Promise<object>} `{status: 'agreed' | 'unknown', value, slot, chain, commitment, method, policy, attempts, reason, sources, at}`.
 */
export async function readAcross(endpoints, readOne, options) {
  const { chain, commitment, method, policy = 'reject-and-retry', retries = 2, retryDelayMs = 500, timeoutMs = 10000, minSlot, maxLag, minOperators = 2, describe = e => e.origin ?? 'unknown' } = options
  if (!POLICIES.includes(policy)) throw new Error(`lightclient: policy must be one of ${POLICIES.join(', ')}`)
  const n = endpoints.length
  let last
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const r = await round(endpoints, readOne, { minSlot, maxLag, timeoutMs, describe })
    const ranked = [...r.groups.values()].sort((a, b) => b.length - a.length)
    const best = ranked[0] ?? []
    const majority = best.length > n / 2 && (ranked[1]?.length ?? 0) < best.length
    for (const s of r.sources) if (!s.verdict) s.verdict = best.includes(s) ? 'agree' : 'dissent'
    const label = { chain, commitment, method, policy, attempts: attempt, top: r.top, at: new Date().toISOString() }
    const clean = r.sources.map(({ value, ...s }) => s)
    const done = (status, reason) => ({
      status, reason,
      value: status === 'agreed' ? best[0].value : null,
      slot: status === 'agreed' ? Math.min(...best.map(s => s.slot)) : null,
      ...label, sources: clean,
    })
    if (best.length === n) return done('agreed', `all ${n} endpoints agree`)
    const stale = r.sources.filter(s => s.verdict === 'stale').length
    const errors = r.sources.filter(s => s.verdict === 'error').length
    const dissent = r.sources.filter(s => s.verdict === 'dissent').length
    if (ranked.length > 1 && !majority) return done('unknown', `no majority: ${ranked.length} different answers from ${n} endpoints`)
    if (ranked.length === 0) {
      last = done('unknown', `no usable answer: ${stale} stale, ${errors} failed, of ${n}`)
    } else if (majority) {
      const ops = new Set(best.map(s => s.operator)).size
      const split = `${best.length} of ${n} agree (${dissent} dissent, ${stale} stale, ${errors} failed)`
      if (policy === 'accept-majority' && ops >= minOperators) return done('agreed', `${split}; accepted by policy accept-majority`)
      last = done('unknown', policy === 'accept-majority'
        ? `${split}; the majority spans ${ops} operator(s), fewer than ${minOperators}`
        : `${split}; policy reject-and-retry needs all ${n}, not met after ${attempt} attempt(s)`)
    } else {
      last = done('unknown', `only ${best.length} of ${n} answered alike (${stale} stale, ${errors} failed)`)
    }
    if (attempt <= retries && retryDelayMs > 0) await wait(retryDelayMs)
  }
  return last
}
