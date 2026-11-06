/**
 * EVM chains: a multi-RPC reader, and for Ethereum mainnet an optional Helios
 * adapter.
 *
 * The multi-RPC reader works in two steps, so every endpoint answers about the
 * same block:
 *   1. Each endpoint reports its head at the block tag (finalized by default).
 *      An endpoint too far behind the newest is stale and rejected.
 *   2. The reader pins the lowest fresh head, and every endpoint must return
 *      the same block hash for it. Reads (balance, ERC-20 balance, receipt)
 *      are then made at that block number, and must agree.
 * Each endpoint is also checked for the expected chain id.
 *
 * Ethereum mainnet: what is built here is the same multi-RPC reader, labeled
 * `verification: "multi-rpc"`. Sync-committee verification is not implemented
 * in this package. `helios.js` is an optional adapter that, when Helios is
 * installed and running, adds its local RPC as one more source labeled
 * `helios-sync-committee`; Helios does the verification, not this code, and
 * the adapter has not yet been run against a live Helios. With Helios absent,
 * everything still works and the adapter reports "not installed".
 *
 * @module @verafyharness/lightclient/evm
 */
import { checkEndpoints, readAcross } from '../shared/quorum.js'
import { rpcVia } from '../shared/rpc.js'
import { toRaw } from '../solana/index.js'

export { HeliosAdapter } from './helios.js'

export const BLOCK_TAGS = ['latest', 'safe', 'finalized']
const hex = n => `0x${BigInt(n).toString(16)}`
const num = h => Number(BigInt(h))
const pad32 = addr => addr.toLowerCase().replace(/^0x/, '').padStart(64, '0')

export class EvmReader {
  /**
   * @param {{router: object, token?: string | null, endpoints: object[], chainId: number, n?: number, minOperators?: number,
   *   blockTag?: string, policy?: string, retries?: number, retryDelayMs?: number, timeoutMs?: number, maxBlockLag?: number,
   *   chain?: string, helios?: import('./helios.js').HeliosAdapter}} options -
   *   `maxBlockLag` (default 64 blocks, two epochs on Ethereum) bounds how far an
   *   endpoint's head may trail the newest. `helios` applies to chain id 1 only.
   */
  constructor({ router, token = null, endpoints, chainId, n = 3, minOperators = 2, blockTag = 'finalized', policy = 'reject-and-retry', retries = 2, retryDelayMs = 500, timeoutMs = 10000, maxBlockLag = 64, chain, helios = null }) {
    if (!Number.isInteger(chainId)) throw new Error('EvmReader needs a chainId')
    if (!BLOCK_TAGS.includes(blockTag)) throw new Error(`blockTag must be one of ${BLOCK_TAGS.join(', ')}`)
    this.chainId = chainId
    this.chain = chain ?? (chainId === 1 ? 'ethereum' : `evm:${chainId}`)
    this.blockTag = blockTag
    this.endpoints = checkEndpoints(endpoints, { n, minOperators, apis: router?.apis })
    this.via = rpcVia(router, token)
    this.helios = chainId === 1 ? helios : null
    this.opts = { policy, retries, retryDelayMs, timeoutMs, maxLag: maxBlockLag, minOperators }
    this.chainChecked = new Map()
  }

  /** The sources for a read: the RPC endpoints, plus Helios when it is running. */
  async sources() {
    if (!this.helios) return { list: this.endpoints, verification: 'multi-rpc', syncCommittee: this.chainId === 1 ? 'not configured' : 'not applicable' }
    const s = await this.helios.status()
    if (!s.running) return { list: this.endpoints, verification: 'multi-rpc', syncCommittee: s.installed ? 'installed, not running' : 'not installed' }
    return { list: [...this.endpoints, this.helios.endpoint()], verification: 'multi-rpc+helios-sync-committee', syncCommittee: 'helios running (verified by Helios, not by this package)' }
  }

  async rpc(e, method, params) {
    const via = e.helios ? this.helios.via : this.via
    if (!this.chainChecked.get(e.id)) {
      const id = num(await via.rpc(e, 'eth_chainId'))
      if (id !== this.chainId) throw new Error(`wrong chain: endpoint serves chain id ${id}, expected ${this.chainId}`)
      this.chainChecked.set(e.id, true)
    }
    return via.rpc(e, method, params)
  }

  async read(method, list, readOne, labels, extra = {}) {
    const r = await readAcross(list, readOne, { chain: this.chain, commitment: this.blockTag, method, describe: e => (e.helios ? this.helios.via : this.via).describe(e), ...this.opts, ...extra })
    return { ...r, ...labels }
  }

  /**
   * Step 1 and 2: the head at the block tag that every endpoint has reached,
   * with a block hash they all agree on.
   * @returns {Promise<object>} the read; `value` is `{number, hash}`.
   */
  async head() {
    const { list, ...labels } = await this.sources()
    const tips = await this.read(`eth_getBlockByNumber(${this.blockTag})`, list, async e => {
      const b = await this.rpc(e, 'eth_getBlockByNumber', [this.blockTag, false])
      if (!b) throw new Error(`no ${this.blockTag} block`)
      return { value: null, slot: num(b.number) }
    }, labels)
    if (tips.status !== 'agreed') return tips
    const pinned = tips.slot
    const at = await this.read('eth_getBlockByNumber(pinned)', list, async e => {
      const b = await this.rpc(e, 'eth_getBlockByNumber', [hex(pinned), false])
      if (!b) throw new Error(`no block ${pinned}`)
      return { value: { number: num(b.number), hash: b.hash }, slot: pinned }
    }, labels)
    return at
  }

  async atHead(method, readOne) {
    const h = await this.head()
    if (h.status !== 'agreed') return { ...h, method }
    const { list, ...labels } = await this.sources()
    const r = await this.read(method, list, async e => ({ value: await readOne(e, h.value), slot: h.value.number }), labels)
    return { ...r, block: h.value }
  }

  /** Native balance in wei, as a decimal string, at the agreed head. */
  balance(address) {
    return this.atHead('eth_getBalance', async (e, b) => BigInt(await this.rpc(e, 'eth_getBalance', [address, hex(b.number)])).toString())
  }

  /** ERC-20 `balanceOf(holder)`, at the agreed head. */
  erc20Balance(tokenAddress, holder) {
    return this.atHead('eth_call(balanceOf)', async (e, b) => BigInt(await this.rpc(e, 'eth_call', [{ to: tokenAddress, data: `0x70a08231${pad32(holder)}` }, hex(b.number)])).toString())
  }

  /**
   * Whether a transaction landed: a receipt with status 1 in a block at or
   * below the agreed head, so it has reached the block tag.
   */
  receipt(txHash) {
    return this.atHead('eth_getTransactionReceipt', async (e, b) => {
      const r = await this.rpc(e, 'eth_getTransactionReceipt', [txHash])
      if (!r) return { found: false, landed: false }
      const n = num(r.blockNumber)
      return { found: true, landed: r.status === '0x1' && n <= b.number, failed: r.status !== '0x1', txBlock: n, txBlockHash: r.blockHash, reached: n <= b.number }
    })
  }

  /**
   * Whether an escrow address holds at least `amount`.
   * @param {{address: string, token?: string, decimals?: number}} source - with `token`, an ERC-20 balance; without, ETH.
   * @param {number | string} amount - in whole units.
   */
  async checkFunding(source, amount) {
    const r = source.token ? await this.erc20Balance(source.token, source.address) : await this.balance(source.address)
    if (r.status !== 'agreed') return { ...r, funded: null }
    const need = toRaw(amount, source.decimals ?? 18)
    return { ...r, funded: BigInt(r.value) >= need, have: r.value, need: need.toString() }
  }
}
