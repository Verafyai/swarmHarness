/**
 * svmLLM as an optional third settlement runtime (research track, Part H).
 *
 * svmLLM (github.com/Verafyai/svmLLM) runs reduced-sBPF programs on hand-built
 * transformer weights: every instruction is a forward pass through constant
 * tensors, all activations exactly 0 or 1, no training and no floating-point
 * drift. Its settlement core (`svllm/settle.py`) holds the five integer
 * settlement programs, written by hand in svmLLM's subset:
 *
 *   covered      graded_payout.claim, ranked_split.split, milestone_escrow.release, bond, ledger
 *   not covered  the jury pay rule (`jury`) and escrow hold and release (`escrow`)
 *
 * The jury pay rule splits escrow in IEEE-754 doubles, as runtime.js does, and
 * TinySVM reproduces those doubles bit for bit in soft-float. The svmLLM core
 * is integer only, so `jury` and `escrow` stay two-runtime (runtime.js and
 * TinySVM). This runtime simply has no `jury` or `escrow` method.
 *
 * The numbers and decisions run in the weights; key layout (which account
 * each delta belongs to) is done in Python around the run, as TinySVM's
 * `jury` does in JS. It decides nothing and is never the default runtime.
 *
 * It is a sidecar like the TinySVM engine: `python -m svllm.settle_sidecar`,
 * JSON lines over stdio. With svmLLM missing, `findSvmllm` says why and
 * nothing else changes.
 * @module @verafyharness/tinysvm/svmllm
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CODES, canonical } from '../../core/src/index.js'
import { SettlementFault } from './index.js'

/**
 * Where svmLLM is, or why it is not usable. `SVMLLM_HOME` is an svmLLM checkout
 * with the settlement core; `SVMLLM_PYTHON` a Python with torch (default `python3`).
 * @returns {{ok: true, home: string, python: string} | {ok: false, reason: string}} the result.
 */
export function findSvmllm() {
  const home = process.env.SVMLLM_HOME
  const python = process.env.SVMLLM_PYTHON ?? 'python3'
  if (!home) return { ok: false, reason: 'svmLLM not installed (set SVMLLM_HOME to an svmLLM checkout with svllm/settle.py, and SVMLLM_PYTHON to a Python with torch)' }
  if (!existsSync(join(home, 'svllm', 'settle.py'))) return { ok: false, reason: `svmLLM settlement core not found (${join(home, 'svllm', 'settle.py')} is missing)` }
  const probe = spawnSync(python, ['-c', 'import torch, svllm.settle'], { cwd: home, encoding: 'utf8' })
  if (probe.error || probe.status !== 0) return { ok: false, reason: `svmLLM cannot start (${python} -c "import torch, svllm.settle" failed: ${(probe.error?.message ?? probe.stderr ?? '').trim().split('\n').pop()})` }
  return { ok: true, home, python }
}

/** The svmLLM sidecar: one Python process with a worker pool, replies matched by id. */
export class SvmllmEngine {
  /**
   * Start the sidecar and wait for its hello.
   * @param {{home: string, python: string}} [where] - defaults to `findSvmllm()`.
   * @returns {Promise<SvmllmEngine>} the started engine.
   */
  static async start(where = findSvmllm()) {
    if (!where.ok && !where.home) throw new Error(where.reason)
    const e = new SvmllmEngine(where)
    e.hello = await e.ready
    return e
  }

  constructor({ home, python }) {
    this.next = 1
    this.waiting = new Map()
    this.buffer = ''
    this.child = spawn(python, ['-m', 'svllm.settle_sidecar'], { cwd: home, stdio: ['pipe', 'pipe', 'inherit'] })
    this.ready = new Promise((resolve, reject) => { this.hold = { resolve, reject } })
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk
      let i
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i)
        this.buffer = this.buffer.slice(i + 1)
        if (!line.trim()) continue
        const msg = JSON.parse(line)
        if (msg.hello) { this.hold.resolve(msg.hello); continue }
        const w = this.waiting.get(msg.id)
        if (w) { this.waiting.delete(msg.id); w.resolve(msg) }
      }
    })
    this.child.on('exit', code => {
      this.hold.reject(new Error(`svmLLM sidecar exited (${code}) before it was ready`))
      for (const w of this.waiting.values()) w.reject(new Error(`svmLLM sidecar exited (${code})`))
      this.waiting.clear()
    })
  }

  /**
   * Send one call. Calls may overlap; the sidecar runs them in parallel.
   * @param {string} method - `exit`, `bond` or `ledger`.
   * @param {object} input - the same input jsRuntime takes.
   * @returns {Promise<object>} the reply.
   */
  request(method, input) {
    const id = this.next++
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject })
      this.child.stdin.write(JSON.stringify({ id, method, input }) + '\n')
    })
  }

  /** Stop the sidecar: close its input so its worker pool shuts down, and kill it if it lingers. */
  close() {
    this.child.stdin.end()
    setTimeout(() => this.child.kill(), 5000).unref()
  }
}

function result(reply) {
  if (reply.unsupported) throw new SettlementFault(`svmLLM settlement core does not encode this input: ${reply.unsupported}`, reply)
  if (reply.error) throw new SettlementFault(`svmLLM sidecar failed: ${reply.error}`, reply)
  const { cu, ...r } = reply.result
  if (!r.ok) return { ok: false, code: r.code, error: CODES[r.code] ?? `code ${r.code}`, steps: cu }
  return { ...r, steps: cu }
}

/**
 * The svmLLM runtime: `exit`, `bond` and `ledger`, with the same inputs and
 * results as `jsRuntime`. Every result also carries `steps` (forward passes,
 * one per sBPF instruction), which comparisons ignore.
 * @param {SvmllmEngine} engine - a started engine.
 * @returns {object} the runtime.
 */
export function svmllmRuntime(engine) {
  return {
    name: 'svmllm',
    engine,
    covers: ['exit', 'bond', 'ledger'],
    exit: input => engine.request('exit', input).then(result),
    bond: input => engine.request('bond', input).then(result),
    ledger: input => engine.request('ledger', input).then(result),
  }
}

const strip = r => { if (!r || typeof r !== 'object') return r; const { computeUnits, steps, ...rest } = r; return rest }

/**
 * Run a reference runtime and several others on every call. A method goes to
 * every runtime that implements it; any disagreement throws a SettlementFault.
 * Returns the reference result. `calls[method][runtimes]` counts which
 * runtimes ran each call, so a test can show what was compared.
 * @param {object} reference - the reference runtime (jsRuntime).
 * @param {object[]} others - the runtimes to check against it.
 * @returns {object} a runtime with the five methods, all async.
 */
export function crossRuntime(reference, others) {
  const out = { name: [reference, ...others].map(r => r.name).join('+'), faults: 0, calls: {} }
  for (const m of ['jury', 'escrow', 'bond', 'ledger', 'exit']) {
    out[m] = async input => {
      const runners = others.filter(o => typeof o[m] === 'function')
      const [a, ...bs] = await Promise.all([reference[m](input), ...runners.map(o => o[m](input))])
      runners.forEach((o, i) => {
        if (canonical(strip(a)) !== canonical(strip(bs[i]))) {
          out.faults++
          throw new SettlementFault(`${reference.name} and ${o.name} disagree on ${m}`, { method: m, input, [reference.name]: a, [o.name]: bs[i] })
        }
      })
      const ran = [reference.name, ...runners.map(o => o.name)].join('+')
      out.calls[m] = out.calls[m] ?? {}
      out.calls[m][ran] = (out.calls[m][ran] ?? 0) + 1
      return a
    }
  }
  return out
}
