/**
 * Canonical JSON and SHA-256 helpers. Every hash in Swarm Harness is taken over
 * canonical JSON (sorted keys, no whitespace) so two harnesses always agree on it.
 * @module swarm-core/hash
 */
import { createHash, randomBytes } from 'node:crypto'

/**
 * Serialize a JSON value with object keys sorted at every level.
 * @param {unknown} value - any JSON-compatible value.
 * @returns {string} canonical JSON text.
 */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  const keys = Object.keys(value).filter(k => value[k] !== undefined).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
}

/**
 * SHA-256 of a string or of a value's canonical JSON.
 * @param {unknown} value - a string is hashed as UTF-8; anything else as canonical JSON.
 * @returns {string} lowercase hex digest.
 */
export function sha256(value) {
  const text = typeof value === 'string' ? value : canonical(value)
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * A short display form of a hex digest, such as `9f3a41c2`.
 * @param {string} hex - a hex digest.
 * @returns {string} the first eight characters.
 */
export function short(hex) {
  return hex.slice(0, 8)
}

/**
 * Random salt for commit-reveal.
 * @returns {string} 32 hex characters.
 */
export function salt() {
  return randomBytes(16).toString('hex')
}
