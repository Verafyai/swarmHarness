/**
 * The banker: the routing agent's exchange module. It accepts any digital
 * token the operator allows, swaps one token for another across approved
 * venues at the best quote within a slippage limit, and funds payments to
 * external routers and suppliers (an AI API router, a GPU host) in whatever
 * token they take, converting from what the wallet holds when it has to.
 *
 * Venues are adapters with one interface:
 *   name                      the venue id the operator approves
 *   quote({from, to, amount}) -> {out, fee} or null when the pair is not served
 *   swap(quote)               -> {out} executes a quote
 *
 * Built in: `fixedRateVenue`, for devnet, testnet and tests. Planned adapters:
 * DEX aggregators on Solana and EVM chains, and cross-chain bridges.
 *
 * @module @verafyharness/core/banker
 */

/**
 * A venue that swaps at fixed rates. For devnet, testnet and tests only.
 * @param {{name: string, rates: Record<string, number>, feeRate?: number}} options - rates keyed "FROM/TO", such as "SOL/USDC": 150.
 * @returns {{name: string, quote: Function, swap: Function}} the venue.
 */
export function fixedRateVenue({ name, rates, feeRate = 0 }) {
  return {
    name,
    quote({ from, to, amount }) {
      const r = rates[`${from}/${to}`] ?? (rates[`${to}/${from}`] ? 1 / rates[`${to}/${from}`] : null)
      if (!r) return null
      const gross = amount * r
      const fee = gross * feeRate
      return { venue: name, from, to, amountIn: amount, out: gross - fee, fee, rate: r }
    },
    swap(q) {
      return { out: q.out }
    },
  }
}

export class Banker {
  /**
   * @param {{wallet: import('./routing.js').PaymentWallet, venues: object[], approved?: string[], accept?: {chain: string, asset: string}[], maxSlippage?: number, prefer?: string[], reference?: Record<string, number>}} options -
   *   `approved` lists venue names the operator allows; `accept` lists tokens taken as payment (`*` matches any);
   *   `prefer` orders which held tokens to sell first; `reference` gives a reference price per token in a common unit, used to measure slippage.
   */
  constructor({ wallet, venues, approved, accept = [{ chain: '*', asset: '*' }], maxSlippage = 0.01, prefer = [], reference = {} }) {
    this.wallet = wallet
    this.venues = venues.filter(v => !approved || approved.includes(v.name))
    this.accept = accept
    this.maxSlippage = maxSlippage
    this.prefer = prefer
    this.reference = reference
    this.log = []
  }

  /**
   * Whether a token is accepted as payment.
   * @param {string} chain - the chain it arrives on.
   * @param {string} asset - the token.
   * @returns {boolean} true when the accept list allows it.
   */
  accepts(chain, asset) {
    return this.accept.some(a => (a.chain === '*' || a.chain === chain) && (a.asset === '*' || a.asset === asset))
  }

  /**
   * Take a payment into the wallet.
   * @param {{chain: string, asset: string, amount: number, source: string}} payment - what arrived and from where.
   */
  receive({ chain, asset, amount, source }) {
    if (!this.accepts(chain, asset)) throw new Error(`banker does not accept ${asset} on ${chain}`)
    this.wallet.receive(asset, amount, source)
    this.log.push({ type: 'receive', chain, asset, amount, source })
  }

  /**
   * The best quote across approved venues, checked against the slippage limit
   * when reference prices are known.
   * @param {string} from - token to sell.
   * @param {string} to - token to buy.
   * @param {number} amount - how much to sell.
   * @returns {object} the best quote.
   */
  quote(from, to, amount) {
    const quotes = this.venues.map(v => v.quote({ from, to, amount })).filter(Boolean).sort((a, b) => b.out - a.out)
    if (!quotes.length) throw new Error(`no approved venue quotes ${from} to ${to}`)
    const best = quotes[0]
    const rf = this.reference[from]
    const rt = this.reference[to]
    if (rf && rt) {
      const fair = (amount * rf) / rt
      best.slippage = Math.max(0, 1 - best.out / fair)
      if (best.slippage > this.maxSlippage) throw new Error(`best quote for ${from} to ${to} is ${(best.slippage * 100).toFixed(2)}% from the reference price, over the ${this.maxSlippage * 100}% limit`)
    }
    return best
  }

  /**
   * Swap tokens held in the wallet. Never sells into the bond reserve.
   * @param {string} from - token to sell.
   * @param {string} to - token to buy.
   * @param {number} amount - how much to sell.
   * @returns {object} the executed swap.
   */
  swap(from, to, amount) {
    const free = (this.wallet.balances[from] ?? 0) - (this.wallet.bondReserve[from] ?? 0)
    if (amount > free + 1e-12) throw new Error(`not enough ${from} above the bond reserve to swap ${amount}`)
    const q = this.quote(from, to, amount)
    const venue = this.venues.find(v => v.name === q.venue)
    const { out } = venue.swap(q)
    this.wallet.balances[from] -= amount
    this.wallet.balances[to] = (this.wallet.balances[to] ?? 0) + out
    const entry = { type: 'swap', venue: q.venue, from, to, amountIn: amount, out, fee: q.fee }
    this.wallet.log.push(entry)
    this.log.push(entry)
    return entry
  }

  /**
   * Make sure the wallet holds `amount` of `asset` above the bond reserve,
   * selling other held tokens in `prefer` order (then any others) as needed.
   * @param {string} asset - the token needed.
   * @param {number} amount - how much is needed, spendable.
   * @returns {object[]} the swaps it made.
   */
  ensure(asset, amount) {
    const swaps = []
    const spendable = a => (this.wallet.balances[a] ?? 0) - (this.wallet.bondReserve[a] ?? 0)
    let short = amount - spendable(asset)
    if (short <= 1e-12) return swaps
    const order = [...this.prefer, ...Object.keys(this.wallet.balances)].filter((a, i, all) => a !== asset && all.indexOf(a) === i)
    for (const from of order) {
      if (short <= 1e-12) break
      const have = spendable(from)
      if (have <= 0) continue
      let q
      try { q = this.quote(from, asset, have) } catch { continue }
      const sell = Math.min(have, have * (short / q.out) * 1.0001)
      swaps.push(this.swap(from, asset, sell))
      short = amount - spendable(asset)
    }
    if (short > 1e-9) throw new Error(`cannot raise ${amount} ${asset} above the bond reserve from what the wallet holds`)
    return swaps
  }

  /**
   * Pay an external router or supplier in the token it takes, converting
   * first when the wallet holds something else. The wallet's allowlist, caps,
   * approval threshold and bond reserve still apply.
   * @param {string} payee - an allowlisted payee id, such as an AI API router.
   * @param {number} amount - how much, in the payee's token.
   * @param {string} purpose - what it pays for.
   * @param {object} [options] - passed to the wallet: billing month, operator approval.
   * @returns {{swaps: object[], payment: object}} what it did.
   */
  pay(payee, amount, purpose, options) {
    const p = this.wallet.payees.get(payee)
    if (!p) throw new Error(`payee "${payee}" is not on the allowlist`)
    const swaps = this.ensure(p.asset, amount)
    const payment = this.wallet.pay(payee, amount, purpose, options)
    this.log.push({ type: 'pay', ...payment, funded: swaps.map(s => `${s.amountIn} ${s.from} via ${s.venue}`) })
    return { swaps, payment }
  }
}
