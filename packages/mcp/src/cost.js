/**
 * Spend for live runs. Before any call the server models a ceiling for the
 * run; after it, it reports what the endpoint measured.
 *
 *   modeled    a ceiling: every juror makes one call, input tokens are taken as
 *              characters / 3, output is capped at MODEL_OUTPUT_TOKENS, priced at
 *              the pool entry's `price` or DEFAULT_PRICE. Real runs cost less.
 *   measured   the sum of `usage.cost` when the endpoint reports it (OpenRouter
 *              does), else the endpoint's token counts at the same price.
 *
 * @module @verafy/mcp/cost
 */
import { buildPrompt } from '../../core/src/index.js'

/** USD per million tokens, used when a pool entry names no `price`. Deliberately high, so the ceiling holds. */
export const DEFAULT_PRICE = Object.freeze({ inputPerMTok: 5, outputPerMTok: 25 })

/** The output tokens one vote is modeled to use. A vote is a short JSON object. */
export const MODEL_OUTPUT_TOKENS = 1000

function priceOf(entry) {
  const p = entry?.price ?? {}
  return {
    inputPerMTok: Number.isFinite(p.inputPerMTok) ? p.inputPerMTok : DEFAULT_PRICE.inputPerMTok,
    outputPerMTok: Number.isFinite(p.outputPerMTok) ? p.outputPerMTok : DEFAULT_PRICE.outputPerMTok,
  }
}

/**
 * The modeled ceiling for one juror call on a contract.
 * @param {object} asc - the contract.
 * @param {object} entry - the pool entry.
 * @returns {number} USD.
 */
export function modelCallUsd(asc, entry) {
  const { system, user } = buildPrompt(asc)
  const inputTokens = Math.ceil((system.length + user.length) / 3)
  const p = priceOf(entry)
  return (inputTokens * p.inputPerMTok + MODEL_OUTPUT_TOKENS * p.outputPerMTok) / 1e6
}

/**
 * The modeled ceiling for a whole jury.
 * @param {object} asc - the contract.
 * @param {object[]} jury - the pool entries seated.
 * @returns {number} USD, rounded up to the cent's hundredth.
 */
export function modelRunUsd(asc, jury) {
  return ceil4(jury.reduce((s, e) => s + modelCallUsd(asc, e), 0))
}

/**
 * A meter that wraps `fetch` to read `usage` from every chat completion, and
 * refuses a call once the cap would be passed.
 * @param {{cap: number, fetch?: typeof fetch}} options - the spend cap in USD and the fetch to wrap.
 * @returns {{fetchFor: (entry: object, perCallUsd: number) => typeof fetch, spent: () => number, calls: () => number, source: () => string}} the meter.
 */
export function createMeter({ cap, fetch: fetchImpl = globalThis.fetch }) {
  let spent = 0
  let reserved = 0
  let calls = 0
  let reported = 0
  let computed = 0
  return {
    fetchFor(entry, perCallUsd) {
      const p = priceOf(entry)
      return async (url, init) => {
        if (spent + reserved + perCallUsd > cap + 1e-12) {
          const err = new Error(`spend cap: another call could pass maxSpendUsd ${cap}`)
          err.code = 'SPEND_CAP'
          throw err
        }
        reserved += perCallUsd
        calls++
        try {
          const res = await fetchImpl(url, init)
          try {
            const body = await res.clone().json()
            const u = body?.usage ?? {}
            if (Number.isFinite(u.cost)) { spent += u.cost; reported++ }
            else if (Number.isFinite(u.prompt_tokens) || Number.isFinite(u.completion_tokens)) {
              spent += ((u.prompt_tokens ?? 0) * p.inputPerMTok + (u.completion_tokens ?? 0) * p.outputPerMTok) / 1e6
              computed++
            } else {
              // No usage at all: count the modeled ceiling, so the report never reads low.
              spent += perCallUsd
              computed++
            }
          } catch { spent += perCallUsd; computed++ }
          return res
        } finally {
          reserved -= perCallUsd
        }
      }
    },
    spent: () => ceil6(spent),
    calls: () => calls,
    source: () => reported && !computed ? 'reported by the endpoint (usage.cost)'
      : computed && !reported ? 'computed from the endpoint token counts at the modeled price'
      : reported ? 'reported by the endpoint where it gave usage.cost, else computed from token counts'
      : 'no calls made',
  }
}

function ceil4(x) { return Math.ceil(x * 1e4) / 1e4 }
function ceil6(x) { return Math.round(x * 1e6) / 1e6 }
