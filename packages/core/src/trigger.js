/**
 * Quorum-signed triggers, `swarm.trigger/0`. A `call` trigger in a sealed
 * ruling (such as `market.settle(NO)` on Solana) may leave the chain only with
 * signatures from at least the contract's quorum of the jurors whose votes were
 * counted. A relay or a program on the target chain checks the same message.
 * @module @verafyharness/core/trigger
 */
import { canonical } from './hash.js'
import { signMessage, verifyMessage } from './signer.js'
import { rulingId } from './network.js'

export const TRIGGER_KIND = 'swarm.trigger/0'

/**
 * The message jurors sign to release one trigger.
 * @param {object} ruling - the sealed ruling.
 * @param {object} trigger - one of the ruling's `call` triggers, as recorded.
 * @param {{block?: string}} [options] - the hash of the block that holds the ruling.
 * @returns {{kind: string, block: string | null, ruling: string, ascHash: string, trigger: object}} the message.
 */
export function triggerMessage(ruling, trigger, { block = null } = {}) {
  if (!ruling.passed) throw new Error('a ruling below the bar emits no call triggers')
  if (trigger?.type !== 'call') throw new Error('only call triggers leave the chain')
  if (!ruling.triggers.some(t => canonical(t) === canonical(trigger))) throw new Error('trigger is not one the ruling emitted')
  return { kind: TRIGGER_KIND, block, ruling: rulingId(ruling), ascHash: ruling.ascHash, trigger }
}

/**
 * Sign a trigger message as one juror.
 * @param {{id: string, sign?: (p: unknown) => string, identity?: {privateKey: object}}} juror - a Harness, or `{id, privateKey}`.
 * @param {object} message - from `triggerMessage`.
 * @returns {{harness: string, signature: string}} the signature.
 */
export function signTrigger(juror, message) {
  if (message?.kind !== TRIGGER_KIND) throw new Error(`not a ${TRIGGER_KIND} message`)
  const signature = typeof juror.sign === 'function' ? juror.sign(message) : signMessage(juror.privateKey ?? juror.identity.privateKey, message)
  return { harness: juror.id, signature }
}

/**
 * Whether a trigger carries a quorum of valid signatures from counted jurors.
 * Signatures from jurors whose votes were not counted, from unknown keys, or
 * repeated, do not count toward the quorum.
 * @param {object} message - from `triggerMessage`.
 * @param {{harness: string, signature: string}[]} signatures - juror signatures.
 * @param {object} ruling - the sealed ruling.
 * @param {{asc?: object, quorum?: number, cards?: Map<string, {publicKey: string}> | object[]}} options -
 *   the contract (for its quorum) or an explicit quorum; `cards` defaults to the ruling's round jury.
 * @returns {{ok: boolean, signers: string[], quorum: number, problems: string[]}} the result.
 */
export function verifyTrigger(message, signatures, ruling, { asc, quorum, cards } = {}) {
  const p = []
  if (message?.kind !== TRIGGER_KIND) p.push(`not a ${TRIGGER_KIND} message`)
  if (message?.ruling !== rulingId(ruling)) p.push('message names another ruling')
  if (message?.ascHash !== ruling.ascHash) p.push('message names another contract')
  if (!ruling.passed) p.push('a ruling below the bar emits no call triggers')
  if (!ruling.triggers?.some(t => canonical(t) === canonical(message?.trigger))) p.push('trigger is not one the ruling emitted')
  const q = quorum ?? asc?.payment?.jury?.quorum ?? (asc ? Math.ceil(asc.payment.jury.size / 2) : undefined)
  if (!Number.isInteger(q) || q < 1) p.push('verifyTrigger needs the contract or a quorum')
  const reg = cards instanceof Map ? cards : new Map((cards ?? ruling.round?.jury ?? []).map(c => [c.id, c]))
  const counted = new Set(ruling.votes.map(v => v.harness))
  const signers = new Set()
  for (const s of signatures ?? []) {
    const card = reg.get(s?.harness)
    if (!counted.has(s?.harness) || !card || signers.has(s.harness)) continue
    let ok = false
    try { ok = verifyMessage(card.publicKey, message, s.signature) } catch { ok = false }
    if (ok) signers.add(s.harness)
  }
  if (Number.isInteger(q) && signers.size < q) p.push(`${signers.size} valid signatures from counted jurors; the quorum is ${q}`)
  return { ok: p.length === 0, signers: [...signers], quorum: q, problems: p }
}
