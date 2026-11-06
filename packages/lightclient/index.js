/**
 * Verafy Harness light client: read the source chain without trusting one RPC.
 *
 *   solana/   multi-RPC reader for Solana (built)
 *   evm/      multi-RPC reader for EVM chains (built), optional Helios adapter
 *             for Ethereum mainnet (built, not run against a live Helios)
 *
 * `sourceChain()` is what the core's intake and outbox call: it checks that a
 * contract's escrow is funded and confirms that a trigger landed. `fromConfig()`
 * builds one from the `lightclient` block of verafy.config.json, with every
 * endpoint plugged into the core's API router.
 *
 * @module @verafyharness/lightclient
 */
import { ApiRouter } from '../core/src/apirouter.js'
import { SolanaReader } from './solana/index.js'
import { EvmReader, HeliosAdapter } from './evm/index.js'

export { SolanaReader, toRaw, COMMITMENTS } from './solana/index.js'
export { EvmReader, HeliosAdapter, BLOCK_TAGS } from './evm/index.js'
export { readAcross, checkEndpoints, canonical, valueHash, safeError, POLICIES } from './shared/quorum.js'
export { rpcVia } from './shared/rpc.js'

/**
 * The source-chain checker the core uses.
 * @param {{solana?: SolanaReader, evm?: EvmReader[]}} readers - one Solana reader, and any EVM readers by chain.
 * @returns {{checkFunding: (asc: object) => Promise<object>, confirmTrigger: (trigger: object, landed: object) => Promise<object>, readerFor: (chain: string) => object | null}} the checker.
 */
export function sourceChain({ solana = null, evm = [] } = {}) {
  const byChain = new Map(evm.map(r => [r.chain, r]))
  const readerFor = chain => {
    if (!chain) return null
    if (chain === 'solana' || chain === solana?.cluster || chain.startsWith('solana')) return solana
    return byChain.get(chain) ?? evm.find(r => `evm:${r.chainId}` === chain) ?? null
  }
  return {
    readerFor,
    /**
     * Whether the escrow a contract names (`payment.source`) holds the contract's escrow amount.
     * @returns {Promise<object>} the read with `funded`; `status: 'unknown'` when sources disagree.
     */
    async checkFunding(asc) {
      const src = asc?.payment?.source
      const chain = src?.chain ?? asc?.payment?.chain
      const reader = readerFor(chain)
      if (!reader) return { status: 'unconfigured', funded: null, chain, reason: `no light-client reader configured for chain "${chain}"`, sources: [] }
      const native = reader instanceof SolanaReader ? 'SOL' : 'ETH'
      if (!src.mint && !src.token && !src.native && asc.payment.currency !== native) {
        return { status: 'invalid', funded: null, chain, reason: `payment.source names no ${reader instanceof SolanaReader ? 'mint' : 'token'} for ${asc.payment.currency}; set it, or set native: true to check the native balance`, sources: [] }
      }
      const r = await reader.checkFunding(src, asc.payment.escrow)
      return { ...r, chain: r.chain ?? chain }
    },
    /**
     * Whether a trigger landed on its chain.
     * @param {object} trigger - the ruling's call trigger.
     * @param {{chain?: string, signature?: string, txHash?: string}} landed - where the outbox says it was sent.
     */
    async confirmTrigger(trigger, landed) {
      const chain = landed?.chain ?? trigger?.chain
      const reader = readerFor(chain)
      if (!reader) return { status: 'unconfigured', landed: null, chain, reason: `no light-client reader configured for chain "${chain}"`, sources: [] }
      const r = reader instanceof SolanaReader ? await reader.signature(landed.signature) : await reader.receipt(landed.txHash)
      return { ...r, landed: r.status === 'agreed' ? !!r.value.landed : null }
    },
  }
}

/**
 * Build readers from config. Endpoints are API entries plugged into one API
 * router; keys are keyblock secrets (`secret`, used with a scoped `token`) or
 * environment references (`secretEnv`). No key is ever a config value.
 *
 * @param {{apis: object[], solana?: object, evm?: object[]}} lc - the `lightclient` config block.
 * @param {{router?: object, keyblock?: object, banker?: object, token?: string | null, fetch?: typeof fetch, env?: Record<string, string | undefined>}} [deps]
 * @returns {{router: object, solana: SolanaReader | null, evm: EvmReader[], checker: ReturnType<typeof sourceChain>}} the readers.
 */
export function fromConfig(lc, { router, keyblock, banker, token = null, fetch: f = globalThis.fetch, env = process.env } = {}) {
  if (!lc) throw new Error('no lightclient config')
  const r = router ?? new ApiRouter({ keyblock, banker, apis: (lc.apis ?? []).map(a => ({ kind: 'data', ...a })), fetch: f, env })
  const solana = lc.solana ? new SolanaReader({ router: r, token, ...lc.solana }) : null
  const evm = (lc.evm ?? []).map(c => new EvmReader({ router: r, token, ...c, helios: c.helios ? new HeliosAdapter({ env, fetch: f, ...c.helios }) : null }))
  return { router: r, solana, evm, checker: sourceChain({ solana, evm }) }
}
