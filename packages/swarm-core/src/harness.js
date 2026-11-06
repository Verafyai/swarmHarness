/**
 * A harnessed validator: one AI model wrapped with intake, a context loader,
 * guardrails, a signer, a contract runtime, a bond and a track record.
 * @module swarm-core/harness
 */
import { ascHash, validate } from './asc.js'
import { loadContext, deliberate } from './juror.js'
import { createIdentity, commit, signMessage } from './signer.js'

export class Harness {
  /**
   * @param {{id: string, lab: string, model: string, bond: number, provider: object}} options - the harness setup.
   */
  constructor({ id, lab, model, bond, provider }) {
    this.id = id
    this.lab = lab
    this.model = model
    this.bond = bond
    this.provider = provider
    this.identity = createIdentity()
    this.record = { votes: 0, audited: 0, faults: 0 }
    this.pending = new Map()
  }

  /** The public description other harnesses and sealers see. */
  get card() {
    return { id: this.id, lab: this.lab, model: this.model, bond: this.bond, publicKey: this.identity.publicKey }
  }

  /**
   * Intake: refuse a contract that is malformed, unfunded, or larger than this
   * harness's bond allows it to decide.
   * @param {object} asc - the contract.
   * @returns {string[]} reasons to refuse; empty to accept.
   */
  intake(asc) {
    const problems = validate(asc)
    if (asc.payment?.maxValuePerVote && asc.payment.maxValuePerVote > this.bond) problems.push(`bond ${this.bond} is below the contract's ${asc.payment.maxValuePerVote} per vote`)
    return problems
  }

  /**
   * Commit phase: load and check context, deliberate, then publish only a commitment.
   * @param {object} asc - the contract.
   * @returns {Promise<{harness: string, commitment: string, attestation: object, signature: string}>} the commitment.
   */
  async commit(asc) {
    const refused = this.intake(asc)
    if (refused.length) throw new Error(`${this.id} refused: ${refused.join('; ')}`)
    const loaded = loadContext(asc)
    if (!loaded.ok) throw new Error(`${this.id} context check failed: ${loaded.problems.join('; ')}`)
    const h = ascHash(asc)
    const vote = await deliberate(asc, this.provider, this.model)
    const { commitment, salt } = commit(h, vote)
    this.pending.set(h, { vote, salt })
    const attestation = { harness: this.id, lab: this.lab, model: this.model, ascHash: h, commitment }
    return { harness: this.id, commitment, attestation, signature: signMessage(this.identity.privateKey, attestation) }
  }

  /**
   * Reveal phase: open the vote behind the commitment.
   * @param {string} h - the contract hash.
   * @returns {{harness: string, vote: object, salt: string, signature: string}} the reveal.
   */
  reveal(h) {
    const p = this.pending.get(h)
    if (!p) throw new Error(`${this.id} has nothing committed for ${h}`)
    this.pending.delete(h)
    this.record.votes++
    const message = { harness: this.id, ascHash: h, vote: p.vote, salt: p.salt }
    return { ...message, signature: signMessage(this.identity.privateKey, message) }
  }

  /**
   * Sign a payload with this harness's key, such as a sealed block or a trigger.
   * @param {unknown} payload - the payload.
   * @returns {string} base64 signature.
   */
  sign(payload) {
    return signMessage(this.identity.privateKey, payload)
  }
}
