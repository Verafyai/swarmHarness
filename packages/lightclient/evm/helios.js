/**
 * Optional Helios adapter for Ethereum mainnet.
 *
 * Helios (github.com/a16z/helios, 0.12.0 released 2026-10-05, checked
 * 2026-11-06) is a Rust light client: it follows the beacon chain's sync
 * committee from a weak-subjectivity checkpoint, checks execution data against
 * the verified state root with `eth_getProof`, and serves a local JSON-RPC
 * (default http://127.0.0.1:8545). It ships as a binary installed by
 * `heliosup`, so this package never depends on it and never vendors it.
 *
 * Two modes:
 *   sidecar      Helios is already running; the adapter reads its local RPC.
 *   subprocess   the adapter starts `helios ethereum ...` itself, on demand.
 *
 * With Helios absent, `status()` reports `installed: false` with a reason, and
 * the EVM reader falls back to its multi-RPC quorum, labeled as such.
 *
 * Status: built and tested only for the absent case and with a fake binary.
 * It has not been run against a live Helios, so no result in this repo claims
 * sync-committee verification.
 *
 * @module @verafyharness/lightclient/evm/helios
 */
import { spawn as nodeSpawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { rpcVia } from '../shared/rpc.js'

export const HELIOS_CHECKED = { version: '0.12.0', released: '2026-10-05', checked: '2026-11-06', repo: 'https://github.com/a16z/helios' }

/**
 * Find an executable on PATH.
 * @param {string} bin - a name or a path.
 * @param {string} [path] - defaults to process.env.PATH.
 * @returns {string | null} the full path, or null.
 */
export function which(bin, path = process.env.PATH ?? '') {
  const tryPath = p => { try { accessSync(p, constants.X_OK); return true } catch { return false } }
  if (bin.includes('/')) return tryPath(bin) ? bin : null
  for (const dir of path.split(delimiter)) if (dir && tryPath(join(dir, bin))) return join(dir, bin)
  return null
}

/** A router for one local URL, with the same `call` shape as the core ApiRouter. Keyless. */
function localRouter(url, f) {
  const apis = new Map([['helios-local', { id: 'helios-local', kind: 'data', baseURL: url }]])
  return {
    apis,
    async call(_token, apiId, { body }) {
      const res = await f(apis.get(apiId).baseURL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      return { status: res.status, body: await res.json().catch(() => null) }
    },
  }
}

export class HeliosAdapter {
  /**
   * @param {{mode?: 'sidecar' | 'subprocess', bin?: string, rpcPort?: number, rpcUrl?: string, network?: string,
   *   executionRpcEnv?: string, consensusRpc?: string, checkpoint?: string, env?: Record<string, string | undefined>,
   *   fetch?: typeof fetch, spawn?: typeof nodeSpawn, startTimeoutMs?: number}} [options] -
   *   `executionRpcEnv` names the environment variable holding the execution RPC
   *   URL Helios needs (it must support eth_getProof). It is a reference; the URL
   *   is never logged or recorded.
   */
  constructor({ mode = 'subprocess', bin = 'helios', rpcPort = 8545, rpcUrl, network = 'mainnet', executionRpcEnv = 'ETH_EXECUTION_RPC', consensusRpc, checkpoint, env = process.env, fetch: f = globalThis.fetch, spawn = nodeSpawn, startTimeoutMs = 60000 } = {}) {
    this.mode = mode
    this.bin = bin
    this.rpcPort = rpcPort
    this.rpcUrl = rpcUrl ?? `http://127.0.0.1:${rpcPort}`
    this.network = network
    this.executionRpcEnv = executionRpcEnv
    this.consensusRpc = consensusRpc
    this.checkpoint = checkpoint
    this.env = env
    this.spawn = spawn
    this.startTimeoutMs = startTimeoutMs
    this.via = rpcVia(localRouter(this.rpcUrl, f))
    this.child = null
  }

  /** The source entry the EVM reader adds when Helios is running. */
  endpoint() {
    return { id: 'helios', operator: 'helios-local', api: 'helios-local', helios: true }
  }

  async reachable() {
    try { await this.via.rpc(this.endpoint(), 'eth_chainId'); return true } catch { return false }
  }

  /**
   * Whether Helios is installed and running. Never throws.
   * @returns {Promise<{installed: boolean | 'unknown', running: boolean, mode: string, reason: string}>} the status.
   */
  async status() {
    const running = await this.reachable()
    if (this.mode === 'sidecar') return { installed: running ? true : 'unknown', running, mode: this.mode, reason: running ? `Helios RPC answers at ${this.rpcUrl}` : `no Helios RPC answers at ${this.rpcUrl}` }
    const path = which(this.bin, this.env.PATH ?? '')
    if (!path) return { installed: false, running, mode: this.mode, reason: `not installed: no "${this.bin}" on PATH. Install with heliosup (${HELIOS_CHECKED.repo}); last checked release ${HELIOS_CHECKED.version}, ${HELIOS_CHECKED.released}` }
    return { installed: true, running, mode: this.mode, reason: running ? 'running' : 'installed, not running; call start()' }
  }

  /**
   * Start `helios ethereum` as a subprocess and wait for its RPC.
   * @returns {Promise<object>} the status once it answers.
   */
  async start() {
    if (this.mode !== 'subprocess') throw new Error('start() is for subprocess mode; in sidecar mode run Helios yourself')
    const s = await this.status()
    if (!s.installed) throw new Error(`Helios ${s.reason}`)
    if (s.running) return s
    const exec = this.env[this.executionRpcEnv]
    if (!exec) throw new Error(`set ${this.executionRpcEnv} to an execution RPC URL that supports eth_getProof`)
    const argv = ['ethereum', '--execution-rpc', exec, '--network', this.network, '--rpc-port', String(this.rpcPort)]
    if (this.consensusRpc) argv.push('--consensus-rpc', this.consensusRpc)
    if (this.checkpoint) argv.push('--checkpoint', this.checkpoint)
    this.child = this.spawn(which(this.bin, this.env.PATH ?? ''), argv, { stdio: 'ignore' })
    const until = Date.now() + this.startTimeoutMs
    while (Date.now() < until) {
      if (await this.reachable()) return this.status()
      await new Promise(r => setTimeout(r, 500))
    }
    this.stop()
    throw new Error(`Helios did not answer at ${this.rpcUrl} within ${this.startTimeoutMs} ms`)
  }

  /** Stop a subprocess this adapter started. */
  stop() {
    if (this.child) { this.child.kill(); this.child = null }
  }
}
