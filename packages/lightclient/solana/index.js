/**
 * Solana: a multi-RPC reader. Solana has no light-client protocol in
 * production (see ROADMAP.md), so this reader does not verify state itself. It
 * asks N independent endpoints (default 3, from at least two operators) at one
 * commitment level (finalized by default), and accepts an answer only when they
 * agree. Disagreement is unknown, a stale slot is rejected, and a 2 to 1 split
 * follows the policy (default: reject and retry).
 *
 * Reads:
 *   slot()                    the finalized slot every endpoint has reached
 *   genesisHash()             which cluster the endpoints serve
 *   account(pubkey)           lamports, owner, executable and data
 *   tokenAccount(pubkey)      an SPL token account: mint, owner, amount
 *   signature(sig)            whether a transaction landed at the commitment
 *   checkFunding(source, n)   whether an escrow account holds at least n
 *
 * @module @verafyharness/lightclient/solana
 */
import { checkEndpoints, readAcross } from '../shared/quorum.js'
import { rpcVia } from '../shared/rpc.js'

export const COMMITMENTS = ['processed', 'confirmed', 'finalized']
const RANK = { processed: 0, confirmed: 1, finalized: 2 }

/**
 * A decimal amount in the token's smallest unit, without floating point.
 * @param {number | string} amount - such as 1.2.
 * @param {number} decimals - such as 6 for USDC.
 * @returns {bigint} the raw amount.
 */
export function toRaw(amount, decimals) {
  const s = typeof amount === 'number' ? amount.toFixed(Math.min(decimals, 20)) : String(amount)
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`not a decimal amount: ${amount}`)
  const [w, f = ''] = s.split('.')
  if (f.replace(/0+$/, '').length > decimals) throw new Error(`${amount} has more than ${decimals} decimals`)
  return BigInt(w + f.padEnd(decimals, '0').slice(0, decimals))
}

export class SolanaReader {
  /**
   * @param {{router: object, token?: string | null, endpoints: object[], n?: number, minOperators?: number,
   *   commitment?: string, policy?: string, retries?: number, retryDelayMs?: number, timeoutMs?: number,
   *   maxSlotLag?: number, cluster?: string}} options -
   *   `endpoints` are `{id, operator, api}`, each naming an API plugged into `router`.
   *   `maxSlotLag` (default 150 slots, about a minute at 400 ms) is how far behind
   *   the newest answer an endpoint may be before its answer is rejected as stale.
   */
  constructor({ router, token = null, endpoints, n = 3, minOperators = 2, commitment = 'finalized', policy = 'reject-and-retry', retries = 2, retryDelayMs = 500, timeoutMs = 10000, maxSlotLag = 150, cluster = 'solana' }) {
    if (!COMMITMENTS.includes(commitment)) throw new Error(`commitment must be one of ${COMMITMENTS.join(', ')}`)
    this.endpoints = checkEndpoints(endpoints, { n, minOperators, apis: router?.apis })
    this.via = rpcVia(router, token)
    this.commitment = commitment
    this.cluster = cluster
    this.opts = { policy, retries, retryDelayMs, timeoutMs, maxLag: maxSlotLag, minOperators }
  }

  read(method, readOne, extra = {}) {
    return readAcross(this.endpoints, readOne, { chain: this.cluster, commitment: this.commitment, method, describe: e => this.via.describe(e), ...this.opts, ...extra })
  }

  /**
   * The slot at the commitment level. Endpoints answer different slots by
   * design, so this agrees on freshness, not equality: each must be within
   * `maxSlotLag` of the newest, and the result is the lowest such slot.
   * @param {{minSlot?: number}} [options] - reject any endpoint below this slot.
   */
  async slot({ minSlot } = {}) {
    const r = await this.read('getSlot', async e => ({ value: null, slot: await this.via.rpc(e, 'getSlot', [{ commitment: this.commitment }]) }), { minSlot })
    return { ...r, value: r.slot }
  }

  /**
   * The genesis hash, which names the cluster. Endpoints must return the same
   * one. It never changes, so there is no slot to be stale against; the
   * result's slot is 0.
   */
  async genesisHash() {
    return this.read('getGenesisHash', async e => ({ value: await this.via.rpc(e, 'getGenesisHash'), slot: 0 }))
  }

  /**
   * One account, normalized so honest endpoints return identical values.
   * @param {string} pubkey - base58 address.
   * @param {{minSlot?: number}} [options] - also sent to the RPC as minContextSlot.
   */
  async account(pubkey, { minSlot } = {}) {
    return this.read('getAccountInfo', async e => {
      const cfg = { commitment: this.commitment, encoding: 'base64', ...(minSlot !== undefined ? { minContextSlot: minSlot } : {}) }
      const r = await this.via.rpc(e, 'getAccountInfo', [pubkey, cfg])
      const v = r?.value
      return {
        slot: r?.context?.slot,
        value: v ? { exists: true, lamports: String(v.lamports), owner: v.owner, executable: !!v.executable, data: Array.isArray(v.data) ? v.data[0] : v.data } : { exists: false },
      }
    }, { minSlot })
  }

  /**
   * An SPL token account (Token or Token-2022), parsed.
   * @param {string} pubkey - the token account address.
   * @param {{minSlot?: number}} [options]
   */
  async tokenAccount(pubkey, { minSlot } = {}) {
    return this.read('getAccountInfo(jsonParsed)', async e => {
      const cfg = { commitment: this.commitment, encoding: 'jsonParsed', ...(minSlot !== undefined ? { minContextSlot: minSlot } : {}) }
      const r = await this.via.rpc(e, 'getAccountInfo', [pubkey, cfg])
      const v = r?.value
      const info = v?.data?.parsed?.info
      return {
        slot: r?.context?.slot,
        value: !v ? { exists: false } : !info?.tokenAmount ? { exists: true, token: false, owner: v.owner } : {
          exists: true, token: true, program: v.owner, mint: info.mint, holder: info.owner, state: info.state,
          amount: String(info.tokenAmount.amount), decimals: info.tokenAmount.decimals,
        },
      }
    }, { minSlot })
  }

  /**
   * Whether a transaction landed. `landed` means it is found, did not fail, and
   * has reached this reader's commitment level on that endpoint.
   * @param {string} sig - the transaction signature.
   */
  async signature(sig) {
    const want = RANK[this.commitment]
    return this.read('getSignatureStatuses', async e => {
      const r = await this.via.rpc(e, 'getSignatureStatuses', [[sig], { searchTransactionHistory: true }])
      const s = r?.value?.[0]
      const reached = s ? (RANK[s.confirmationStatus] ?? -1) >= want : false
      return {
        slot: r?.context?.slot,
        value: !s ? { found: false, landed: false } : { found: true, landed: reached && s.err == null, failed: s.err != null, txSlot: s.slot, reached },
      }
    })
  }

  /**
   * Whether an escrow account holds at least `amount`.
   * @param {{account: string, mint?: string, decimals?: number}} source - the escrow
   *   account; with `mint`, an SPL token account of that mint; without, lamports.
   * @param {number | string} amount - in whole units (USDC, or SOL when no mint).
   * @returns {Promise<object>} the read, plus `funded`, `have` and `need` (raw units).
   */
  async checkFunding(source, amount) {
    if (source.mint) {
      const r = await this.tokenAccount(source.account)
      if (r.status !== 'agreed') return { ...r, funded: null }
      const v = r.value
      if (!v.exists || !v.token) return { ...r, funded: false, need: null, have: '0', reason: `${r.reason}; ${source.account} is not a token account` }
      if (v.mint !== source.mint) return { ...r, funded: false, need: null, have: v.amount, reason: `${r.reason}; the account holds mint ${v.mint}, not ${source.mint}` }
      const need = toRaw(amount, source.decimals ?? v.decimals)
      return { ...r, funded: BigInt(v.amount) >= need, have: v.amount, need: need.toString() }
    }
    const r = await this.account(source.account)
    if (r.status !== 'agreed') return { ...r, funded: null }
    const have = r.value.exists ? r.value.lamports : '0'
    const need = toRaw(amount, 9)
    return { ...r, funded: BigInt(have) >= need, have, need: need.toString() }
  }
}
