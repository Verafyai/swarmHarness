/**
 * Verafy Harness economics: what a proven block costs, how proof packing
 * changes it, and what each role earns. Pure functions, no I/O, no
 * dependencies. Every output is MODELED from the inputs; each default carries
 * its own label and source.
 *
 * The site (harness.verafy.ai/economics) inlines this file at build time, so
 * the page and the tests run the same math.
 */

/** Defaults, each with its label and source. */
export const DEFAULTS = {
  gpuHourUsd: { value: 4.0, label: 'modeled', source: 'Typical on-demand H100 80 GB, about $3.19 to $4.50 per GPU-hour (Spheron, Lambda, Crusoe, Hyperbolic, Nebius, Jul to Nov 2026). Low about $2.87, hyperscaler high about $12.29.', url: 'https://www.spheron.network/blog/h100-price-per-hour-2026/', date: '2026-11-06' },
  proverBatch: { value: 24, label: 'vendor-reported', source: 'FlashProve, one H100', url: 'https://anthropic.com/research/provable-inference', date: '2026-11' },
  proverBatchSeconds: { value: 223, label: 'vendor-reported', source: 'FlashProve online phase for a batch of 24, one H100', url: 'https://anthropic.com/research/provable-inference', date: '2026-11' },
  setupMinutes: { value: 39, label: 'vendor-reported', source: 'FlashProve one-time setup per model', url: 'https://anthropic.com/research/provable-inference', date: '2026-11' },
  requestsPerCommitment: { value: 16e6, label: 'vendor-reported', source: 'FlashProve: one commitment covers about 16 million requests', url: 'https://anthropic.com/research/provable-inference', date: '2026-11' },
  contextTokens: { value: 1024, label: 'vendor-reported', source: 'FlashProve context limit per proven request', url: 'https://anthropic.com/research/provable-inference', date: '2026-11' },
  proofMB: { value: 18.78, label: 'vendor-reported', source: 'FlashProve proof size', url: 'https://anthropic.com/research/provable-inference', date: '2026-11' },
  verifySeconds: { value: 17, label: 'vendor-reported', source: 'FlashProve verification on 24 CPU threads, including offline-phase checks (conservative)', url: 'https://anthropic.com/research/provable-inference', date: '2026-11' },
  cpuHourUsd: { value: 1.0, label: 'illustrative', source: 'A 24-thread verifier box. Set your own.' },
  jurors: { value: 5, label: 'prototype default', source: 'Verafy Harness juries' },
  verifiersPerProof: { value: 2, label: 'illustrative', source: 'Verifiers drawn per proof' },
  storageUsdPerGBMonth: { value: 0.02, label: 'illustrative', source: 'Availability-layer storage. Set your own.' },
  retentionMonths: { value: 3, label: 'illustrative', source: 'Proofs kept through the challenge window and archive' },
  warmupMinutes: { value: 15, label: 'illustrative', source: 'Loading weights and artifacts per proving session. Measure it.' },
  contracts: { value: 24, label: 'input', source: 'Contracts in the block' },
  tokensPerContract: { value: 800, label: 'input', source: 'Instructions, context and answer for one contract' },
  marginPct: { value: 30, label: 'input', source: 'Operator margin over cost' },
  utilizationPct: { value: 50, label: 'input', source: 'Share of rented GPU hours spent proving' },
  packing: { value: false, label: 'design', source: 'Proof packing: briefs, several decisions per proven request' },
  proveOnce: { value: false, label: 'design', source: 'Prove each request once while only one model is provable' },
  decisionsPerRequest: { value: 4, label: 'illustrative', source: 'Packed decisions per 1,024-token request' },
  briefMaxTokens: { value: 200, label: 'illustrative', source: 'Token budget for one decision brief' },
  answerTokensPerDecision: { value: 40, label: 'illustrative', source: 'Tokens reserved for each packed answer line' },
  headerTokens: { value: 64, label: 'illustrative', source: 'Fixed juror rules and answer format at the top of a packed request' },
  fidelityCheckUsd: { value: 0.0163 / 5, label: 'measured', source: 'One unproven multi-lab check per brief, from the measured live run: $0.0163 for five contracts', url: 'https://github.com/Verafyai/verafyHarness/blob/main/results/live-2026-11-06.md', date: '2026-11-06' },
}

/** Presets: overrides on DEFAULTS. */
export const PRESETS = {
  unpacked: { name: 'L2, FlashProve, unpacked', values: {} },
  packed: { name: 'L2, FlashProve, proof packing', values: { packing: true, proveOnce: true } },
  deepprove: {
    name: 'L2 prototype, DeepProve on CPU (Gemma 3)',
    note: 'Gemma 3: 19 min to prove, 4.3 s to verify, 27 MiB per proof, 512-token sequences, on a 24-core 504 GB CPU server (vendor-reported, Lagrange DeepProve). For testing the pipeline, not for real juries.',
    values: { gpuHourUsd: 3.0, proverBatch: 1, proverBatchSeconds: 19 * 60, contextTokens: 512, proofMB: 27 * 1.048576, verifySeconds: 4.3, warmupMinutes: 5 },
  },
}

/** Plain values from DEFAULTS, with optional overrides. */
export function inputs(overrides = {}) {
  const out = {}
  for (const [k, d] of Object.entries(DEFAULTS)) out[k] = d.value
  return { ...out, ...overrides }
}

/**
 * Estimate the cost of one proven block and the earnings of each role.
 * @param {object} raw - inputs; anything missing falls back to DEFAULTS.
 * @returns {object} modeled outputs, all in US dollars, seconds, or GB.
 */
export function estimate(raw = {}) {
  const i = inputs(raw)
  const ceil = Math.ceil
  const secondsPerProof = i.proverBatchSeconds / i.proverBatch
  const proveUsd = secondsPerProof / 3600 * i.gpuHourUsd
  const setupUsd = (i.setupMinutes / 60 * i.gpuHourUsd) / i.requestsPerCommitment
  const verifyUsd = i.verifySeconds / 3600 * i.cpuHourUsd
  const storeUsd = i.proofMB / 1024 * i.storageUsdPerGBMonth * i.retentionMonths
  const provers = i.proveOnce ? 1 : i.jurors
  const perProofAllIn = proveUsd + setupUsd + i.verifiersPerProof * verifyUsd + storeUsd
  const perRequestUsd = provers * perProofAllIn

  // Packing: each contract becomes a brief; several briefs share one request.
  // Unpacked: a long contract splits into ceil(tokens / context) requests.
  const requestsPerContract = i.packing ? 1 / i.decisionsPerRequest : ceil(i.tokensPerContract / i.contextTokens)
  const requestsInBlock = i.packing ? ceil(i.contracts / i.decisionsPerRequest) : i.contracts * requestsPerContract
  const fidelityUsd = i.packing ? i.contracts * i.fidelityCheckUsd : 0
  const perDecisionUsd = i.packing
    ? perRequestUsd / i.decisionsPerRequest + i.fidelityCheckUsd
    : perRequestUsd * requestsPerContract

  const proofs = provers * requestsInBlock
  const verifications = proofs * i.verifiersPerProof
  const warmupUsd = provers * i.warmupMinutes / 60 * i.gpuHourUsd
  const parts = {
    proving: proofs * (proveUsd + setupUsd),
    verifying: verifications * verifyUsd,
    storing: proofs * storeUsd,
    warmup: warmupUsd,
    fidelity: fidelityUsd,
  }
  const blockCostUsd = Object.values(parts).reduce((a, b) => a + b, 0)
  const perContractUsd = blockCostUsd / i.contracts
  const m = 1 + i.marginPct / 100
  const sealSeconds = ceil(requestsInBlock / i.proverBatch) * i.proverBatchSeconds
  const proofGB = proofs * i.proofMB / 1024
  const capacityPerHour = 3600 / secondsPerProof
  const util = i.utilizationPct / 100
  const breakEvenFeePerProof = i.gpuHourUsd / (capacityPerHour * util)
  const marginalPerRequest = provers * (proveUsd + i.verifiersPerProof * verifyUsd + storeUsd)
  const minRequestsForWarmup = ceil(9 * warmupUsd / marginalPerRequest)

  // Roles, priced at cost plus margin on the marginal work.
  const proverFee = (proveUsd + setupUsd) * m
  const proverRevenueHour = capacityPerHour * util * proverFee
  const verifierFee = verifyUsd * m
  const verifierCapacityHour = 3600 / i.verifySeconds
  const roles = {
    prover: {
      feePerProof: proverFee,
      revenuePerHour: proverRevenueHour,
      costPerHour: i.gpuHourUsd,
      netPerHour: proverRevenueHour - i.gpuHourUsd,
      breakEvenUtilizationPct: 100 * i.gpuHourUsd / (capacityPerHour * proverFee),
      blockRevenue: proofs * proverFee + warmupUsd * m,
    },
    verifier: {
      feePerVerification: verifierFee,
      capacityPerHour: verifierCapacityHour,
      revenuePerHour: verifierCapacityHour * util * verifierFee,
      costPerHour: i.cpuHourUsd,
      netPerHour: verifierCapacityHour * util * verifierFee - i.cpuHourUsd,
      blockRevenue: verifications * verifierFee,
    },
    juror: {
      note: 'Paid per counted vote from the contract escrow, dissent included. The contract author sets the escrow.',
    },
  }

  const packedTokens = i.headerTokens + i.decisionsPerRequest * (i.briefMaxTokens + i.answerTokensPerDecision)
  const packingFits = packedTokens <= i.contextTokens
  const briefRatio = i.tokensPerContract / i.briefMaxTokens

  return {
    packedTokens, packingFits, briefRatio,
    secondsPerProof, proveUsd, setupUsd, verifyUsd, storeUsd, provers,
    perProofAllIn, perRequestUsd, perDecisionUsd, requestsPerContract, requestsInBlock,
    proofs, verifications, parts, blockCostUsd, perContractUsd,
    priceWithMarginUsd: perContractUsd * m, sealSeconds, proofGB, capacityPerHour,
    breakEvenFeePerProof, minRequestsForWarmup,
    minDecisionsForWarmup: i.packing ? minRequestsForWarmup * i.decisionsPerRequest : minRequestsForWarmup,
    roles, inputs: i,
  }
}

/** Cost per contract across block sizes, for the batch curve. */
export function curve(raw = {}, sizes = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 160, 200]) {
  return sizes.map(n => ({ contracts: n, perContractUsd: estimate({ ...raw, contracts: n }).perContractUsd }))
}
