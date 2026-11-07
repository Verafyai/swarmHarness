/**
 * Which model a machine can run. A harness either calls a hosted model over an
 * API (any machine, even the smallest server, can do that) or runs open
 * weights itself through an OpenAI-compatible local server such as Ollama.
 *
 * Memory needs are modeled, not measured: 4-bit weights at about 0.6 GB per
 * billion parameters, plus about 25% for the context cache and the runtime.
 * Check a model on the machine before trusting it with a bond.
 *
 * @module @verafyharness/deploy/profiles
 */

/** Open-weights models by lab, smallest first. `tag` is the Ollama tag; check it exists before pulling. */
export const OPEN_WEIGHTS = Object.freeze([
  { lab: 'qwen', model: 'Qwen3 4B', tag: 'qwen3:4b', paramsB: 4 },
  { lab: 'google', model: 'Gemma 3 4B', tag: 'gemma3:4b', paramsB: 4 },
  { lab: 'meta', model: 'Llama 3.1 8B', tag: 'llama3.1:8b', paramsB: 8 },
  { lab: 'qwen', model: 'Qwen3 8B', tag: 'qwen3:8b', paramsB: 8 },
  { lab: 'deepseek', model: 'DeepSeek R1 8B (distilled)', tag: 'deepseek-r1:8b', paramsB: 8 },
  { lab: 'google', model: 'Gemma 3 12B', tag: 'gemma3:12b', paramsB: 12 },
  { lab: 'qwen', model: 'Qwen3 14B', tag: 'qwen3:14b', paramsB: 14 },
  { lab: 'mistral', model: 'Mistral Small 24B', tag: 'mistral-small:24b', paramsB: 24 },
  { lab: 'google', model: 'Gemma 3 27B', tag: 'gemma3:27b', paramsB: 27 },
  { lab: 'qwen', model: 'Qwen3 32B', tag: 'qwen3:32b', paramsB: 32 },
  { lab: 'meta', model: 'Llama 3.3 70B', tag: 'llama3.3:70b', paramsB: 70 },
])

/** Hosted models through OpenRouter, one per lab, as in verafy.config.json. */
export const HOSTED = Object.freeze([
  { lab: 'anthropic', model: 'anthropic/claude-haiku-4.5' },
  { lab: 'openai', model: 'openai/gpt-5-mini' },
  { lab: 'google', model: 'google/gemini-2.5-flash' },
  { lab: 'meta', model: 'meta-llama/llama-4-maverick' },
  { lab: 'qwen', model: 'qwen/qwen3-235b-a22b-2507' },
  { lab: 'deepseek', model: 'deepseek/deepseek-v4-flash' },
])

/** Modeled memory a 4-bit model needs, in GB. */
export function memoryNeededGb(paramsB) {
  return Math.ceil(paramsB * 0.6 * 1.25 * 10) / 10
}

/** Rough router tier for a model size: small, mid or frontier. Hosted models are named by the operator. */
export function tierFor(paramsB) {
  return paramsB <= 9 ? 'small' : paramsB <= 40 ? 'mid' : 'frontier'
}

/**
 * The open-weights models a machine can hold, largest first.
 * @param {{memGb: number, gpuMemGb?: number}} hw - system RAM, and GPU memory if any.
 * @param {{headroomGb?: number}} [o] - memory left for the OS and the harness.
 * @returns {object[]} models with `needGb`, `tier` and `on` (gpu or cpu).
 */
export function fits(hw, { headroomGb = 2 } = {}) {
  const out = []
  for (const m of OPEN_WEIGHTS) {
    const needGb = memoryNeededGb(m.paramsB)
    const on = hw.gpuMemGb && needGb <= hw.gpuMemGb ? 'gpu' : needGb <= hw.memGb - headroomGb ? 'cpu' : null
    if (on) out.push({ ...m, needGb, tier: tierFor(m.paramsB), on })
  }
  return out.sort((a, b) => b.paramsB - a.paramsB)
}

/**
 * A recommendation for this machine: the largest model that fits, preferring
 * the GPU, or a hosted model when nothing fits well. A CPU-only machine can
 * run a small model, slowly; it is offered but not recommended over hosted.
 * @param {{memGb: number, gpuMemGb?: number, cpus?: number}} hw - the machine.
 * @param {{lab?: string}} [o] - prefer this lab.
 * @returns {{kind: 'local'|'hosted', model: object, why: string, options: object[]}} the pick.
 */
export function recommend(hw, { lab } = {}) {
  const options = fits(hw).filter(m => !lab || m.lab === lab)
  const gpu = options.find(m => m.on === 'gpu')
  if (gpu) return { kind: 'local', model: gpu, why: `${gpu.model} needs about ${gpu.needGb} GB (modeled) and fits in ${hw.gpuMemGb} GB of GPU memory`, options }
  const hosted = HOSTED.find(m => !lab || m.lab === lab) ?? HOSTED[0]
  const cpu = options[0]
  const why = cpu
    ? `no GPU: ${cpu.model} fits in RAM but runs slowly on a CPU, so a hosted model is the default`
    : `this machine has ${hw.memGb} GB of RAM, too little for a local model, so it calls a hosted one`
  return { kind: 'hosted', model: hosted, why, options }
}
