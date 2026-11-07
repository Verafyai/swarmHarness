#!/usr/bin/env node
// Part H5: try proving one settlement with the Part D prover, and model what a
// real proof of the svmLLM settlement core would cost next to a judgment proof.
//
//   SVMLLM_HOME=<svmLLM checkout> SVMLLM_PYTHON=<python with torch> \
//     node packages/tinysvm/scripts/svmllm-proof.mjs [--write]
//
// 1. Settles graded-insurance (43 percent) on runtime.js, TinySVM (if built)
//    and the svmLLM weights, and checks they agree.
// 2. Proves that settlement with the MOCK prover (packages/prove) and verifies
//    it. The mock binds commitment, input and answer; it proves nothing about
//    the computation. It is the only prover runnable here: DeepProve needs its
//    license accepted (Rex's decision), FlashProve needs Linux and a GPU.
// 3. Models settlement proof cost against judgment proof cost with
//    packages/economics, from dense FLOPs measured in svmLLM
//    (results/settlement.json). Every figure is labeled.
//
// --write saves results/svmllm-settlement-<date>.json.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { platform, arch, cpus } from 'node:os'
import { jsRuntime, settle, canonical } from '../../core/src/index.js'
import { mockProver, mockVerifier, mockCommitment } from '../../prove/src/index.js'
import { estimate, PRESETS, DEFAULTS } from '../../economics/src/index.js'
import { findEngine, Engine, tinySvmRuntime, findSvmllm, SvmllmEngine, svmllmRuntime, crossRuntime } from '../src/index.js'

const ROOT = new URL('../../../', import.meta.url)
const where = findSvmllm()
if (!where.ok) { console.log(`svmllm-proof: skipped: ${where.reason}`); process.exit(0) }
const date = new Date().toLocaleDateString('en-CA')
const machine = `${cpus()[0]?.model ?? 'unknown CPU'}, ${platform()} ${arch()}`

// ---- 1. one settlement on every runtime
const s = await SvmllmEngine.start(where)
const tw = findEngine()
const t = tw.ok ? await Engine.start(tw) : null
const x = crossRuntime(jsRuntime, [...(t ? [tinySvmRuntime(t)] : []), svmllmRuntime(s)])
const asc = JSON.parse(readFileSync(new URL('examples/graded-insurance.json', ROOT), 'utf8'))
const ruling = { exit: 'PAY', passed: true, params: { percent: 43 } }
const settled = await settle(asc, ruling, { runtime: x })
const reference = settle(asc, ruling)
if (canonical(settled) !== canonical(reference)) throw new Error('cross-runtime settlement differs from runtime.js')
console.log(`settlement: graded-insurance, percent 43, on ${Object.keys(x.calls.exit).join(', ')}: ${JSON.stringify(settled.transfers)}`)

// ---- 2. prove it with the mock prover (the only one runnable here)
const exitProgram = asc.exits.find(e => e.outcome === 'PAY').exitProgram
const call = { program: 'graded_payout', entry: 'claim', state: { reserve: exitProgram.args.reserve, paid: 0, claims: 0 }, input: null }
const { exitCall } = await import('../../core/src/settle.js')
call.input = exitCall(exitProgram, ruling.params).input
const model = `svmllm-settlement/${s.hello.weights_sha256}`
const prover = mockProver({
  model,
  complete: async req => {
    const r = await svmllmRuntime(s).exit(JSON.parse(req.user))
    const { steps, ...rest } = r
    return canonical(rest)
  },
})
const input = { system: 'svmLLM settlement core: graded_payout.claim on the weights machine', user: canonical(call) }
const [proved] = await prover.prove([{ id: 'settlement-1', input }])
const verifier = mockVerifier()
const commitment = prover.commitment()
const verifies = verifier.verify(proved.proofRef, commitment, input, proved.answer)
const tampered = verifier.verify(proved.proofRef, commitment, input, proved.answer.replace('"ok":true', '"ok":false'))
const wrongModel = verifier.verify(proved.proofRef, mockCommitment('another-model'), input, proved.answer)
console.log(`mock proof: verifies ${verifies}, tampered answer ${tampered}, other commitment ${wrongModel} (mock/1: binds commitment, input and answer; NOT a proof of the computation)`)
s.close(); t?.close()

// ---- 3. modeled cost
const res = JSON.parse(readFileSync(join(where.home, 'results', 'settlement.json'), 'utf8'))
const j = estimate(PRESETS.unpacked.values)
const ACTIVE = 17e9
const TOKENS = DEFAULTS.contextTokens.value
const judgmentFlops = 2 * ACTIVE * TOKENS
const rows = Object.entries(res.latency.per_program).map(([p, l]) => {
  const worst = res.suite.per_program[p].cu_max
  const flopsStep = l.dense_flops_per_step_full
  const ratio = (l.steps * flopsStep) / judgmentFlops
  const ratioWorst = (worst * flopsStep) / judgmentFlops
  const paramRatio = (res.size.settlement_machine_params * l.steps) / (ACTIVE * TOKENS)
  return {
    program: p, call: l.call, steps: l.steps, worstStepsInSuite: worst, denseFlopsPerStep: flopsStep,
    settlementFlops: l.steps * flopsStep, flopRatio: ratio, flopRatioWorst: ratioWorst, paramPassRatio: paramRatio,
    proveUsd: j.proveUsd * ratio, proveUsdWorst: j.proveUsd * ratioWorst,
    allInUsd: j.proveUsd * ratio + j.setupUsd + DEFAULTS.verifiersPerProof.value * j.verifyUsd + j.storeUsd,
  }
})
const judgmentAllIn = j.proveUsd + j.setupUsd + DEFAULTS.verifiersPerProof.value * j.verifyUsd + j.storeUsd
const usd = v => `$${v < 0.001 ? v.toExponential(2) : v.toFixed(4)}`
console.log('\nModeled (packages/economics, preset "L2, FlashProve, unpacked"; settlement FLOPs measured in svmLLM, ' + res.date + ', ' + res.machine + '):')
console.log(`  judgment proof: Llama 4 Maverick, 17B active parameters (vendor-reported, Meta) x ${TOKENS} tokens x 2 = ${judgmentFlops.toExponential(2)} FLOPs; proving ${usd(j.proveUsd)} per request, all-in ${usd(judgmentAllIn)} (modeled)`)
for (const r of rows) {
  console.log(`  ${r.program.padEnd(17)} ${String(r.steps).padStart(4)} steps (worst in suite ${String(r.worstStepsInSuite).padStart(4)}): ${r.settlementFlops.toExponential(2)} FLOPs, ${(100 * r.flopRatio).toFixed(4)}% of the judgment; proving ${usd(r.proveUsd)} (worst ${usd(r.proveUsdWorst)}), all-in ${usd(r.allInUsd)} if verify, storage and setup stay fixed (modeled)`)
}
const pct = v => `${(100 * v).toFixed(3)}%`
const lo = Math.min(...rows.map(r => r.flopRatio)), hi = Math.max(...rows.map(r => r.flopRatio)), worst = Math.max(...rows.map(r => r.flopRatioWorst))
const verdict = `UNTESTED. Modeled from dense FLOPs, a settlement proof would cost ${pct(lo)} to ${pct(hi)} of the judgment proof's proving cost for the measured calls, and at most ${pct(worst)} at the worst step count in the suite; but no prover available here can prove this network: the mock proves nothing, DeepProve is not licensed for use (Rex's decision), and FlashProve needs Linux and a GPU and is built for a specific transformer architecture, not this one. FLOPs-proportional proving cost is an assumption, not a measurement. The success criterion is not met; svmLLM settlement stays a demo.`
console.log(`\nSuccess criterion (a settlement proof cheaper than the judgment proof): ${verdict}`)

if (process.argv.includes('--write')) {
  const out = {
    date, machine,
    settlement: { contract: 'examples/graded-insurance.json', percent: 43, runtimes: Object.keys(x.calls.exit), transfers: settled.transfers },
    mockProof: { label: 'mock/1: binds commitment, input and answer; not a proof of the computation', model, commitment, proofHash: proved.proofHash, verifies, tamperedAnswerVerifies: tampered, otherCommitmentVerifies: wrongModel },
    provers: {
      mock: 'ran',
      deepprove: 'not run: its license (Lagrange License) is not accepted; that is Rex\'s decision',
      flashprove: `not run: needs Linux and an NVIDIA GPU; this machine is ${platform()} ${arch()}`,
    },
    modeled: {
      label: 'modeled',
      basis: 'proving cost proportional to dense FLOPs (torch FlopCounterMode, full mode: every circuit of the subset machine evaluated each step); judgment FLOPs = 2 x active parameters x tokens; attention, lookups and the prover\'s own overheads ignored',
      judgment: { model: 'Llama 4 Maverick 17B-128E', activeParams: { value: ACTIVE, label: 'vendor-reported', source: 'Meta model card' }, tokens: { value: TOKENS, label: 'vendor-reported', source: DEFAULTS.contextTokens.source }, flops: judgmentFlops, proveUsd: j.proveUsd, allInUsd: judgmentAllIn, preset: PRESETS.unpacked.name },
      settlement: rows,
    },
    successCriterion: verdict,
  }
  const path = new URL(`results/svmllm-settlement-${date}.json`, ROOT)
  writeFileSync(path, JSON.stringify(out, null, 1) + '\n')
  console.log(`wrote ${path.pathname}`)
}
