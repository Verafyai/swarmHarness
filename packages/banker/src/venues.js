/**
 * Venue adapters for BankerService (BANK-007). Each one quotes for real
 * against the venue's public API, simulates the exact transaction it would
 * send, and only sends it through a scoped signer when the service has
 * execution on.
 *
 *   jupiterVenue   Solana swaps through Jupiter (lite-api.jup.ag, no key)
 *   lifiVenue      EVM swaps and cross-chain routes through LI.FI (li.quest, no key for quotes)
 *   testVenue      fixed rates, for tests and devnet
 *   jupiterPrice   an independent USD reference for Solana tokens (Jupiter Price API)
 *
 * @module @verafyharness/banker/venues
 */

async function getJson(f, url, init) {
  const res = await f(url, { ...init, signal: AbortSignal.timeout(15_000) })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${new URL(url).host}: ${j.error ?? j.message ?? `HTTP ${res.status}`}`)
  return j
}

/**
 * Jupiter on Solana. `rpc` is a Solana JSON-RPC client (packages/solana's
 * `rpc()`); simulation uses `simulateTransaction` on the exact swap
 * transaction Jupiter builds for the owner.
 */
export function jupiterVenue({ owner, rpc, slippageBps = 50, base = 'https://lite-api.jup.ag/swap/v1', fetch: f = globalThis.fetch } = {}) {
  return {
    name: 'jupiter',
    chains: ['solana'],
    async quote({ from, to, amount }) {
      const q = await getJson(f, `${base}/quote?inputMint=${from}&outputMint=${to}&amount=${amount}&slippageBps=${slippageBps}&restrictIntermediateTokens=true`)
      return { venue: 'jupiter', out: BigInt(q.outAmount), minOut: BigInt(q.otherAmountThreshold), fee: 0n, priceImpact: Number(q.priceImpactPct ?? 0), route: q.routePlan?.map(r => r.swapInfo?.label).filter(Boolean), raw: q }
    },
    async build(q) {
      if (!owner) throw new Error('jupiter: no owner address to build the swap for')
      const s = await getJson(f, `${base}/swap`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteResponse: q.raw, userPublicKey: owner, dynamicComputeUnitLimit: true, prioritizationFeeLamports: 'auto' }) })
      return s.swapTransaction
    },
    async simulate(q) {
      if (!rpc || !owner) return { ok: false, error: 'no RPC or owner to simulate with' }
      try {
        const tx = await this.build(q)
        const r = await rpc.call('simulateTransaction', [tx, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' }])
        return r.value.err ? { ok: false, error: JSON.stringify(r.value.err), logs: r.value.logs?.slice(-5) } : { ok: true, units: r.value.unitsConsumed }
      } catch (err) { return { ok: false, error: err.message } }
    },
    async swap(q, signer) {
      if (!signer?.signSolanaTransaction) throw new Error('jupiter: a scoped Solana signer is required')
      const tx = await this.build(q)
      const signed = await signer.signSolanaTransaction(tx, { venue: 'jupiter', maxIn: q.raw.inAmount })
      const txid = await rpc.call('sendTransaction', [signed, { encoding: 'base64', preflightCommitment: 'confirmed' }])
      await rpc.confirm(txid)
      return { txid, out: q.out }
    },
  }
}

/** EVM chain ids by name. */
export const EVM_CHAINS = Object.freeze({ ethereum: 1, base: 8453, arbitrum: 42161, optimism: 10, polygon: 137 })
const LIFI_CHAIN = { ...EVM_CHAINS, solana: 'SOL' }

/**
 * LI.FI: same-chain EVM swaps through many DEX aggregators, and cross-chain
 * routes through bridges. `evmRpc(chain)` returns a JSON-RPC URL; simulation
 * is `eth_call` of the exact transaction request from the owner.
 */
export function lifiVenue({ owner, evmRpc = null, slippage = 0.005, base = 'https://li.quest/v1', fetch: f = globalThis.fetch } = {}) {
  return {
    name: 'lifi',
    chains: Object.keys(LIFI_CHAIN),
    crossChain: true,
    async quote({ chain, toChain = chain, from, to, amount }) {
      const u = new URL(`${base}/quote`)
      Object.entries({ fromChain: LIFI_CHAIN[chain], toChain: LIFI_CHAIN[toChain], fromToken: from, toToken: to, fromAmount: String(amount), fromAddress: owner ?? '0x000000000000000000000000000000000000dEaD', slippage }).forEach(([k, v]) => u.searchParams.set(k, v))
      const q = await getJson(f, u.toString())
      const fees = (q.estimate?.feeCosts ?? []).reduce((s, c) => s + Number(c.amountUSD ?? 0), 0) + (q.estimate?.gasCosts ?? []).reduce((s, c) => s + Number(c.amountUSD ?? 0), 0)
      return { venue: 'lifi', out: BigInt(q.estimate.toAmount), minOut: BigInt(q.estimate.toAmountMin), fee: 0n, feeUsd: fees, route: [q.toolDetails?.name ?? q.tool], raw: q, chain }
    },
    async simulate(q) {
      const rpcUrl = evmRpc?.(q.chain)
      const tx = q.raw?.transactionRequest
      if (!rpcUrl || !tx || !owner) return { ok: false, error: 'no EVM RPC, transaction or owner to simulate with' }
      try {
        const r = await getJson(f, rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ from: owner, to: tx.to, data: tx.data, value: tx.value }, 'latest'] }) })
        return r.error ? { ok: false, error: r.error.message } : { ok: true }
      } catch (err) { return { ok: false, error: err.message } }
    },
    async swap(q, signer) {
      if (!signer?.sendEvmTransaction) throw new Error('lifi: a scoped EVM signer is required')
      const txid = await signer.sendEvmTransaction(q.raw.transactionRequest, { venue: 'lifi', chain: q.chain })
      return { txid, out: q.out }
    },
  }
}

/** Fixed rates in base units per base unit, for tests and devnet. `rates` keyed "fromAddress/toAddress". */
export function testVenue({ name = 'test', chains = ['solana'], rates, simulate = () => ({ ok: true }), crossChain = false }) {
  return {
    name, chains, crossChain,
    async quote({ from, to, amount }) {
      const r = rates[`${from}/${to}`]
      if (!r) throw new Error('pair not served')
      const [num, den] = Array.isArray(r) ? r : [BigInt(Math.round(r * 1e6)), 1_000_000n]
      return { venue: name, out: (BigInt(amount) * BigInt(num)) / BigInt(den), fee: 0n }
    },
    async simulate(q) { return simulate(q) },
    async swap(q) { return { txid: `test-${name}-${q.out}`, out: q.out } },
  }
}

/** USD reference prices for Solana tokens from Jupiter's Price API, independent of the quote route. */
export function jupiterPrice({ base = 'https://lite-api.jup.ag/price/v3', fetch: f = globalThis.fetch } = {}) {
  return async t => {
    if (t.chain !== 'solana') return null
    const j = await getJson(f, `${base}?ids=${t.address}`)
    return j[t.address]?.usdPrice ?? null
  }
}
