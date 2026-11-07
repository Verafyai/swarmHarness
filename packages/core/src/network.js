/**
 * A network of harnesses: draw a jury that spans enough labs, run commit and
 * reveal, measure agreement, run the contract, and seal the ruling into a block.
 * This is Proof of Judgment: a block exists only because a jury ruled.
 *
 * Every ruling is computed by one pure function over recorded messages,
 * `ruleFromRecords`, and carries its `round` (seed, jury cards, commitments,
 * reveals with salts, faults, sealer account), so any node can re-verify it from
 * the ruling alone with `verifyRuling`.
 * @module @verafyharness/core/network
 */
import { ascHash, validate } from './asc.js'
import { checkReveal, verifyMessage } from './signer.js'
import { measure } from './agreement.js'
import { chooseExit, buildDiff, conserves, triggers, accountFor, checkPay } from './runtime.js'
import { aggregateParams } from './exitprogram.js'
import { PROOF_HASH } from './juror.js'
import { sha256, canonical } from './hash.js'
import { needsProofs, gateProofs, finality, checkProofCheck } from './proving.js'

/**
 * Harnesses a contract may seat: bonded for the most value one vote can decide
 * (`payment.maxValuePerVote`), and not excluded by the jury rules
 * (`excludeLabs`, `excludeHarnesses`, used by escalated and challenge juries).
 * @param {object[]} pool - harnesses or harness cards.
 * @param {object} asc - the contract.
 * @returns {object[]} the eligible harnesses, in the order given.
 */
export function eligibleJurors(pool, asc) {
  return filterPool(pool, asc.payment.jury, asc.payment.maxValuePerVote ?? 0)
}

function filterPool(pool, rules, minBond) {
  const labs = new Set(rules.excludeLabs ?? [])
  const ids = new Set(rules.excludeHarnesses ?? [])
  return pool.filter(h => !labs.has(h.lab) && !ids.has(h.id) && (minBond > 0 ? Number(h.bond) >= minBond : true))
}

/**
 * Draw a jury from the pool: drop harnesses whose bond is below `minBond` or
 * that the rules exclude, shuffle with a seed, then take harnesses until the
 * jury is full and spans at least `minLabs` labs. Filtering does not change the
 * order of the harnesses that remain, so a caller that filters first draws the
 * same jury.
 * @param {object[]} pool - available harnesses.
 * @param {{size: number, minLabs: number, excludeLabs?: string[], excludeHarnesses?: string[]}} rules - jury rules from the contract.
 * @param {string} seed - randomness, such as the parent block hash.
 * @param {{minBond?: number}} [options] - the contract's `payment.maxValuePerVote`.
 * @returns {object[]} the jury.
 */
export function drawJury(pool, rules, seed, { minBond = 0 } = {}) {
  const eligible = filterPool(pool, rules, minBond)
  const order = [...eligible].sort((a, b) => sha256(seed + a.id).localeCompare(sha256(seed + b.id)))
  const jury = []
  const labs = new Set()
  for (const h of order) {
    if (jury.length >= rules.size) break
    const needLabs = rules.minLabs - labs.size
    const seatsLeft = rules.size - jury.length
    if (!labs.has(h.lab) || seatsLeft > needLabs) { jury.push(h); labs.add(h.lab) }
  }
  if (jury.length < rules.size || labs.size < rules.minLabs) throw new Error(`pool cannot seat a jury of ${rules.size} across ${rules.minLabs} labs${minBond > 0 ? ` bonded for ${minBond}` : ''}`)
  return jury
}

/**
 * Draw the jury for a contract, applying its bond floor and exclusions.
 * @param {object} asc - the contract.
 * @param {object[]} pool - available harnesses.
 * @param {string} seed - the parent block hash, or 'genesis'.
 * @returns {object[]} the jury.
 */
export function drawJuryFor(asc, pool, seed) {
  return drawJury(pool, asc.payment.jury, seed, { minBond: asc.payment.maxValuePerVote ?? 0 })
}

/**
 * Check one recorded commitment against the juror's card.
 * @param {{id: string, lab: string, model: string, publicKey: string}} card - the juror.
 * @param {{harness: string, commitment: string, attestation: object, signature: string}} c - the commitment.
 * @param {string} h - the contract hash.
 * @returns {string | null} the problem, or null when it checks.
 */
export function checkCommit(card, c, h) {
  const a = c?.attestation ?? {}
  return !c ? 'no commitment'
    : c.harness !== card.id ? 'commitment names another harness'
    : a.harness !== card.id || a.lab !== card.lab || a.model !== card.model ? 'attestation does not match the harness card'
    : a.ascHash !== h ? 'commitment is for another contract'
    : a.commitment !== c.commitment ? 'attestation does not carry the commitment'
    : !safeVerify(card.publicKey, a, c.signature) ? 'bad signature'
    : null
}

/**
 * Check one recorded reveal against the juror's card and accepted commitment.
 * A vote may carry a `proofHash`; it may never carry a proof.
 * @param {{id: string, publicKey: string}} card - the juror.
 * @param {{commitment: string}} c - the accepted commitment.
 * @param {{harness: string, ascHash: string, vote: object, salt: string, signature: string} | null | undefined} r - the reveal.
 * @param {string} h - the contract hash.
 * @returns {string | null} the problem, or null when it checks.
 */
export function checkRevealRecord(card, c, r, h) {
  if (!r) return 'never revealed'
  if (r.harness !== card.id) return 'reveal names another harness'
  if (r.ascHash !== h) return 'reveal is for another contract'
  if (!r.vote || typeof r.vote !== 'object') return 'reveal carries no vote'
  if ('proof' in r.vote || 'proofs' in r.vote) return 'proofs stay off chain; a vote may carry a proofHash only'
  if (r.vote.proofHash !== undefined && !PROOF_HASH.test(String(r.vote.proofHash))) return 'proofHash is not a SHA-256 hex digest'
  if (!checkReveal(h, r.vote, r.salt, c.commitment)) return 'reveal does not match its commitment'
  if (!safeVerify(card.publicKey, { harness: r.harness, ascHash: h, vote: r.vote, salt: r.salt }, r.signature)) return 'bad reveal signature'
  return null
}

function safeVerify(publicKey, message, signature) {
  try { return typeof signature === 'string' && verifyMessage(publicKey, message, signature) } catch { return false }
}

/**
 * The quorum and labs-revealed checks: a jury rules only when at least the
 * contract's quorum revealed, from at least min(minLabs, quorum) labs. Below
 * that, the ruling's agreement is 0 and it takes the below-bar exit.
 * @param {object} asc - the contract.
 * @param {{lab: string}[]} reveals - counted reveals, each with its juror's lab.
 * @returns {{ok: boolean, quorum: number, revealed: number, labsRevealed: number, labsNeeded: number, problems: string[]}} the result.
 */
export function checkQuorum(asc, reveals) {
  const j = asc.payment.jury
  const quorum = j.quorum ?? Math.ceil(j.size / 2)
  const revealed = reveals.length
  const labsRevealed = new Set(reveals.map(r => r.lab)).size
  const labsNeeded = Math.min(j.minLabs, quorum)
  const problems = []
  if (revealed < quorum) problems.push(`${revealed} of ${j.size} revealed; the quorum is ${quorum}`)
  if (labsRevealed < labsNeeded) problems.push(`reveals span ${labsRevealed} labs; ${labsNeeded} are needed`)
  return { ok: problems.length === 0, quorum, revealed, labsRevealed, labsNeeded, problems }
}

/**
 * A ruling's id: the SHA-256 of the ruling as sealed. Challenges, reviews,
 * audits and triggers name rulings by this id.
 * @param {object} ruling - the ruling.
 * @returns {string} SHA-256 hex.
 */
export function rulingId(ruling) {
  return sha256(ruling)
}

/**
 * Rule on one contract from recorded commitments and reveals. Pure and
 * synchronous: it never calls a harness, so a node can run its own commit and
 * reveal rounds over any transport, with any timeouts, and hand over what it
 * recorded. Every attestation, commitment and reveal is checked against the
 * jury's cards before a vote counts.
 *
 * A juror that never committed, or committed and never revealed a matching vote,
 * is not counted and is listed in `round.faults` (`no-commit`, `no-reveal`), for
 * slashing later. Nothing throws for a missing reveal.
 * @param {object} asc - the contract.
 * @param {object[]} commits - recorded commitments, `{harness, commitment, attestation, signature}`.
 * @param {object[]} reveals - recorded reveals, `{harness, ascHash, vote, salt, signature}`.
 * @param {{jury: object[], sealer: string | object, seed?: string | null, onEvent?: (event: object) => void}} options -
 *   `jury` is the seated jurors' cards (`id`, `lab`, `model`, `bond`, `publicKey`), in draw order;
 *   `sealer` is a harness id, an account such as `node:node-1`, or a card (see `accountFor`);
 *   `seed` is the parent block hash the jury was drawn with.
 *   For an L2 contract, also `proofRecords` (proof records received before the
 *   proof deadline) and `proofChecks` (verification results): a vote counts only
 *   with a proof that verifies (see `proving.js`); the rest are dropped with a
 *   `no-proof` or `bad-proof` fault, and agreement is measured without them.
 * @returns {object} the ruling, with its `round`.
 */
export function ruleFromRecords(asc, commits, reveals, options) {
  return recordRound(asc, commits, reveals, { ...options, announce: true })
}

function recordRound(asc, commits, reveals, { jury, sealer, seed = null, onEvent = () => {}, announce, proofRecords = [], proofChecks = [] }) {
  if (!Array.isArray(jury) || jury.length === 0) throw new Error('ruleFromRecords needs the jury cards')
  if (sealer === undefined || sealer === null) throw new Error('ruleFromRecords needs a sealer')
  const h = ascHash(asc)
  const cards = jury.map(j => ({ id: j.id, lab: j.lab, model: j.model, bond: j.bond, publicKey: j.publicKey, ...(j.modelCommitment ? { modelCommitment: j.modelCommitment } : {}) }))
  const seated = new Map(cards.map(c => [c.id, c]))
  if (announce) onEvent({ phase: 'propose', ascHash: h, jury: cards })

  const byHarness = new Map()
  for (const c of commits ?? []) {
    if (!c) continue
    if (!seated.has(c.harness)) { onEvent({ phase: 'commit-failed', harness: c.harness, error: 'not drawn for this jury' }); continue }
    const list = byHarness.get(c.harness) ?? []
    list.push(c)
    byHarness.set(c.harness, list)
  }
  const accepted = []
  const faults = []
  for (const card of cards) {
    const list = byHarness.get(card.id) ?? []
    const distinct = new Set(list.map(c => c.commitment))
    const problem = list.length === 0 ? null
      : distinct.size > 1 ? 'two different commitments for one contract'
      : checkCommit(card, list[0], h)
    if (list.length === 0 || problem) {
      if (problem) onEvent({ phase: 'commit-failed', harness: card.id, error: problem })
      faults.push({ harness: card.id, fault: 'no-commit' })
      continue
    }
    const { harness, commitment, attestation, signature } = list[0]
    accepted.push({ harness, commitment, attestation, signature })
  }
  onEvent({ phase: 'commit', commitments: accepted.map(c => ({ harness: c.harness, commitment: c.commitment })) })

  const counted = []
  for (const c of accepted) {
    const card = seated.get(c.harness)
    const candidates = (reveals ?? []).filter(r => r?.harness === c.harness)
    const r = candidates.find(x => checkRevealRecord(card, c, x, h) === null)
    if (r) {
      counted.push({ harness: r.harness, ascHash: r.ascHash, vote: r.vote, salt: r.salt, signature: r.signature })
    } else {
      onEvent({ phase: 'reveal-failed', harness: c.harness, error: checkRevealRecord(card, c, candidates[0], h) })
      faults.push({ harness: c.harness, fault: 'no-reveal' })
    }
  }
  let proven = counted
  let proving = null
  if (needsProofs(asc)) {
    const g = gateProofs(asc, h, seated, accepted, counted, proofRecords, proofChecks)
    for (const d of g.dropped) onEvent({ phase: 'proof-failed', harness: d.harness, fault: d.fault, error: d.reason })
    faults.push(...g.faults)
    proven = g.proven
    proving = { proofRecords: g.proofRecords, proofChecks: g.proofChecks }
  }
  const order = new Map(cards.map((c, i) => [c.id, i]))
  faults.sort((a, b) => order.get(a.harness) - order.get(b.harness))
  const round = { seed, sealer: accountFor(sealer), jury: cards, commits: accepted, reveals: counted, faults, ...(proving ?? {}) }
  const withLabs = proven.map(r => ({ ...r, lab: seated.get(r.harness).lab, model: seated.get(r.harness).model }))
  return tally(asc, withLabs, sealer, onEvent, round)
}

/**
 * Rule on one contract with one jury of harness objects (in-process, or any
 * object with `card`, `commit(asc)` and `reveal(ascHash)`; either may be async).
 * Runs the commit round, then the reveal round, then rules from what it
 * recorded with `ruleFromRecords`. A juror whose commit or reveal fails or
 * throws is dropped and recorded as a fault; the ruling goes on without it.
 * @param {object} asc - the contract.
 * @param {object[]} jury - the harnesses on the jury.
 * @param {object} sealer - the harness that assembles the block (anything with an `id`).
 * @param {((event: object) => void) | {onEvent?: Function, seed?: string, sealerAccount?: string | object}} [onEvent] -
 *   a progress callback for UIs, or an options object. `sealerAccount` overrides
 *   the account the sealer is paid into (default `harness:<sealer.id>`).
 * @param {{seed?: string, sealerAccount?: string | object}} [options] - the same options when the fourth argument is a callback.
 * @returns {Promise<object>} the ruling.
 */
export async function rule(asc, jury, sealer, onEvent, options = {}) {
  const opts = typeof onEvent === 'function' ? { ...options, onEvent } : { ...(onEvent ?? {}), ...options }
  const emit = opts.onEvent ?? (() => {})
  const h = ascHash(asc)
  const cards = jury.map(j => j.card)
  emit({ phase: 'propose', ascHash: h, jury: cards })
  const settled = await Promise.allSettled(jury.map(j => j.commit(asc)))
  const commits = []
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') commits.push(s.value)
    else emit({ phase: 'commit-failed', harness: jury[i].id, error: String(s.reason?.message ?? s.reason) })
  })
  // The reveal round opens only after the commit round closes.
  const reveals = []
  for (const c of commits) {
    const j = jury.find(x => x.id === c?.harness)
    if (!j) continue
    try { reveals.push(await j.reveal(h)) } catch (err) { reveals.push(null); emit({ phase: 'reveal-failed', harness: j.id, error: String(err?.message ?? err) }) }
  }
  const thrown = new Set(jury.filter((j, i) => settled[i].status === 'fulfilled').map(j => j.id).filter(id => !reveals.some(r => r?.harness === id)))
  return recordRound(asc, commits, reveals.filter(Boolean), {
    jury: cards,
    sealer: opts.sealerAccount ?? sealer,
    seed: opts.seed ?? null,
    announce: false,
    // A reveal that threw was already reported above; do not report it twice.
    onEvent: e => { if (!(e.phase === 'reveal-failed' && thrown.has(e.harness))) emit(e) },
  })
}

/**
 * Measure agreement over verified reveals, run the contract, and build the ruling.
 * Shared by every ruling path. Callers normally use `ruleFromRecords`.
 * @param {object} asc - the contract.
 * @param {object[]} reveals - verified reveals, each with `harness`, `lab`, `model`, `vote`, `signature`.
 * @param {string | object} sealer - the sealer: a harness id, an account, or a card (see `accountFor`).
 * @param {(event: object) => void} [onEvent] - progress callback for UIs.
 * @param {object} [round] - the round record to keep with the ruling.
 * @returns {object} the ruling.
 */
export function tally(asc, reveals, sealer, onEvent = () => {}, round) {
  const h = ascHash(asc)
  onEvent({ phase: 'reveal', votes: reveals.map(r => ({ harness: r.harness, lab: r.lab, answer: r.vote.answer, confidence: r.vote.confidence })) })
  const q = checkQuorum(asc, reveals)
  const result = q.ok ? measure(asc.question, reveals.map(r => r.vote)) : { answer: null, agreement: 0 }
  const { exit, passed } = chooseExit(asc, result)
  const diff = buildDiff(asc, exit, passed, reveals.map(r => r.harness), sealer)
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
    votes: reveals.map(r => ({ harness: r.harness, lab: r.lab, model: r.model, answer: r.vote.answer, confidence: r.vote.confidence, reasoningHash: sha256(r.vote.reasoning), proofHash: r.vote.proofHash ?? r.proofHash, signature: r.signature })),
    dissent: reveals.filter(r => isDissent(asc.question, r.vote.answer, result.answer)).map(r => ({ harness: r.harness, answer: r.vote.answer, reasoning: r.vote.reasoning })),
    diff,
    triggers: triggers(exit, passed),
    params: exit.exitProgram && passed && Object.keys(exit.exitProgram.params ?? {}).length ? aggregateParams(exit.exitProgram.params, reveals.map(r => r.vote), result.answer) : undefined,
    round,
  }
  onEvent({ phase: 'rule', ruling })
  return ruling
}

/**
 * Rule on one contract from commitments and reveals that separate harness
 * processes produced, such as DeepSeek Harness jurors. Each entry carries the
 * harness card it signed with. The jury is drawn from the submitted cards with
 * the parent block hash as seed (bond floor applied), so only drawn harnesses
 * are counted; every attestation, commitment and reveal is checked before a
 * vote counts.
 * @param {object} asc - the contract.
 * @param {{card: object, commit: {harness: string, commitment: string, attestation: object, signature: string}, reveal: {harness: string, ascHash: string, vote: object, salt: string, signature: string} | null}[]} entries - one per harness.
 * @param {string | object} sealer - the sealer: a harness id, an account, or a card.
 * @param {string} seed - the parent block hash, or 'genesis'.
 * @param {(event: object) => void} [onEvent] - progress callback for UIs.
 * @returns {object} the ruling.
 */
export function ruleFromReveals(asc, entries, sealer, seed, onEvent = () => {}) {
  const jury = drawJuryFor(asc, entries.map(e => e.card), seed)
  const seated = new Set(jury.map(j => j.id))
  const commits = []
  const reveals = []
  const early = []
  for (const e of entries) {
    if (!seated.has(e.card.id)) { early.push({ phase: 'commit-failed', harness: e.card.id, error: 'not drawn for this jury' }); continue }
    // A commitment is attributed to the card it arrived with; one naming another harness is dropped.
    if (e.commit?.harness !== e.card.id) { early.push({ phase: 'commit-failed', harness: e.card.id, error: 'commitment names another harness' }); continue }
    commits.push(e.commit)
    if (e.reveal) reveals.push(e.reveal)
  }
  return ruleFromRecords(asc, commits, reveals, {
    jury, sealer, seed,
    onEvent: e => { onEvent(e); if (e.phase === 'propose') early.splice(0).forEach(onEvent) },
  })
}

/**
 * Re-verify a sealed ruling from the ruling alone, plus whatever the verifier
 * already trusts (registered cards, the pool and the parent hash). Checks, in order:
 *
 *   contract hash, context pins, and a valid contract
 *   no proofs on chain, and a round record is present
 *   jury: size, labs, bond floor, exclusions, registered cards, and the seeded draw
 *   every commitment and counted reveal (signatures, salts, proof hashes)
 *   declared exit and declared options only
 *   quorum and labs revealed (`checkQuorum`)
 *   pay rules (`checkPay`)
 *   the ruling is exactly what `ruleFromRecords` computes from its round
 *
 * @param {object} asc - the contract.
 * @param {object} ruling - the sealed ruling. Extra envelope fields a chain adds are ignored.
 * @param {{cards?: Map<string, object> | object[], pool?: object[], seed?: string, verifiers?: Map<string, string>}} [options] -
 *   `cards`: registered harness cards to check the jury against; `pool`: the
 *   pool the jury was drawn from, to re-run the draw; `seed`: the parent hash
 *   the verifier expects.
 *   `verifiers`: verifier id to public key, to check the signatures on an L2
 *   round's proof checks. An L2 ruling must also be final (`finality`).
 * @returns {{ok: boolean, problems: string[]}} the result, with every reason found.
 */
export function verifyRuling(asc, ruling, { cards, pool, seed, verifiers } = {}) {
  const p = []
  const done = () => ({ ok: p.length === 0, problems: p })
  const h = ascHash(asc)
  if (ruling?.ascHash !== h) p.push('ruling is for another contract')
  const invalid = validate(asc)
  if (invalid.length) p.push(`contract is invalid: ${invalid.join('; ')}`)
  if (canonical(ruling?.contextHashes) !== canonical(asc.context.map(c => c.sha256))) p.push('ruling cites context hashes the contract did not pin')
  const proofAt = findKey(ruling, k => k === 'proof' || k === 'proofs')
  if (proofAt) p.push(`proofs stay off chain; found "${proofAt}"`)
  const round = ruling?.round
  if (!round || !Array.isArray(round.jury) || !Array.isArray(round.commits) || !Array.isArray(round.reveals)) { p.push('ruling carries no round record'); return done() }

  const rules = asc.payment.jury
  const jury = round.jury
  if (jury.length !== rules.size) p.push(`jury has ${jury.length} seats; the contract asks for ${rules.size}`)
  const labs = new Set(jury.map(c => c.lab))
  if (labs.size < rules.minLabs) p.push(`jury spans ${labs.size} labs; the contract requires ${rules.minLabs}`)
  const minBond = asc.payment.maxValuePerVote ?? 0
  for (const c of jury) {
    if (minBond > 0 && !(Number(c.bond) >= minBond)) p.push(`${c.id} bonds ${c.bond}, below ${minBond} per vote`)
    if ((rules.excludeLabs ?? []).includes(c.lab)) p.push(`${c.id} is from ${c.lab}, a lab this jury excludes`)
    if ((rules.excludeHarnesses ?? []).includes(c.id)) p.push(`${c.id} is excluded from this jury`)
  }
  if (cards) {
    const reg = cards instanceof Map ? cards : new Map(cards.map(c => [c.id, c]))
    for (const c of jury) {
      const r = reg.get(c.id)
      if (!r) p.push(`juror ${c.id} is not registered`)
      else if (r.publicKey !== c.publicKey || r.lab !== c.lab || r.model !== c.model || (r.modelCommitment ?? null) !== (c.modelCommitment ?? null)) p.push(`juror ${c.id} card does not match its registration`)
    }
  }
  if (seed !== undefined && round.seed !== seed) p.push('jury seed is not the expected parent hash')
  if (pool) {
    try {
      const drawn = drawJuryFor(asc, pool, round.seed).map(x => x.id)
      if (canonical(drawn) !== canonical(jury.map(c => c.id))) p.push(`jury is not the seeded draw (expected ${drawn.join(', ')})`)
    } catch (err) { p.push(`jury cannot be redrawn: ${err.message}`) }
  }

  const byId = new Map(jury.map(c => [c.id, c]))
  const commitBy = new Map()
  for (const c of round.commits) {
    const card = byId.get(c?.harness)
    if (!card) { p.push(`${c?.harness} committed but is not on the jury`); continue }
    if (commitBy.has(c.harness)) { p.push(`${c.harness} committed twice`); continue }
    const problem = checkCommit(card, c, h)
    if (problem) p.push(`${c.harness} commitment: ${problem}`)
    commitBy.set(c.harness, c)
  }
  for (const r of round.reveals) {
    const c = commitBy.get(r?.harness)
    if (!c) { p.push(`${r?.harness} revealed without committing`); continue }
    const problem = checkRevealRecord(byId.get(r.harness), c, r, h)
    if (problem) p.push(`${r.harness} reveal: ${problem}`)
  }

  const declared = asc.exits.map(e => e.outcome)
  if (!declared.includes(ruling.exit)) p.push(`exit "${ruling.exit}" is not declared by the contract`)
  if (asc.question.answer.type !== 'forecast') {
    for (const r of round.reveals) if (!asc.question.answer.options.includes(r.vote?.answer)) p.push(`${r.harness} voted "${r.vote?.answer}", not a declared option`)
  }
  const countedIds = new Set((ruling.votes ?? []).map(v => v.harness))
  const q = checkQuorum(asc, round.reveals.filter(r => !needsProofs(asc) || countedIds.has(r.harness)).map(r => ({ lab: byId.get(r.harness)?.lab })))
  if (needsProofs(asc)) {
    const f = finality(asc, ruling)
    if (!f.final) p.push(...f.problems.map(x => `not final: ${x}`))
    if (verifiers) for (const k of round.proofChecks ?? []) { const problem = checkProofCheck(k, verifiers); if (problem) p.push(`proof check for ${k.harness}: ${problem}`) }
  } else if (round.proofRecords || round.proofChecks) p.push('a contract that needs no proofs carries proof records')
  if (ruling.passed && !q.ok) p.push(`ruling passed without a quorum: ${q.problems.join('; ')}`)
  for (const x of checkPay(asc, ruling, round.sealer)) p.push(x)

  try {
    const again = ruleFromRecords(asc, round.commits, round.reveals, { jury, sealer: round.sealer, seed: round.seed, proofRecords: round.proofRecords, proofChecks: round.proofChecks })
    const differs = Object.keys(again).filter(k => canonical(again[k]) !== canonical(ruling[k]))
    if (differs.length) p.push(`ruling does not match what its round computes (${differs.join(', ')})`)
  } catch (err) {
    p.push(`ruling cannot be recomputed from its round: ${err.message}`)
  }
  return done()
}

/**
 * Seal rulings into a block that links to its parent. A block with no rulings
 * cannot be sealed. Pass `time` so any node can rebuild the header exactly;
 * without it the sealer's clock is used. Reviews (challenge results) ride in
 * the block of the challenge ruling that decided them, and only there.
 * @param {{height: number, hash: string} | null} parent - the previous block.
 * @param {object[]} rulings - rulings to include.
 * @param {{id: string, sign: (payload: unknown) => string}} sealer - the sealing harness or node.
 * @param {string | Date | {time?: string | Date, reviews?: object[]}} [options] - a timestamp, or options.
 * @returns {object} the block.
 */
export function seal(parent, rulings, sealer, options = {}) {
  if (rulings.length === 0) throw new Error('no rulings, no block')
  const opts = typeof options === 'string' || options instanceof Date ? { time: options } : options
  const t = opts.time === undefined ? new Date() : new Date(opts.time)
  if (Number.isNaN(t.getTime())) throw new Error(`seal time "${opts.time}" is not a date`)
  const header = {
    height: (parent?.height ?? 0) + 1,
    parent: parent?.hash ?? '0'.repeat(64),
    rulingsRoot: sha256(rulings.map(r => sha256(r)).join('')),
    sealer: sealer.id,
    time: t.toISOString(),
  }
  const reviews = opts.reviews ?? []
  if (reviews.length) {
    const ids = new Set(rulings.map(rulingId))
    for (const r of reviews) if (!ids.has(r.by)) throw new Error('a review is sealed only with the challenge ruling that decided it')
    header.reviewsRoot = sha256(reviews.map(r => sha256(r)).join(''))
  }
  return { ...header, hash: sha256(header), signature: sealer.sign(header), rulings, ...(reviews.length ? { reviews } : {}) }
}

/**
 * The header fields `seal` hashes and signs. `reviewsRoot` is present only on
 * blocks that carry reviews.
 * @param {object} block - a block.
 * @returns {object} its header.
 */
export function blockHeader(block) {
  const { height, parent, rulingsRoot, sealer, time, reviewsRoot } = block
  return { height, parent, rulingsRoot, sealer, time, reviewsRoot }
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

function findKey(value, test, path = '') {
  if (value === null || typeof value !== 'object') return null
  for (const [k, v] of Object.entries(value)) {
    const here = path ? `${path}.${k}` : k
    if (!Array.isArray(value) && test(k)) return here
    const deeper = findKey(v, test, here)
    if (deeper) return deeper
  }
  return null
}
