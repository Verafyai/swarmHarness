/**
 * Actually Smart Contracts: the four-part request every harness rules on.
 *
 *   context   links, text and policies, each pinned by SHA-256
 *   question  what must be decided, and the form of the answer
 *   payment   escrow, jury rules and the bar the jury must clear
 *   exits     the only things the contract can do with an answer
 *
 * @module @verafyharness/core/asc
 */
import { sha256 } from './hash.js'

export const ASC_KIND = 'swarm.asc/0'
export const ANSWER_TYPES = ['verdict', 'forecast', 'graded']
export const CONTEXT_KINDS = ['link', 'text', 'policy', 'document', 'repo']
export const EFFECT_TYPES = ['pay', 'refund', 'hold', 'record', 'call', 'escalate']
/** The reserved exit taken when agreement is below the bar. */
export const BELOW_BAR = '*below-bar'

/**
 * Hash the bytes a context entry pins. Links and documents pin their snapshot text.
 * @param {{content: string}} entry - a context entry with its snapshot content.
 * @returns {string} SHA-256 hex.
 */
export function contextHash(entry) {
  return sha256(entry.content)
}

/**
 * Fill in `sha256` for every context entry that lacks one. Used when authoring.
 * @param {object} asc - an Actually Smart Contract.
 * @returns {object} a copy with every context entry pinned.
 */
export function pin(asc) {
  return { ...asc, context: asc.context.map(c => ({ ...c, sha256: c.sha256 ?? contextHash(c) })) }
}

/**
 * The contract's identity: a hash over everything except snapshot content, so the
 * hash is stable whether or not the content travels with it.
 * @param {object} asc - a pinned Actually Smart Contract.
 * @returns {string} SHA-256 hex.
 */
export function ascHash(asc) {
  const { context, ...rest } = asc
  return sha256({ ...rest, context: context.map(({ content, ...meta }) => meta) })
}

/**
 * Check an Actually Smart Contract and return every problem found.
 * @param {object} asc - the contract to validate.
 * @returns {string[]} human-readable problems; empty when valid.
 */
export function validate(asc) {
  const p = []
  if (asc?.kind !== ASC_KIND) p.push(`kind must be "${ASC_KIND}"`)
  if (!asc?.id) p.push('id is required')
  if (!Array.isArray(asc?.context) || asc.context.length === 0) p.push('context needs at least one entry')
  for (const [i, c] of (asc?.context ?? []).entries()) {
    if (!CONTEXT_KINDS.includes(c.kind)) p.push(`context[${i}].kind must be one of ${CONTEXT_KINDS.join(', ')}`)
    if (typeof c.content !== 'string' && !c.sha256) p.push(`context[${i}] needs content or sha256`)
  }
  const q = asc?.question
  if (!q?.prompt) p.push('question.prompt is required')
  if (!ANSWER_TYPES.includes(q?.answer?.type)) p.push(`question.answer.type must be one of ${ANSWER_TYPES.join(', ')}`)
  if ((q?.answer?.type === 'verdict' || q?.answer?.type === 'graded') && !(q.answer.options?.length >= 2)) p.push('question.answer.options needs at least two options')
  const pay = asc?.payment
  if (!(pay?.escrow > 0)) p.push('payment.escrow must be positive')
  if (!(pay?.bar > 0 && pay.bar <= 1)) p.push('payment.bar must be in (0, 1]')
  const j = pay?.jury
  if (!(j?.size >= 1)) p.push('payment.jury.size must be at least 1')
  if (!(j?.minLabs >= 1 && j.minLabs <= j.size)) p.push('payment.jury.minLabs must be between 1 and jury.size')
  const split = pay?.split ?? {}
  const total = ['jurors', 'auditors', 'storage', 'sealer'].reduce((s, k) => s + (split[k] ?? 0), 0)
  if (Math.abs(total - 1) > 1e-9) p.push('payment.split must sum to 1')
  if (!Array.isArray(asc?.exits) || asc.exits.length === 0) p.push('exits needs at least one entry')
  for (const [i, e] of (asc?.exits ?? []).entries()) {
    if (!EFFECT_TYPES.includes(e.effect?.type)) p.push(`exits[${i}].effect.type must be one of ${EFFECT_TYPES.join(', ')}`)
  }
  if (q?.answer?.type !== 'forecast') {
    const outcomes = new Set((asc?.exits ?? []).map(e => e.outcome))
    for (const o of q?.answer?.options ?? []) if (!outcomes.has(o)) p.push(`no exit for option "${o}"`)
  }
  if (!(asc?.exits ?? []).some(e => e.outcome === BELOW_BAR)) p.push(`an exit for "${BELOW_BAR}" is required`)
  return p
}
