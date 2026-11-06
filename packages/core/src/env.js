/**
 * Names that moved from `swarm` to `verafy`, and the fallbacks that keep old
 * setups working. New names are read first; the old ones are still read, so a
 * machine set up before the rename keeps running unchanged.
 *
 *   VERAFY_API_KEY              falls back to SWARM_API_KEY
 *   VERAFY_KEYBLOCK_PASSPHRASE  falls back to SWARM_KEYBLOCK_PASSPHRASE
 *   verafy.config.json          falls back to swarm.config.json
 *   .verafy/chain.json          falls back to .swarm/chain.json while .verafy/ is empty
 *
 * @module @verafyharness/core/env
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const CONFIG_FILE = 'verafy.config.json'
export const LEGACY_CONFIG_FILE = 'swarm.config.json'
export const STATE_DIR = '.verafy'
export const LEGACY_STATE_DIR = '.swarm'

/**
 * The other name for a renamed variable: VERAFY_X for SWARM_X and back.
 * @param {string} name - a variable name.
 * @returns {string | null} its counterpart, or null when it has none.
 */
export function legacyName(name) {
  if (name.startsWith('VERAFY_')) return `SWARM_${name.slice(7)}`
  if (name.startsWith('SWARM_')) return `VERAFY_${name.slice(6)}`
  return null
}

/**
 * Read an environment variable by its name, then by its pre-rename name.
 * @param {string} name - such as VERAFY_API_KEY.
 * @param {Record<string, string | undefined>} [env] - defaults to process.env.
 * @returns {string | undefined} the value.
 */
export function envValue(name, env = process.env) {
  if (env[name]) return env[name]
  const old = legacyName(name)
  return old && env[old] ? env[old] : undefined
}

/** The API key for live models: VERAFY_API_KEY, else SWARM_API_KEY. */
export function apiKeyFromEnv(env = process.env) {
  return envValue('VERAFY_API_KEY', env)
}

/** The keyblock passphrase: VERAFY_KEYBLOCK_PASSPHRASE, else SWARM_KEYBLOCK_PASSPHRASE. */
export function keyblockPassphraseFromEnv(env = process.env) {
  return envValue('VERAFY_KEYBLOCK_PASSPHRASE', env)
}

/**
 * The config file under a root: verafy.config.json, else swarm.config.json.
 * @param {string} root - the repo or install directory.
 * @returns {string} the path to read; the new name when neither exists.
 */
export function configPath(root) {
  const fresh = join(root, CONFIG_FILE)
  if (existsSync(fresh)) return fresh
  const old = join(root, LEGACY_CONFIG_FILE)
  return existsSync(old) ? old : fresh
}

function isEmpty(dir) {
  try { return readdirSync(dir).length === 0 } catch { return true }
}

/**
 * Where the local chain lives. Writes always go to `.verafy/`. Reads come from
 * `.verafy/` unless it is empty or missing and `.swarm/chain.json` exists.
 * @param {string} root - the repo or install directory.
 * @returns {{dir: string, read: string, write: string}} the state folder and the chain file to read and to write.
 */
export function chainPaths(root) {
  const dir = join(root, STATE_DIR)
  const write = join(dir, 'chain.json')
  const old = join(root, LEGACY_STATE_DIR, 'chain.json')
  const read = isEmpty(dir) && existsSync(old) ? old : write
  return { dir, read, write }
}
