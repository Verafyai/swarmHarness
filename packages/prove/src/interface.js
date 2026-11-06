/**
 * The Prover and Verifier interfaces (MASTER_SPEC Part D2).
 *
 *   Prover {
 *     commitment()            -> string                      the committed model (weights) this prover proves
 *     infer(requests)?        -> [{id, answer}]              plain inference, no proof (used for the commit, so proving never blocks it)
 *     prove(requests)         -> [{id, answer, proofRef, proofHash}]
 *   }
 *   Verifier {
 *     verify(proofRef, commitment, input, answer) -> bool
 *   }
 *
 * A request is `{id, input: {system, user}, meta?}`. `answer` is the model's
 * output text. `proofRef` says where the proof is (inline data for the mock, a
 * file or URL for a real prover); `proofHash` is the SHA-256 hex of the proof
 * bytes. Every method may return a promise.
 *
 * `infer` is optional in the spec's interface and required for an L2 juror:
 * without it, the only way to get an answer is to prove it, and proving would
 * then block the commit.
 * @module @verafyharness/prove/interface
 */

const HEX = /^[0-9a-f]{64}$/

/**
 * Check that an object implements Prover.
 * @param {object} p - the candidate.
 * @param {{infer?: boolean}} [options] - require `infer` too.
 * @returns {object} the prover.
 */
export function assertProver(p, { infer = false } = {}) {
  if (!p || typeof p.commitment !== 'function' || typeof p.prove !== 'function') throw new Error('a Prover has commitment() and prove(requests)')
  if (infer && typeof p.infer !== 'function') throw new Error('an L2 juror\'s prover needs infer(requests), so proving never blocks the commit')
  return p
}

/**
 * Check that an object implements Verifier.
 * @param {object} v - the candidate.
 * @returns {object} the verifier.
 */
export function assertVerifier(v) {
  if (!v || typeof v.verify !== 'function') throw new Error('a Verifier has verify(proofRef, commitment, input, answer)')
  return v
}

/**
 * Check one prove() result.
 * @param {object} r - the result.
 * @returns {object} the result.
 */
export function checkResult(r) {
  if (typeof r?.answer !== 'string') throw new Error('a prove() result carries the answer text')
  if (r.proofRef === undefined || r.proofRef === null) throw new Error('a prove() result carries a proofRef')
  if (!HEX.test(String(r.proofHash))) throw new Error('a prove() result\'s proofHash is a SHA-256 hex digest')
  return r
}
