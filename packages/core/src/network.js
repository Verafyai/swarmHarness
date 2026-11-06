/**
 * A network of harnesses: draw a jury that spans enough labs, run commit and
 * reveal, measure agreement, run the contract, and seal the ruling into a block.
 * This is Proof of Judgment: a block exists only because a jury ruled.
 * @module @verafyharness/core/network
 */
import { ascHash } from './asc.js'
import { checkReveal, verifyMessage } from './signer.js'
import { measure } from './agreement.js'
import { chooseExit, buildDiff, conserves, triggers } from './runtime.js'
import { sha256 } from './hash.js'

/**
 * Draw a jury from the pool: shuffle with a seed, then take harnesses until the
 * jury is full and spans at least `minLabs` labs.
 * @param {object[]} pool - available harnesses.
 * @param {{size: number, minLabs: number}} rules - jury rules from the contract.
 * @param {string} seed - randomness, such as the parent block hash.
 * @returns {object[]} the jury.
 */
export function drawJury(pool, rules, seed) {
  const order = [...pool].sort((a, b) => sha256(seed + a.id).localeCompare(sha256(seed + b.id)))
  const jury = []
  const labs = new Set()
  for (const h of order) {
    if (jury.length >= rules.size) break
    const needLabs = rules.minLabs - labs.size
    const seatsLeft = rules.size - jury.length
    if (!labs.has(h.lab) || seatsLeft > needLabs) { jury.push(h); labs.add(h.lab) }
  }
  if (jury.length < rules.size || labs.size < rules.minLabs) throw new Error(`pool cannot seat a jury of ${rules.size} across ${rules.minLabs} labs`)
  return jury
}

/**
 * Rule on one contract with one jury.
 * @param {object} asc - the contract.
 * @param {object[]} jury - the harnesses on the jury.
 * @param {object} sealer - the harness that assembles the block.
 * @param {(event: object) => void} [onEvent] - progress callback for UIs.
 * @returns {Promise<object>} the ruling.
 */
export async function rule(asc, jury, sealer, onEvent = () => {}) {
  const h = ascHash(asc)
  onEvent({ phase: 'propose', ascHash: h, jury: jury.map(j => j.card) })
  const settled = await Promise.allSettled(jury.map(j => j.commit(asc)))
  const commits = []
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled' && verifyMessage(jury[i].card.publicKey, s.value.attestation, s.value.signature)) commits.push(s.value)
    else onEvent({ phase: 'commit-failed', harness: jury[i].id, error: String(s.reason?.message ?? 'bad signature') })
  })
  onEvent({ phase: 'commit', commitments: commits.map(c => ({ harness: c.harness, commitment: c.commitment })) })
  const reveals = []
  for (const c of commits) {
    const j = jury.find(x => x.id === c.harness)
    const r = j.reveal(h)
    const ok = checkReveal(h, r.vote, r.salt, c.commitment) && verifyMessage(j.card.publicKey, { harness: r.harness, ascHash: h, vote: r.vote, salt: r.salt }, r.signature)
    if (ok) reveals.push({ ...r, lab: j.lab, model: j.model })
    else onEvent({ phase: 'reveal-failed', harness: j.id })
  }
  return tally(asc, reveals, sealer.id, onEvent)
}

/**
 * Measure agreement over verified reveals, run the contract, and build the ruling.
 * Shared by an in-process jury (`rule`) and by reveals collected from separate
 * harness processes (`ruleFromReveals`).
 * @param {object} asc - the contract.
 * @param {object[]} reveals - verified reveals, each with `harness`, `lab`, `model`, `vote`, `signature`.
 * @param {string} sealerId - the harness that assembles the block.
 * @param {(event: object) => void} [onEvent] - progress callback for UIs.
 * @returns {object} the ruling.
 */
export function tally(asc, reveals, sealerId, onEvent = () => {}) {
  const h = ascHash(asc)
  onEvent({ phase: 'reveal', votes: reveals.map(r => ({ harness: r.harness, lab: r.lab, answer: r.vote.answer, confidence: r.vote.confidence })) })
  const quorum = asc.payment.jury.quorum ?? Math.ceil(asc.payment.jury.size / 2)
  const labsRevealed = new Set(reveals.map(r => r.lab)).size
  const result = reveals.length >= quorum && labsRevealed >= Math.min(asc.payment.jury.minLabs, quorum)
    ? measure(asc.question, reveals.map(r => r.vote))
    : { answer: null, agreement: 0 }
  const { exit, passed } = chooseExit(asc, result)
  const diff = buildDiff(asc, exit, passed, reveals.map(r => r.harness), sealerId)
  if (!conserves(diff)) throw new Error('diff does not conserve totals; block rejected')
  const ruling = {
    ascHash: h,
    asc: asc.id,
    request: asc.question.prompt,
    contextHashes: asc.context.map(c => c.sha256),
    answer: result.answer,
    agreement: Math.round(result.agreement * 1000) / 1000,
    bar: asc.payment.bar,
    passed,
    exit: exit.outcome,
    effect: exit.effect,
    votes: reveals.map(r => ({ harness: r.harness, lab: r.lab, model: r.model, answer: r.vote.answer, confidence: r.vote.confidence, reasoningHash: sha256(r.vote.reasoning), signature: r.signature })),
    dissent: reveals.filter(r => isDissent(asc.question, r.vote.answer, result.answer)).map(r => ({ harness: r.harness, answer: r.vote.answer, reasoning: r.vote.reasoning })),
    diff,
    triggers: triggers(exit, passed),
  }
  onEvent({ phase: 'rule', ruling })
  return ruling
}

/**
 * Rule on one contract from commitments and reveals that separate harness
 * processes produced, such as DeepSeek Harness jurors. Each entry carries the
 * harness card it signed with. The jury is drawn from the submitted cards with
 * the parent block hash as seed, so only drawn harnesses are counted; every
 * attestation, commitment and reveal is checked before a vote counts.
 * @param {object} asc - the contract.
 * @param {{card: object, commit: {harness: string, commitment: string, attestation: object, signature: string}, reveal: {harness: string, ascHash: string, vote: object, salt: string, signature: string} | null}[]} entries - one per harness.
 * @param {string} sealerId - the harness that assembles the block.
 * @param {string} seed - the parent block hash, or 'genesis'.
 * @param {(event: object) => void} [onEvent] - progress callback for UIs.
 * @returns {object} the ruling.
 */
export function ruleFromReveals(asc, entries, sealerId, seed, onEvent = () => {}) {
  const h = ascHash(asc)
  const jury = drawJury(entries.map(e => e.card), asc.payment.jury, seed)
  const seated = new Set(jury.map(j => j.id))
  onEvent({ phase: 'propose', ascHash: h, jury })
  for (const e of entries) if (!seated.has(e.card.id)) onEvent({ phase: 'commit-failed', harness: e.card.id, error: 'not drawn for this jury' })
  const commits = []
  for (const e of entries.filter(x => seated.has(x.card.id))) {
    const { card, commit: c } = e
    const a = c.attestation
    const problem = c.harness !== card.id ? 'commitment names another harness'
      : a.harness !== card.id || a.lab !== card.lab || a.model !== card.model ? 'attestation does not match the harness card'
      : a.ascHash !== h ? 'commitment is for another contract'
      : a.commitment !== c.commitment ? 'attestation does not carry the commitment'
      : !verifyMessage(card.publicKey, a, c.signature) ? 'bad signature'
      : null
    if (problem) onEvent({ phase: 'commit-failed', harness: card.id, error: problem })
    else commits.push(e)
  }
  onEvent({ phase: 'commit', commitments: commits.map(e => ({ harness: e.card.id, commitment: e.commit.commitment })) })
  const reveals = []
  for (const { card, commit: c, reveal: r } of commits) {
    const ok = r && r.harness === card.id && r.ascHash === h
      && checkReveal(h, r.vote, r.salt, c.commitment)
      && verifyMessage(card.publicKey, { harness: r.harness, ascHash: h, vote: r.vote, salt: r.salt }, r.signature)
    if (ok) reveals.push({ ...r, lab: card.lab, model: card.model })
    else onEvent({ phase: 'reveal-failed', harness: card.id })
  }
  return tally(asc, reveals, sealerId, onEvent)
}

/**
 * Seal rulings into a block that links to its parent. A block with no rulings
 * cannot be sealed.
 * @param {{height: number, hash: string} | null} parent - the previous block.
 * @param {object[]} rulings - rulings to include.
 * @param {object} sealer - the sealing harness.
 * @returns {object} the block.
 */
export function seal(parent, rulings, sealer) {
  if (rulings.length === 0) throw new Error('no rulings, no block')
  const header = {
    height: (parent?.height ?? 0) + 1,
    parent: parent?.hash ?? '0'.repeat(64),
    rulingsRoot: sha256(rulings.map(r => sha256(r)).join('')),
    sealer: sealer.id,
    time: new Date().toISOString(),
  }
  return { ...header, hash: sha256(header), signature: sealer.sign(header), rulings }
}

/**
 * Whether a vote dissents from the ruling. For forecasts, a vote dissents when it
 * sits more than half the tolerance away from the median.
 * @param {object} question - the contract's question.
 * @param {unknown} vote - one revealed answer.
 * @param {unknown} answer - the ruling's answer.
 * @returns {boolean} whether the vote dissents.
 */
function isDissent(question, vote, answer) {
  if (question.answer.type === 'forecast') return Math.abs(Number(vote) - Number(answer)) > (question.answer.tolerance ?? 0.2) / 2
  return vote !== answer
}
