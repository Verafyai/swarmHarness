/**
 * The harness signer: Ed25519 keys, commit-then-reveal, and signed attestations.
 * A juror commits to a hash of its vote and a salt before any vote is revealed,
 * so no harness can copy another.
 * @module @verafyharness/core/signer
 */
import { generateKeyPairSync, sign, verify, createPublicKey } from 'node:crypto'
import { canonical, sha256, salt as newSalt } from './hash.js'

/**
 * Create a harness identity.
 * @returns {{publicKey: string, privateKey: import('node:crypto').KeyObject}} the public key as base64 DER.
 */
export function createIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), privateKey }
}

/**
 * Sign a JSON value's canonical form.
 * @param {import('node:crypto').KeyObject} privateKey - the signer's key.
 * @param {unknown} message - the value to sign.
 * @returns {string} base64 signature.
 */
export function signMessage(privateKey, message) {
  return sign(null, Buffer.from(canonical(message)), privateKey).toString('base64')
}

/**
 * Verify a signature over a JSON value.
 * @param {string} publicKey - base64 DER public key.
 * @param {unknown} message - the signed value.
 * @param {string} signature - base64 signature.
 * @returns {boolean} whether the signature is valid.
 */
export function verifyMessage(publicKey, message, signature) {
  const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' })
  return verify(null, Buffer.from(canonical(message)), key, Buffer.from(signature, 'base64'))
}

/**
 * Commit to a vote.
 * @param {string} ascHash - the contract being ruled on.
 * @param {object} vote - the vote to hide.
 * @returns {{commitment: string, salt: string}} the commitment to publish and the salt to keep.
 */
export function commit(ascHash, vote) {
  const s = newSalt()
  return { commitment: sha256({ ascHash, vote, salt: s }), salt: s }
}

/**
 * Check a revealed vote against its commitment.
 * @param {string} ascHash - the contract being ruled on.
 * @param {object} vote - the revealed vote.
 * @param {string} s - the revealed salt.
 * @param {string} commitment - the earlier commitment.
 * @returns {boolean} whether the reveal matches.
 */
export function checkReveal(ascHash, vote, s, commitment) {
  return sha256({ ascHash, vote, salt: s }) === commitment
}
