/**
 * The keyblock: the harness's vault. It holds API keys and wallet keys
 * encrypted at rest (AES-256-GCM, with a key derived from the operator's
 * passphrase by scrypt), and it never hands a raw secret to the rest of the
 * harness. Instead it issues scoped keys: short-lived, signed grants such as
 * "call the openrouter API" or "pay gpu-host up to 50 USDC", which the API
 * router and the banker present when they need a secret used.
 *
 * A scoped key names its holder, its scopes, an expiry and a use limit. The
 * keyblock checks all four before it lets a secret be used, and it lends the
 * secret only to a callback that runs inside the call. Revoking a key or
 * locking the keyblock stops every use at once.
 *
 * @module @verafyharness/core/keyblock
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const b64 = buf => buf.toString('base64url')
const unb64 = s => Buffer.from(s, 'base64url')

export class Keyblock {
  /**
   * @param {{passphrase: string, salt?: string, sealed?: Record<string, string>}} options - the operator's passphrase
   *   (read it from an environment variable, never a file in git), and optionally a salt and sealed secrets from an earlier `export()`.
   */
  constructor({ passphrase, salt, sealed = {} }) {
    if (!passphrase || passphrase.length < 12) throw new Error('keyblock passphrase must be at least 12 characters')
    this.salt = salt ?? b64(randomBytes(16))
    const k = scryptSync(passphrase, unb64(this.salt), 64)
    this.encKey = k.subarray(0, 32)
    this.macKey = k.subarray(32)
    this.sealed = { ...sealed }
    this.uses = new Map()
    this.revoked = new Set()
    this.locked = false
    this.audit = []
  }

  /**
   * Store a secret, encrypted. The plaintext is not kept.
   * @param {string} name - the secret's name, such as "openrouter" or "wallet:solana".
   * @param {string} secret - the API key or private key.
   */
  put(name, secret) {
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', this.encKey, iv)
    c.setAAD(Buffer.from(name))
    const ct = Buffer.concat([c.update(secret, 'utf8'), c.final()])
    this.sealed[name] = `${b64(iv)}.${b64(c.getAuthTag())}.${b64(ct)}`
    this.audit.push({ type: 'put', name })
  }

  /** Names of stored secrets, never their values. */
  names() {
    return Object.keys(this.sealed)
  }

  /**
   * The encrypted store, safe to write to disk.
   * @returns {{salt: string, sealed: Record<string, string>}} salt and ciphertexts.
   */
  export() {
    return { salt: this.salt, sealed: { ...this.sealed } }
  }

  /**
   * Issue a scoped key.
   * @param {{holder: string, scopes: string[], ttlSeconds?: number, maxUses?: number}} grant - who gets it, what it allows
   *   (such as "call:openrouter" or "pay:gpu-host"), how long it lives and how many times it can be used.
   * @returns {string} the scoped key, an opaque string.
   */
  issue({ holder, scopes, ttlSeconds = 3600, maxUses = Infinity }) {
    if (this.locked) throw new Error('keyblock is locked')
    const body = { id: b64(randomBytes(9)), holder, scopes, exp: Date.now() + ttlSeconds * 1000, maxUses: Number.isFinite(maxUses) ? maxUses : null }
    const payload = b64(Buffer.from(JSON.stringify(body)))
    const sig = b64(createHmac('sha256', this.macKey).update(payload).digest())
    this.audit.push({ type: 'issue', id: body.id, holder, scopes })
    return `kb1.${payload}.${sig}`
  }

  /**
   * Check a scoped key for one scope, and count one use.
   * @param {string} token - a scoped key from `issue()`.
   * @param {string} scope - the scope being exercised.
   * @returns {object} the key's grant.
   */
  authorize(token, scope) {
    if (this.locked) throw new Error('keyblock is locked')
    const [v, payload, sig] = String(token).split('.')
    if (v !== 'kb1' || !payload || !sig) throw new Error('not a keyblock key')
    const want = createHmac('sha256', this.macKey).update(payload).digest()
    const got = unb64(sig)
    if (got.length !== want.length || !timingSafeEqual(got, want)) throw new Error('scoped key signature is invalid')
    const g = JSON.parse(unb64(payload).toString('utf8'))
    if (this.revoked.has(g.id)) throw new Error('scoped key has been revoked')
    if (Date.now() > g.exp) throw new Error('scoped key has expired')
    if (!g.scopes.includes(scope) && !g.scopes.includes(scope.split(':')[0] + ':*')) throw new Error(`scoped key does not allow ${scope}`)
    const n = (this.uses.get(g.id) ?? 0) + 1
    if (g.maxUses !== null && n > g.maxUses) throw new Error('scoped key has no uses left')
    this.uses.set(g.id, n)
    this.audit.push({ type: 'use', id: g.id, holder: g.holder, scope })
    return g
  }

  /**
   * Lend a secret to a callback for one authorized use. The secret is never
   * returned; only the callback's result is.
   * @param {string} token - a scoped key.
   * @param {string} scope - the scope being exercised, such as "call:openrouter".
   * @param {string} name - which secret the callback needs.
   * @param {(secret: string) => any} use - runs with the secret.
   * @returns {any} whatever `use` returns.
   */
  withSecret(token, scope, name, use) {
    this.authorize(token, scope)
    const sealed = this.sealed[name]
    if (!sealed) throw new Error(`no secret named "${name}"`)
    const [iv, tag, ct] = sealed.split('.').map(unb64)
    const d = createDecipheriv('aes-256-gcm', this.encKey, iv)
    d.setAAD(Buffer.from(name))
    d.setAuthTag(tag)
    const secret = Buffer.concat([d.update(ct), d.final()]).toString('utf8')
    return use(secret)
  }

  /**
   * Revoke one scoped key.
   * @param {string} token - the key to revoke.
   */
  revoke(token) {
    const g = JSON.parse(unb64(String(token).split('.')[1]).toString('utf8'))
    this.revoked.add(g.id)
    this.audit.push({ type: 'revoke', id: g.id })
  }

  /** Stop every use of every key until the keyblock is opened again with the passphrase. */
  lock() {
    this.locked = true
    this.audit.push({ type: 'lock' })
  }
}
