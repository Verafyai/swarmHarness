/**
 * Atoms: the smallest independently checkable questions a contract breaks into.
 * An atom asks one thing, carries only the facts that decide it (each pinned to
 * a source), and has a closed answer type. Atoms are what proof packing packs.
 * @module @verafyharness/pack/atom
 */
import { sha256 } from '../../core/src/index.js'

export const ANSWER_TYPES = ['yes-no', 'choice', 'integer']

/**
 * Normalize question text so the same question hashes the same everywhere.
 * @param {string} q - question text.
 * @returns {string} trimmed, single-spaced, lower-cased text.
 */
export function normalizeQuestion(q) {
  return String(q).trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * The dedupe key of an atom: same question, same answer type, same evidence.
 * Two contracts that ask the same atomic question over the same pinned facts
 * share one slot and one proof.
 * @param {object} atom - an atom.
 * @returns {string} SHA-256 hex.
 */
export function atomKey(atom) {
  return sha256({
    q: normalizeQuestion(atom.q),
    answer: atom.answer,
    facts: (atom.facts ?? []).map(f => ({ text: String(f.text).trim(), pin: f.pin ?? null, loc: f.loc ?? null })),
    asOf: atom.asOf ?? null,
  })
}

/**
 * Check one atom.
 * @param {object} atom - the atom.
 * @param {object} [opts] - { maxFacts }.
 * @returns {string[]} problems; empty when valid.
 */
export function validateAtom(atom, { maxFacts = 8 } = {}) {
  const errs = []
  if (!atom || typeof atom !== 'object') return ['atom must be an object']
  if (typeof atom.q !== 'string' || !atom.q.trim()) errs.push('q must be a non-empty question')
  else {
    if ((atom.q.match(/\?/g) ?? []).length > 1) errs.push('q asks more than one question; split it')
    if (/\b(and|or)\b.*\?$/i.test(atom.q) && atom.answer?.type === 'yes-no' && /\b(both|either)\b/i.test(atom.q)) errs.push('q joins two questions; split it')
  }
  const a = atom.answer
  if (!a || !ANSWER_TYPES.includes(a.type)) errs.push(`answer.type must be one of ${ANSWER_TYPES.join(', ')}`)
  else if (a.type === 'choice' && (!Array.isArray(a.options) || a.options.length < 2)) errs.push('choice answers need two or more options')
  else if (a.type === 'integer' && !(Number.isInteger(a.min) && Number.isInteger(a.max) && a.min <= a.max)) errs.push('integer answers need integer min <= max')
  if (!Array.isArray(atom.facts)) errs.push('facts must be an array (it may be empty)')
  else {
    if (atom.facts.length > maxFacts) errs.push(`more than ${maxFacts} facts; the atom is not atomic`)
    atom.facts.forEach((f, i) => {
      if (!f || typeof f.text !== 'string' || !f.text.trim()) errs.push(`facts[${i}].text is required`)
      if (!f?.pin) errs.push(`facts[${i}] must cite a pinned source (pin)`)
    })
  }
  return errs
}

/**
 * Check and normalize an answer to an atom.
 * @param {object} atom - the atom.
 * @param {string} raw - the answer text from the model.
 * @returns {{ok: boolean, value?: (boolean|string|number|null)}} value null means UNKNOWN.
 */
export function readAnswer(atom, raw) {
  const t = String(raw).trim()
  if (/^unknown$/i.test(t)) return { ok: true, value: null }
  const a = atom.answer
  if (a.type === 'yes-no') {
    if (/^yes$/i.test(t)) return { ok: true, value: true }
    if (/^no$/i.test(t)) return { ok: true, value: false }
    return { ok: false }
  }
  if (a.type === 'choice') {
    const hit = a.options.find(o => o.toLowerCase() === t.toLowerCase())
    return hit ? { ok: true, value: hit } : { ok: false }
  }
  if (a.type === 'integer') {
    if (!/^-?\d+$/.test(t)) return { ok: false }
    const n = Number(t)
    return n >= a.min && n <= a.max ? { ok: true, value: n } : { ok: false }
  }
  return { ok: false }
}

/** The answer shape shown to the model, for one atom. */
export function answerShape(atom) {
  const a = atom.answer
  if (a.type === 'yes-no') return 'YES | NO | UNKNOWN'
  if (a.type === 'choice') return a.options.join(' | ') + ' | UNKNOWN'
  return `an integer from ${a.min} to ${a.max}${a.unit ? ' ' + a.unit : ''}, or UNKNOWN`
}
