/**
 * BankerService (BANK-006, 008, 009, 011): the deposit state machine.
 *
 *   detect -> classify -> hold -> quote -> simulate -> swap -> sweep -> record
 *
 * Every deposit is keyed by (chain, txid, index), so a restart or a repeated
 * report never swaps twice. Amounts are integers in each token's base units
 * (BigInt), so value is conserved to the smallest unit. Every state change is
 * appended to a hash-chained ledger and never edited.
 *
 * Execution is off by default: with `execute: false` a deposit stops at
 * SIMULATED with the quote and the simulated output recorded, and nothing is
 * signed. Turning it on needs a signer, and the kill switch stops every
 * outbound transaction at once. Service mode (converting other people's funds)
 * throws until Rex enables it after legal review.
 *
 * @module @verafyharness/banker/service
 */
import { sha256 } from '../../core/src/index.js'

export const STATES = ['DETECTED', 'UNCONFIRMED', 'QUARANTINED', 'DUST', 'FROZEN', 'HOLD', 'CONFIRMED', 'QUOTED', 'SIMULATED', 'SWAPPED', 'SWEPT', 'SKIPPED', 'NEEDS_HUMAN', 'REJECTED']
const FINAL = new Set(['QUARANTINED', 'DUST', 'FROZEN', 'SWEPT', 'SKIPPED', 'NEEDS_HUMAN', 'REJECTED'])

/** Units of a decimal string or number, as BigInt base units. */
export function toUnits(v, decimals) {
  const [i, f = ''] = String(v).split('.')
  return BigInt(i + f.padEnd(decimals, '0').slice(0, decimals))
}
/** Base units as a decimal string. */
export function fromUnits(u, decimals) {
  const s = BigInt(u).toString().padStart(decimals + 1, '0')
  return decimals ? `${s.slice(0, -decimals)}.${s.slice(-decimals)}`.replace(/\.?0+$/, '') : s
}

export const depositKey = d => `${d.chain}:${d.txid}:${d.index ?? 0}`

/** An append-only, hash-chained ledger. `sink` persists each line (a file append, for example). */
export class Ledger {
  constructor({ entries = [], sink = () => {} } = {}) {
    this.entries = []
    this.sink = sink
    for (const e of entries) this.entries.push(e)
    if (!this.verify()) throw new Error('ledger hash chain does not verify')
  }
  append(event) {
    const prev = this.entries.at(-1)?.hash ?? 'genesis'
    const body = { seq: this.entries.length, at: event.at ?? new Date().toISOString(), ...event, prev }
    const entry = { ...body, hash: sha256(body) }
    this.entries.push(entry)
    this.sink(entry)
    return entry
  }
  verify() {
    let prev = 'genesis'
    for (const [i, e] of this.entries.entries()) {
      const { hash, ...body } = e
      if (body.seq !== i || body.prev !== prev || sha256(body) !== hash) return false
      prev = hash
    }
    return true
  }
}

export class BankerService {
  /**
   * @param {object} o
   * @param {object} o.config - policy: { mode, target: {chain, token}, tokens: {[chain:address]: {symbol, decimals, minUsd}}, caps: {perTxUsd, perDayUsd, totalUsd}, maxSlippage, maxDeviation, approvalAbove, confirmations, gasReserve: {[chain]: {token, floor}} }.
   * @param {object[]} o.venues - adapters: { name, chains, quote(req), simulate(quote), swap(quote, signer) }.
   * @param {(token: object) => Promise<number|null>} o.price - an independent USD reference price per token.
   * @param {(address: string) => Promise<boolean>} [o.screen] - sanctions screen; true means a hit.
   * @param {object} [o.signer] - scoped signer; required only when `execute` is on.
   * @param {boolean} [o.execute] - send transactions. Off by default.
   * @param {Ledger} [o.ledger]
   * @param {Function} [o.now] - clock, for caps per day.
   */
  constructor({ config, venues, price, screen = null, signer = null, execute = false, ledger = new Ledger(), now = () => new Date() }) {
    if ((config.mode ?? 'own') === 'service') throw new Error('service mode (converting other people\'s funds) is disabled in code until a legal review; see docs/spec/banker.md')
    if (execute && !signer) throw new Error('execute needs a scoped signer')
    Object.assign(this, { config, venues: venues.filter(v => !config.venues || config.venues.includes(v.name)), price, screen, signer, execute, ledger, now })
    this.deposits = new Map()
    this.paused = false
    this.spentByDay = new Map()
    for (const e of ledger.entries) this.#replay(e)
  }

  #replay(e) {
    if (e.type === 'state') this.deposits.set(e.key, { ...(this.deposits.get(e.key) ?? {}), ...e.deposit, state: e.state })
    if (e.type === 'pause') this.paused = e.paused
    if (e.type === 'state' && e.state === 'SWAPPED') { const d = e.at.slice(0, 10); this.spentByDay.set(d, (this.spentByDay.get(d) ?? 0) + (e.deposit.usd ?? 0)) }
  }

  #set(key, state, extra = {}, why = '') {
    const d = { ...this.deposits.get(key), ...extra, state }
    this.deposits.set(key, d)
    const entry = this.ledger.append({ type: 'state', key, state, why, deposit: jsonSafe(d) })
    if (state === 'SWAPPED') { const day = entry.at.slice(0, 10); this.spentByDay.set(day, (this.spentByDay.get(day) ?? 0) + (d.usd ?? 0)) }
    return d
  }

  /** The kill switch. While paused, nothing outbound is quoted, simulated or sent. */
  pause(reason = 'operator') { this.paused = true; this.ledger.append({ type: 'pause', paused: true, why: reason }) }
  resume(reason = 'operator') { this.paused = false; this.ledger.append({ type: 'pause', paused: false, why: reason }) }

  token(chain, address) { return this.config.tokens?.[`${chain}:${address}`] ?? null }

  /**
   * A deposit a watcher saw. `agreed` is the light client's verdict: false
   * (sources disagree) parks it in UNCONFIRMED; it never proceeds on one source.
   * @param {{chain: string, txid: string, index?: number, token: string, amount: string|bigint, from: string, confirmations: number, agreed: boolean}} dep
   * @returns {Promise<object>} the deposit's record after processing.
   */
  async ingest(dep) {
    const key = depositKey(dep)
    const seen = this.deposits.get(key)
    if (seen && seen.state !== 'UNCONFIRMED' && seen.state !== 'HOLD' && seen.state !== 'DETECTED') return seen // idempotent
    const amount = BigInt(dep.amount)
    if (!seen) this.#set(key, 'DETECTED', { chain: dep.chain, txid: dep.txid, index: dep.index ?? 0, token: dep.token, amount, from: dep.from })
    if (!dep.agreed) return this.#set(key, 'UNCONFIRMED', {}, 'sources disagree or too few answered')
    const need = this.config.confirmations?.[dep.chain] ?? 1
    if (dep.confirmations < need) return this.#set(key, 'UNCONFIRMED', { confirmations: dep.confirmations }, `${dep.confirmations} of ${need} confirmations`)
    return this.#classify(key)
  }

  async #classify(key) {
    const d = this.deposits.get(key)
    const t = this.token(d.chain, d.token)
    if (!t) return this.#set(key, 'QUARANTINED', {}, 'token not on the allowlist by address; never touched')
    const px = await this.price({ chain: d.chain, address: d.token, ...t })
    if (!(px > 0)) return this.#set(key, 'NEEDS_HUMAN', {}, 'no reference price')
    const usd = Number(fromUnits(d.amount, t.decimals)) * px
    if (usd < (t.minUsd ?? 0)) return this.#set(key, 'DUST', { usd }, `worth about $${usd.toFixed(4)}, under the $${t.minUsd} minimum; held, no gas spent`)
    if (this.screen && await this.screen(d.from)) return this.#set(key, 'FROZEN', { usd }, 'sender matched the sanctions screen; a human decides, never auto-returned')
    const caps = this.config.caps ?? {}
    const today = this.now().toISOString().slice(0, 10)
    if (caps.perTxUsd && usd > caps.perTxUsd) return this.#set(key, 'HOLD', { usd }, `over the $${caps.perTxUsd} per-transaction cap`)
    if (caps.perDayUsd && (this.spentByDay.get(today) ?? 0) + usd > caps.perDayUsd) return this.#set(key, 'HOLD', { usd }, `over the $${caps.perDayUsd} daily cap`)
    this.#set(key, 'CONFIRMED', { usd, px })
    const target = this.config.target
    if (d.chain === target.chain && d.token === target.token) return this.#set(key, 'SKIPPED', {}, 'already the target token; swept as is')
    return this.#convert(key)
  }

  async #convert(key) {
    if (this.paused) return this.#set(key, 'HOLD', {}, 'paused by the kill switch')
    const d = this.deposits.get(key)
    const from = this.token(d.chain, d.token)
    const target = this.config.target
    const to = this.token(target.chain, target.token)
    const venues = this.venues.filter(v => v.chains.includes(d.chain) && (d.chain === target.chain || v.crossChain))
    const quotes = (await Promise.all(venues.map(async v => { try { return await v.quote({ chain: d.chain, toChain: target.chain, from: d.token, to: target.token, amount: d.amount }) } catch (err) { return { venue: v.name, error: err.message } } })))
    const good = quotes.filter(q => q && !q.error && q.out > 0n).sort((a, b) => (b.out - b.fee > a.out - a.fee ? 1 : -1))
    if (!good.length) return this.#set(key, 'NEEDS_HUMAN', { quotes: quotes.map(q => q?.error ?? 'no route') }, 'no venue quoted this pair')
    const best = good[0]
    // Price sanity: compare with the independent reference.
    const toPx = await this.price({ chain: target.chain, address: target.token, ...to })
    const fair = (Number(fromUnits(d.amount, from.decimals)) * d.px) / toPx
    const got = Number(fromUnits(best.out, to.decimals))
    const deviation = 1 - got / fair
    const maxDev = this.config.maxDeviation ?? 0.02
    if (deviation > maxDev) return this.#set(key, 'REJECTED', { quote: summarize(best), deviation }, `best quote is ${(deviation * 100).toFixed(2)}% under the reference price, over the ${maxDev * 100}% limit`)
    this.#set(key, 'QUOTED', { quote: summarize(best), deviation, venuesAsked: quotes.length })
    const sim = await venueOf(this, best).simulate(best)
    if (!sim.ok) return this.#set(key, 'NEEDS_HUMAN', { simulation: sim }, `simulation failed: ${sim.error ?? 'unknown'}; not sent`)
    const minOut = best.out - (best.out * BigInt(Math.round((this.config.maxSlippage ?? 0.01) * 10_000))) / 10_000n
    if (sim.out !== undefined && BigInt(sim.out) < minOut) return this.#set(key, 'NEEDS_HUMAN', { simulation: sim }, 'simulated output under the quote less slippage; not sent')
    this.#set(key, 'SIMULATED', { simulation: { ok: true, out: sim.out ?? null, units: sim.units ?? null } }, this.execute ? '' : 'dry run: execution is off')
    if (!this.execute) return this.deposits.get(key)
    if (this.paused) return this.#set(key, 'HOLD', {}, 'paused by the kill switch')
    if (this.config.approvalAbove && d.usd > this.config.approvalAbove) return this.#set(key, 'HOLD', {}, `over $${this.config.approvalAbove}: waits for a human signature`)
    try {
      const r = await venueOf(this, best).swap(best, this.signer)
      this.#set(key, 'SWAPPED', { swap: { txid: r.txid, out: BigInt(r.out ?? best.out) } })
      return this.#set(key, 'SWEPT', { sweep: { to: this.config.treasury ?? 'treasury' } }, 'converted funds go to the treasury')
    } catch (err) {
      return this.#set(key, 'NEEDS_HUMAN', {}, `swap failed: ${err.message}; funds stay where they are`)
    }
  }

  /** Conservation per token: every deposit is in exactly one place. */
  totals() {
    const out = {}
    for (const d of this.deposits.values()) {
      const k = `${d.chain}:${d.token}`
      out[k] ??= { in: 0n, held: 0n, converted: 0n }
      out[k].in += BigInt(d.amount)
      if (d.state === 'SWEPT' || d.state === 'SWAPPED') out[k].converted += BigInt(d.amount)
      else out[k].held += BigInt(d.amount)
    }
    return out
  }
}

function venueOf(svc, q) { return svc.venues.find(v => v.name === q.venue) }
function summarize(q) { return { venue: q.venue, out: q.out, fee: q.fee ?? 0n, route: q.route ?? null } }
function jsonSafe(o) { return JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? v.toString() : v))) }
