/**
 * The harness signer: Ed25519 keys, commit-then-reveal, and signed attestations.
 * A juror commits to a hash of its vote and a salt before any vote is revealed,
 * so no harness can copy another.
 * @module @verafyharness/core/signer
 */
import { generateKeyPairSync, sign, verify, createPublicKey, createPrivateKey, KeyObject } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
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
 * Rebuild an identity from a kept private key, so a restarted harness is the
 * same harness. Accepts a KeyObject, a PKCS#8 PEM string (the format the DSH
 * juror plugin writes to `identity.pem`), or an identity object.
 * @param {import('node:crypto').KeyObject | string | {privateKey: import('node:crypto').KeyObject | string}} key - the private key.
 * @returns {{publicKey: string, privateKey: import('node:crypto').KeyObject}} the identity.
 */
export function importIdentity(key) {
  const raw = key instanceof KeyObject || typeof key === 'string' ? key : key?.privateKey
  const privateKey = raw instanceof KeyObject ? raw : createPrivateKey(String(raw))
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') throw new Error('a harness identity is an Ed25519 private key')
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64')
  if (key?.publicKey && typeof key === 'object' && !(key instanceof KeyObject) && key.publicKey !== publicKey) throw new Error('identity public key does not match its private key')
  return { publicKey, privateKey }
}

/**
 * The private key as PKCS#8 PEM, for keeping on disk. Treat it as a secret.
 * @param {{privateKey: import('node:crypto').KeyObject}} identity - the identity.
 * @returns {string} PEM text.
 */
export function exportIdentity(identity) {
  return identity.privateKey.export({ type: 'pkcs8', format: 'pem' })
}

/**
 * Load a harness identity from a PEM file, creating it (mode 0600) on first use.
 * The file format matches the DSH juror plugin's `identity.pem`.
 * @param {string} file - the key file.
 * @param {{create?: boolean}} [options] - set `create: false` to fail when the file is missing.
 * @returns {{publicKey: string, privateKey: import('node:crypto').KeyObject}} the identity.
 */
export function loadIdentity(file, { create = true } = {}) {
  try {
    return importIdentity(readFileSync(file, 'utf8'))
  } catch (err) {
    if (err?.code !== 'ENOENT' || !create) throw err
  }
  const id = createIdentity()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, exportIdentity(id), { mode: 0o600, flag: 'wx' })
  return id
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
