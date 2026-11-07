/**
 * API credits (BANK-013): turning what the wallet holds into the credits each
 * model or compute provider bills against.
 *
 * Most providers sell credits only through a web checkout with a card. As of
 * Nov 6, 2026, OpenRouter's programmatic crypto top-up returns 410 Gone, so no
 * adapter here buys credits automatically. What is built: reading each
 * provider's balance, projecting when it runs out from recent spend, and
 * telling the operator (and the Banker, which sets aside the target token)
 * how much to top up and when. A `topUp` adapter slot exists for providers
 * that accept on-chain payment, such as per-request x402 payments.
 *
 *   creditSource: { provider, balance() -> {usd, used?, limit?}, topUp?(usd, signer) -> {txid} }
 *
 * @module @verafyharness/banker/credits
 */

/** OpenRouter's key balance (GET /api/v1/credits with the key). Reading only. */
export function openRouterCredits({ apiKey, base = 'https://openrouter.ai/api/v1', fetch: f = globalThis.fetch }) {
  return {
    provider: 'openrouter',
    topUp: null,
    async balance() {
      const res = await f(`${base}/credits`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(`openrouter credits: ${j.error?.message ?? `HTTP ${res.status}`}`)
      const total = Number(j.data?.total_credits ?? 0), used = Number(j.data?.total_usage ?? 0)
      return { usd: total - used, used, limit: total }
    },
  }
}

/** A balance the operator reports by hand (any provider with a web console). */
export function manualCredits({ provider, usd }) {
  let bal = usd
  return { provider, topUp: null, async balance() { return { usd: bal } }, set(v) { bal = v } }
}

/**
 * Check every source against the recent burn rate and say what to do.
 * @param {object[]} sources - credit sources.
 * @param {Record<string, number>} burnUsdPerDay - recent spend per provider (from the API router's meter).
 * @param {{warnDays?: number, targetDays?: number}} [o] - warn when fewer days remain; top up to this many days.
 * @returns {Promise<object[]>} one line per provider: balance, days left, status, and the top-up amount.
 */
export async function creditPlan(sources, burnUsdPerDay = {}, { warnDays = 7, targetDays = 30 } = {}) {
  return Promise.all(sources.map(async s => {
    try {
      const b = await s.balance()
      const burn = burnUsdPerDay[s.provider] ?? 0
      const days = burn > 0 ? b.usd / burn : Infinity
      const topUpUsd = burn > 0 && days < targetDays ? Math.ceil((targetDays * burn - b.usd) * 100) / 100 : 0
      const status = b.usd <= 0 ? 'empty' : days < warnDays ? 'low' : 'ok'
      return { provider: s.provider, usd: b.usd, burnUsdPerDay: burn, daysLeft: Number.isFinite(days) ? Math.round(days * 10) / 10 : null, status, topUpUsd, how: s.topUp ? 'automatic' : 'manual: top up in the provider\'s console' }
    } catch (err) {
      return { provider: s.provider, status: 'unknown', error: err.message }
    }
  }))
}
