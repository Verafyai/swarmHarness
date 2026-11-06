/**
 * Reading the source chain from intake and the outbox, without depending on
 * any reader. The core takes a `sourceChain` object with two methods,
 * `checkFunding(asc)` and `confirmTrigger(trigger, landed)`, such as the one
 * `@verafyharness/lightclient` builds. With none configured, nothing here reads
 * a chain and every result says so, so the core runs offline as before.
 *
 *   fundingCheck   intake: is the escrow the contract names actually funded?
 *   Outbox         records triggers sent, then confirms each one landed
 *   PauseLog       when sources disagree, the contract is paused with the
 *                  reason and the sources; the log is append-only
 *
 * A read whose sources disagree (`status: 'unknown'`) never lets a contract
 * proceed: it is paused, not guessed.
 *
 * @module @verafyharness/core/sourcechain
 */

/** An append-only record of paused contracts and why. */
export class PauseLog {
  constructor() {
    this.entries = []
  }

  /**
   * Pause a contract.
   * @param {string} ascId - the contract id.
   * @param {{stage: string, reason: string, read?: object}} why - where and why, with the read that caused it.
   * @returns {object} the entry.
   */
  pause(ascId, { stage, reason, read }) {
    const entry = { type: 'pause', asc: ascId, stage, reason, at: new Date().toISOString(), ...(read ? { read: labelOf(read) } : {}) }
    this.entries.push(entry)
    return entry
  }

  /**
   * Lift a pause. The pause stays in the log; a resume entry is appended.
   * @param {string} ascId - the contract id.
   * @param {string} reason - why it may proceed.
   */
  resume(ascId, reason) {
    const entry = { type: 'resume', asc: ascId, reason, at: new Date().toISOString() }
    this.entries.push(entry)
    return entry
  }

  /** Whether the latest entry for a contract is a pause. */
  isPaused(ascId) {
    const last = this.entries.filter(e => e.asc === ascId).at(-1)
    return last?.type === 'pause'
  }
}

/** The part of a read worth recording: status, reason, value, commitment and sources. */
export function labelOf(read) {
  if (!read) return null
  const { status, reason, value, chain, commitment, method, policy, attempts, slot, verification, syncCommittee, sources } = read
  return { status, reason, value, chain, commitment, method, policy, attempts, slot, verification, syncCommittee, sources }
}

/**
 * Intake's funding check.
 * @param {object} asc - the contract.
 * @param {{sourceChain?: object, pauses?: PauseLog, require?: boolean}} [options] - `require` refuses a
 *   contract that names no on-chain escrow (`payment.source`) when a light client is configured.
 * @returns {Promise<{checked: boolean, ok: boolean, paused: boolean, problems: string[], read?: object, reason?: string}>} the check.
 */
export async function fundingCheck(asc, { sourceChain, pauses, require = false } = {}) {
  if (!sourceChain) return { checked: false, ok: true, paused: false, problems: [], reason: 'no light client configured' }
  if (!asc?.payment?.source) {
    return require
      ? { checked: false, ok: false, paused: false, problems: ['the contract names no on-chain escrow (payment.source)'] }
      : { checked: false, ok: true, paused: false, problems: [], reason: 'the contract names no on-chain escrow (payment.source)' }
  }
  const read = await sourceChain.checkFunding(asc)
  if (read.status === 'agreed' && read.funded) return { checked: true, ok: true, paused: false, problems: [], read: labelOf(read), have: read.have, need: read.need }
  if (read.status === 'agreed') return { checked: true, ok: false, paused: false, problems: [`escrow not funded: ${read.have ?? 0} held, ${read.need ?? asc.payment.escrow} needed (raw units)${read.funded === false && read.need === null ? `; ${read.reason}` : ''}`], read: labelOf(read) }
  if (read.status === 'unconfigured' || read.status === 'invalid') return { checked: false, ok: false, paused: false, problems: [read.reason], read: labelOf(read) }
  const reason = `funding unknown: ${read.reason}`
  pauses?.pause(asc.id, { stage: 'intake', reason, read })
  return { checked: true, ok: false, paused: true, problems: [reason], read: labelOf(read) }
}

/**
 * The outbox: triggers a sealed ruling sends to other chains, and whether each
 * one landed. Entries are appended, never edited; a confirmation is a new entry.
 */
export class Outbox {
  /**
   * @param {{sourceChain?: object, pauses?: PauseLog}} [options]
   */
  constructor({ sourceChain = null, pauses = new PauseLog() } = {}) {
    this.sourceChain = sourceChain
    this.pauses = pauses
    this.entries = []
  }

  /**
   * Record that a trigger was sent.
   * @param {{asc: string, ruling: string, trigger: object, landed: {chain?: string, signature?: string, txHash?: string}}} sent
   * @returns {object} the entry, with an index.
   */
  record({ asc, ruling, trigger, landed }) {
    const entry = { type: 'sent', index: this.entries.length, asc, ruling, trigger, landed, at: new Date().toISOString() }
    this.entries.push(entry)
    return entry
  }

  /**
   * Confirm a sent trigger landed, and record the confirmation.
   * @param {object} sent - an entry from `record`.
   * @returns {Promise<object>} the confirmation entry: `confirmed`, `not-landed`, `unknown` (contract paused) or `unconfirmed` (no light client).
   */
  async confirm(sent) {
    let status, read = null, reason
    if (!this.sourceChain) {
      status = 'unconfirmed'; reason = 'no light client configured'
    } else {
      read = await this.sourceChain.confirmTrigger(sent.trigger, sent.landed)
      if (read.status === 'agreed') { status = read.landed ? 'confirmed' : 'not-landed'; reason = read.reason }
      else if (read.status === 'unconfigured') { status = 'unconfirmed'; reason = read.reason }
      else {
        status = 'unknown'; reason = `trigger landing unknown: ${read.reason}`
        this.pauses.pause(sent.asc, { stage: 'outbox', reason, read })
      }
    }
    const entry = { type: 'confirmation', of: sent.index, asc: sent.asc, status, reason, at: new Date().toISOString(), ...(read ? { read: labelOf(read) } : {}) }
    this.entries.push(entry)
    return entry
  }
}
