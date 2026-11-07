/**
 * Screens: fast typed-answer models (System 1) in front of the juries.
 *
 * A screen has one method: decide(atom) -> { answer, p } where answer is in the
 * atom's answer type and p is the screen's probability that the answer is
 * right. It writes no reasoning and carries no proof.
 * @module @verafyharness/route/screens
 */
import { readAnswer } from '../../pack/src/atom.js'

/**
 * A scripted screen for tests and devnet. Answers by atom key or question text.
 * @param {Record<string, {answer: string, p: number}>} script - keyed by atom.q.
 * @param {object} [opts] - { usd: cost per call, ms: latency }.
 * @returns {{name: string, usd: number, ms: number, decide: Function}} the screen.
 */
export function mockScreen(script, { usd = 0.0004, ms = 300, name = 'mock-screen' } = {}) {
  return {
    name, usd, ms, closed: true, provable: false,
    async decide(atom) {
      const hit = script[atom.q]
      if (!hit) return { answer: null, p: 0 }
      return { answer: readAnswer(atom, hit.answer).ok ? readAnswer(atom, hit.answer).value : null, p: hit.p }
    },
  }
}

/**
 * An adapter for TypeSafe's Jev or any System 1 model. The vendor's API is
 * not public, so the adapter takes the call as a function: give it whatever
 * client you have. Keys come from the keyblock through the API router; this
 * adapter never sees one.
 *
 *   jevScreen({ call: async ({ question, facts, options }) => ({ label, probability }) })
 *
 * Figures from the vendor (not reproduced): 70 to 500 ms, about $0.0004 a
 * decision, 67.8% on its own benchmark against 73 to 74% for frontier models.
 * @param {object} opts
 * @param {Function} opts.call - the client call; returns { label, probability }.
 * @param {number} [opts.usd=0.0004] - cost per decision, vendor-reported.
 * @param {number} [opts.ms=300] - typical latency, vendor-reported range 70 to 500.
 * @returns {{name: string, usd: number, ms: number, decide: Function}} the screen.
 */
export function jevScreen({ call, usd = 0.0004, ms = 300 }) {
  if (typeof call !== 'function') throw new Error('jevScreen needs a call function; the vendor API is not public')
  return {
    name: 'jev', usd, ms, closed: true, provable: false,
    async decide(atom) {
      const a = atom.answer
      const options = a.type === 'yes-no' ? ['YES', 'NO'] : a.type === 'choice' ? a.options : null
      const res = await call({ question: atom.q, facts: (atom.facts ?? []).map(f => f.text), options, range: a.type === 'integer' ? [a.min, a.max] : null })
      const read = readAnswer(atom, String(res?.label ?? ''))
      const p = Number(res?.probability)
      if (!read.ok || !(p >= 0 && p <= 1)) return { answer: null, p: 0 }
      return { answer: read.value, p }
    },
  }
}
