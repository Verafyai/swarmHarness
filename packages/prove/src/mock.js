/**
 * The mock prover and verifier, for tests and the devnet. A mock "proof" is a
 * tagged record of (model commitment, input hash, answer hash). It binds the
 * three together so the whole flow can be exercised: a proof for a different
 * commitment, input or answer fails. It is NOT a proof of inference: anyone
 * can make one. Never use it for a real jury.
 * @module @verafyharness/prove/mock
 */
import { sha256, canonical } from '../../core/src/hash.js'

export const MOCK_SCHEME = 'mock/1'

/**
 * The model commitment the mock prover publishes for a model id.
 * @param {string} model - the model id.
 * @returns {string} SHA-256 hex.
 */
export function mockCommitment(model) {
  return sha256({ scheme: MOCK_SCHEME, model })
}

/**
 * Make a mock proof.
 * @param {string} commitment - the model commitment.
 * @param {unknown} input - the request input.
 * @param {string} answer - the output text.
 * @returns {string} the proof bytes (canonical JSON).
 */
export function mockProof(commitment, input, answer) {
  const inputHash = sha256(canonical(input))
  const answerHash = sha256(String(answer))
  return canonical({ scheme: MOCK_SCHEME, commitment, inputHash, answerHash, tag: sha256(`${MOCK_SCHEME}|${commitment}|${inputHash}|${answerHash}`) })
}

/**
 * Check a mock proof.
 * @param {string} proof - the proof bytes.
 * @param {string} commitment - the model commitment expected.
 * @param {unknown} input - the request input expected.
 * @param {string} answer - the output text expected.
 * @returns {boolean} whether it binds exactly these.
 */
export function checkMockProof(proof, commitment, input, answer) {
  try {
    return typeof proof === 'string' && proof === mockProof(commitment, input, answer)
  } catch { return false }
}

/**
 * A mock Prover. `complete` is any provider's complete() (such as core's
 * scripted `mockProvider`); the prover answers with it and attaches a mock proof.
 * @param {{model: string, complete: (req: object) => Promise<string | {content: string}>, commitment?: string, onProve?: (requests: object[]) => void}} options -
 *   `commitment` overrides the published commitment (tests use it to prove under the wrong one);
 *   `onProve` sees every batch, so tests can count batches.
 * @returns {object} the prover.
 */
export function mockProver({ model, complete, commitment = mockCommitment(model), onProve = () => {} }) {
  const run = async r => {
    const out = await complete({ model, system: r.input.system, user: r.input.user, ...(r.meta ?? {}) })
    return typeof out === 'string' ? out : String(out?.content ?? '')
  }
  return {
    name: 'mock',
    commitment: () => commitment,
    async infer(requests) {
      return Promise.all(requests.map(async r => ({ id: r.id, answer: await run(r) })))
    },
    async prove(requests) {
      onProve(requests)
      return Promise.all(requests.map(async r => {
        const answer = await run(r)
        const proofRef = mockProof(commitment, r.input, answer)
        return { id: r.id, answer, proofRef, proofHash: sha256(proofRef) }
      }))
    },
  }
}

/**
 * The mock Verifier.
 * @returns {{name: string, verify: (proofRef: string, commitment: string, input: unknown, answer: string) => boolean}} the verifier.
 */
export function mockVerifier() {
  return { name: 'mock', verify: (proofRef, commitment, input, answer) => checkMockProof(proofRef, commitment, input, answer) }
}
