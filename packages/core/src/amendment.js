/**
 * Amendments: the `verafy.amendment/1` contract kind from the draft Verafy Chain
 * Constitution (Article 5) and its AMENDMENTS.md. An amendment extends the
 * Constitution or its Embedded Ethics. It never rewrites Block 0: the current
 * text is always Block 0 plus every sealed amendment, applied in order.
 *
 *   validateAmendment   the format: one target, declared exits, the four kinds
 *   entrenchment        whether an amendment touches an entrenched clause, and
 *                       whether its kind could weaken one (only Extend and
 *                       Clarify may touch an entrenched clause)
 *   amendmentHash       the amendment's identity, SHA-256 over canonical JSON
 *
 * Everything here is format and structure. Whether an amendment conflicts with
 * the Constitution, breaks the Embedded Ethics, or should be adopted is ruled by
 * panels of harnesses on the chain (verafyChain), never by this module. The
 * structural rule is a floor under the constitution check, not a substitute for it.
 *
 * Draft 0: nothing here is ratified. The draft parameters live in the chain config.
 * @module @verafyharness/core/amendment
 */
import { sha256 } from './hash.js'

export const AMENDMENT_KIND = 'verafy.amendment/1'

/** The four things an amendment can do (AMENDMENTS.md, "What an amendment can do"). */
export const AMENDMENT_KINDS = ['extend', 'clarify', 'reclassify', 'supersede']

/** The declared exits of every amendment, in order. */
export const AMENDMENT_EXITS = ['adopt', 'reject', 'revise']

/** The seven stages, in order (Article 5). No stage can be skipped. */
export const AMENDMENT_STAGES = ['propose', 'comment', 'constitution-check', 'ethics-check', 'merit', 'challenge', 'seal']

/** The lists of the Embedded Ethics an amendment may target. */
export const ETHICS_LISTS = ['ethics.allowed', 'ethics.neverAllowed', 'ethics.caseByCase']

/**
 * The entrenched clauses, as Article 5 lists them. An amendment may make them
 * stricter or clearer, never narrower or weaker. `targets` are the target ids
 * that name the clause or the article that holds it.
 */
export const ENTRENCHED = Object.freeze([
  { clause: 'Article 1', targets: ['constitution.article.1'] },
  { clause: 'The "Never allowed" list in the Embedded Ethics', targets: ['ethics.neverAllowed'] },
  { clause: 'Article 3.5 (no bypass)', targets: ['constitution.article.3.5'] },
  { clause: 'Article 2.3 and the two checks in Article 5', targets: ['constitution.article.2.3', 'constitution.article.5'] },
  { clause: 'The rule that Block 0 is never edited', targets: ['constitution.article.5'] },
])

/** Kinds that may touch an entrenched clause: stricter (Extend) or clearer (Clarify). */
export const ENTRENCHED_KINDS = ['extend', 'clarify']

const TARGET = /^(constitution\.article\.[1-6](\.[1-9][0-9]?)?|ethics\.(allowed|neverAllowed|caseByCase)|amendment:A-[1-9][0-9]*)$/
const ID = /^A-[1-9][0-9]*$/
const PIN = /^sha256:[0-9a-f]{64}$/

/**
 * The amendment's identity: SHA-256 over its canonical JSON.
 * @param {object} a - the amendment.
 * @returns {string} SHA-256 hex.
 */
export function amendmentHash(a) {
  return sha256(a)
}

/**
 * Check an amendment's format and return every problem found. Format only:
 * one target, declared exits, a known kind, the text and reasons, the cites and
 * the escrow. Weakening an entrenched clause is not a format error; it fails the
 * constitution check (see `entrenchment`).
 * @param {object} a - the amendment.
 * @returns {string[]} human-readable problems; empty when valid.
 */
export function validateAmendment(a) {
  const p = []
  if (a?.kind !== AMENDMENT_KIND) p.push(`kind must be "${AMENDMENT_KIND}"`)
  if (!ID.test(a?.id ?? '')) p.push('id must be A-1, A-2 and so on, assigned in order of posting')
  if (!AMENDMENT_KINDS.includes(a?.amendmentKind)) p.push(`amendmentKind must be one of ${AMENDMENT_KINDS.join(', ')}`)
  if (Array.isArray(a?.target)) p.push('target names exactly one article, list or earlier amendment: one amendment changes one thing (no bundling)')
  else if (!TARGET.test(a?.target ?? '')) p.push('target must name one article (constitution.article.N or constitution.article.N.M), one ethics list (ethics.allowed, ethics.neverAllowed, ethics.caseByCase) or one earlier amendment (amendment:A-N)')
  if (a?.amendmentKind === 'supersede' && !String(a?.target ?? '').startsWith('amendment:')) p.push('a supersede amendment replaces an earlier amendment, so its target is amendment:A-N')
  if (String(a?.target ?? '') === `amendment:${a?.id}`) p.push('an amendment cannot target itself')
  if (!Array.isArray(a?.cites) || !a.cites.includes('block:0')) p.push('cites must include "block:0"')
  else if (!a.cites.every(c => typeof c === 'string' && c)) p.push('cites must be a list of names')
  if (typeof a?.text !== 'string' || !a.text.trim()) p.push('text is required: the exact text to add')
  if (typeof a?.reasons !== 'string' || !a.reasons.trim()) p.push('reasons are required')
  if (!Array.isArray(a?.context)) p.push('context must be a list')
  for (const [i, c] of (a?.context ?? []).entries()) {
    if (typeof c?.role !== 'string' || !c.role) p.push(`context[${i}].role is required`)
    if (!PIN.test(c?.pin ?? '')) p.push(`context[${i}].pin must be sha256:<64 hex>`)
  }
  const pay = a?.payment
  if (typeof pay?.asset !== 'string' || !pay.asset) p.push('payment.asset must name an existing coin')
  if (typeof pay?.chain !== 'string' || !pay.chain) p.push('payment.chain is required')
  if (!(typeof pay?.escrow === 'number' && pay.escrow > 0)) p.push('payment.escrow must be a positive amount')
  if (!Array.isArray(a?.exits) || a.exits.length !== AMENDMENT_EXITS.length || !AMENDMENT_EXITS.every((e, i) => a.exits[i] === e)) p.push(`exits must be exactly ${AMENDMENT_EXITS.map(e => JSON.stringify(e)).join(', ')}`)
  if (a?.proposer !== undefined) {
    const hs = a.proposer?.harnesses
    if (!Array.isArray(hs) || !hs.every(h => typeof h === 'string' && h)) p.push('proposer.harnesses must be a list of harness ids (empty when the proposer runs none)')
  }
  return p
}

/**
 * Whether a target names, holds, or sits inside an entrenched clause.
 * `constitution.article.3` holds 3.5; `constitution.article.1.7` sits inside Article 1.
 */
function touches(target, clauseTarget) {
  return target === clauseTarget || clauseTarget.startsWith(`${target}.`) || target.startsWith(`${clauseTarget}.`)
}

/**
 * The entrenchment floor under the constitution check. An amendment that touches
 * an entrenched clause may only Extend (stricter) or Clarify (clearer) it. A
 * Reclassify or Supersede that touches one (a Supersede touches the clause its
 * earlier amendment targeted) could narrow or weaken it, so it fails.
 * Whether an Extend or Clarify weakens a clause by redefining its words is for
 * the constitution check panel; this rule never lets one through that the panel stops.
 * @param {object} a - the amendment.
 * @param {(id: string) => (object | null)} [earlier] - an earlier amendment by id, for supersede.
 * @returns {{touches: string[], weakens: boolean, problems: string[]}} the clauses touched and why it fails, if it does.
 */
export function entrenchment(a, earlier = () => null) {
  const target = String(a?.target ?? '')
  let effective = target
  if (target.startsWith('amendment:')) effective = earlier(target.slice('amendment:'.length))?.target ?? target
  const hit = ENTRENCHED.filter(e => e.targets.some(t => touches(effective, t))).map(e => e.clause)
  const problems = []
  if (hit.length && !ENTRENCHED_KINDS.includes(a?.amendmentKind)) problems.push(`${a?.amendmentKind} cannot touch an entrenched clause (${hit.join('; ')}); entrenched clauses can be made stricter or clearer, never narrower or weaker`)
  return { touches: hit, weakens: problems.length > 0, problems }
}
