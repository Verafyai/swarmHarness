/**
 * Atom plans: how a contract's question becomes atoms, and the exact rule that
 * turns the atoms' answers back into one of the contract's outcomes.
 *
 * The AI answers atoms. The composition rule is code: integer math, no model,
 * every node gets the same result. An atom answered UNKNOWN never guesses; it
 * sends the contract to its declared fallback outcome.
 * @module @verafyharness/pack/plan
 */
import { sha256 } from '../../core/src/index.js'
import { validateAtom } from './atom.js'

export const PLAN_KIND = 'verafy.atomplan/1'

const BOOL_OPS = ['all', 'any', 'not', 'atLeast', 'eq', 'ge', 'le', 'atom']

/**
 * Collect the atom ids an expression reads.
 * @param {object} e - expression.
 * @param {Set<string>} [out] - accumulator.
 * @returns {Set<string>} atom ids.
 */
export function refs(e, out = new Set()) {
  if (e === null || typeof e !== 'object') return out
  if (typeof e.atom === 'string') out.add(e.atom)
  for (const v of Object.values(e)) {
    if (Array.isArray(v)) v.forEach(x => refs(x, out))
    else if (v && typeof v === 'object') refs(v, out)
  }
  return out
}

class Unknown extends Error {}

/**
 * Evaluate an expression against atom answers. Integers only; any UNKNOWN atom
 * the expression needs throws, so the caller can take the fallback.
 * Grammar:
 *   { atom: "a1" }                          the atom's answer
 *   { all: [e...] }, { any: [e...] }, { not: e }
 *   { atLeast: { k: 2, of: [e...] } }       at least k are true
 *   { eq: [e, value] }, { ge: [e, n] }, { le: [e, n] }
 *   { sum: [e...] }                         integers, or booleans as 0 and 1
 *   { weighted: { a1: 3, a2: 1 } }          sum of integer weights of true atoms
 * @param {object} e - expression.
 * @param {Record<string, any>} ans - atom id to answer (null means UNKNOWN).
 * @returns {boolean|number|string} the value.
 */
export function evaluate(e, ans) {
  if (typeof e !== 'object' || e === null) return e
  const val = id => {
    if (!(id in ans)) throw new Error(`no answer for atom ${id}`)
    if (ans[id] === null) throw new Unknown(id)
    return ans[id]
  }
  const num = x => {
    const v = evaluate(x, ans)
    if (typeof v === 'boolean') return v ? 1 : 0
    if (!Number.isInteger(v)) throw new Error('composition uses integers only')
    return v
  }
  if ('atom' in e) return val(e.atom)
  if ('all' in e) return e.all.every(x => evaluate(x, ans) === true)
  if ('any' in e) return e.any.some(x => evaluate(x, ans) === true)
  if ('not' in e) return evaluate(e.not, ans) !== true
  if ('atLeast' in e) return e.atLeast.of.filter(x => evaluate(x, ans) === true).length >= e.atLeast.k
  if ('eq' in e) return evaluate(e.eq[0], ans) === evaluate(e.eq[1], ans)
  if ('ge' in e) return num(e.ge[0]) >= num(e.ge[1])
  if ('le' in e) return num(e.le[0]) <= num(e.le[1])
  if ('sum' in e) return e.sum.reduce((s, x) => s + num(x), 0)
  if ('weighted' in e) {
    let s = 0
    for (const [id, w] of Object.entries(e.weighted)) {
      if (!Number.isInteger(w)) throw new Error('weights must be integers')
      if (val(id) === true) s += w
    }
    return s
  }
  throw new Error(`unknown expression ${Object.keys(e).join(',')}`)
}

/**
 * Decide a contract's outcome from its atoms' answers.
 * @param {object} plan - an atom plan.
 * @param {Record<string, any>} answers - atom id to answer, null for UNKNOWN.
 * @returns {{outcome: string, params: object, unknown?: string}} the decision.
 */
export function decide(plan, answers) {
  try {
    for (const rule of plan.decide) {
      if ('else' in rule) return { outcome: rule.else, params: {} }
      if (evaluate(rule.when, answers) === true) {
        const params = {}
        for (const [k, e] of Object.entries(rule.params ?? {})) params[k] = evaluate(e, answers)
        return { outcome: rule.outcome, params }
      }
    }
    return { outcome: plan.onUnknown, params: {}, unknown: 'no rule matched' }
  } catch (err) {
    if (err instanceof Unknown) return { outcome: plan.onUnknown, params: {}, unknown: err.message }
    throw err
  }
}

/**
 * Check an atom plan against its contract.
 * @param {object} plan - the plan.
 * @param {object} [contract] - the contract it decomposes; its answer options bound the outcomes.
 * @returns {string[]} problems; empty when valid.
 */
export function validatePlan(plan, contract) {
  const errs = []
  if (plan?.kind !== PLAN_KIND) errs.push(`kind must be ${PLAN_KIND}`)
  if (!Array.isArray(plan?.atoms) || !plan.atoms.length) return [...errs, 'a plan needs at least one atom']
  const ids = new Set()
  plan.atoms.forEach((a, i) => {
    if (typeof a.id !== 'string' || !a.id) errs.push(`atoms[${i}].id is required`)
    else if (ids.has(a.id)) errs.push(`duplicate atom id ${a.id}`)
    else ids.add(a.id)
    validateAtom(a).forEach(m => errs.push(`atom ${a.id ?? i}: ${m}`))
  })
  if (!Array.isArray(plan.decide) || !plan.decide.length) errs.push('decide must list at least one rule')
  else {
    const last = plan.decide[plan.decide.length - 1]
    if (!('else' in last)) errs.push('the last decide rule must be { else: outcome }')
    for (const r of plan.decide) {
      for (const id of refs(r)) if (!ids.has(id)) errs.push(`decide reads unknown atom ${id}`)
      if ('when' in r && !BOOL_OPS.some(op => op in r.when)) errs.push('a decide rule needs a boolean when')
    }
  }
  const used = new Set(plan.decide?.flatMap(r => [...refs(r)]) ?? [])
  for (const id of ids) if (!used.has(id)) errs.push(`atom ${id} is never used by the decide rules; drop it`)
  const options = contract?.question?.answer?.options
  if (Array.isArray(options)) {
    const outs = [...(plan.decide ?? []).map(r => r.outcome ?? r.else), plan.onUnknown]
    for (const o of outs) if (!options.includes(o)) errs.push(`outcome ${o} is not one of the contract's options (${options.join(', ')})`)
  }
  if (!plan.onUnknown) errs.push('onUnknown names the outcome when a needed atom is UNKNOWN')
  return errs
}

/** The plan's hash, pinned next to the contract so every node checks the same plan. */
export function planHash(plan) {
  return sha256(plan)
}
