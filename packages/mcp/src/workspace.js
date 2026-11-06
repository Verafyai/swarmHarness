/**
 * The server's workspace and the paths it may touch.
 *
 *   writes   only inside the workspace: VERAFY_HOME, else PLUGIN_DATA (Hermes), else ~/.verafy
 *   reads    contract files only from paths the agent passes, and only .json files
 *
 * @module @verafy/mcp/workspace
 */
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The repository (or installed package) root: examples, schemas, docs and the default config live here. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** A tool error an agent can act on. */
export class ToolError extends Error {
  /**
   * @param {'INVALID_CONTRACT' | 'LIVE_DISABLED' | 'SPEND_CAP' | 'NO_KEY' | 'NOT_FOUND' | 'OUTSIDE_WORKSPACE'} code - the error code.
   * @param {string} message - what went wrong.
   * @param {string} hint - what the agent can do about it.
   * @param {object} [extra] - more structured detail, such as validation errors.
   */
  constructor(code, message, hint, extra = {}) {
    super(message)
    this.code = code
    this.hint = hint
    this.extra = extra
  }
}

/**
 * Pick the workspace directory.
 * @param {{home?: string, env?: Record<string, string | undefined>}} options - the `--home` flag and the environment.
 * @returns {string} an absolute path.
 */
export function workspaceDir({ home, env = process.env } = {}) {
  const dir = home || env.VERAFY_HOME || env.PLUGIN_DATA || join(homedir(), '.verafy')
  return resolve(dir)
}

/**
 * Whether `target` is the workspace or inside it, after resolving symlinks in
 * every part of the path that already exists.
 * @param {string} ws - the workspace.
 * @param {string} target - an absolute path.
 * @returns {boolean} whether a write there stays inside.
 */
export function insideWorkspace(ws, target) {
  const real = p => {
    // Resolve the longest existing prefix, so a symlinked parent cannot point outside.
    let cur = p
    const rest = []
    while (!existsSync(cur)) {
      const up = dirname(cur)
      if (up === cur) break
      rest.unshift(basename(cur))
      cur = up
    }
    let base
    try { base = realpathSync(cur) } catch { base = cur }
    return rest.length ? join(base, ...rest) : base
  }
  const w = real(resolve(ws))
  const t = real(resolve(ws, target))
  const rel = relative(w, t)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Make sure the workspace exists, and return a path inside it.
 * @param {string} ws - the workspace.
 * @param {...string} parts - path parts under it.
 * @returns {string} the absolute path.
 */
export function inWorkspace(ws, ...parts) {
  mkdirSync(ws, { recursive: true })
  const p = resolve(ws, ...parts)
  if (!insideWorkspace(ws, p)) throw new ToolError('OUTSIDE_WORKSPACE', 'that path is outside the workspace', `Writes go only under ${ws}. Pass a relative path, or set VERAFY_HOME.`)
  return p
}

/**
 * Read a contract file the agent named. Relative paths resolve against the
 * server's working directory, then against the package root, so
 * `examples/market-resolution.json` works from a clone and from npx.
 * The file must end in .json. A parse failure never echoes the file's bytes.
 * @param {string} p - the path the agent passed.
 * @returns {{contract: object, file: string}} the parsed contract and where it was read.
 */
export function readContractFile(p) {
  if (typeof p !== 'string' || !p.trim()) throw new ToolError('NOT_FOUND', 'path is empty', 'Pass the path to a contract .json file, or pass `contract` as an object.')
  if (!p.toLowerCase().endsWith('.json')) throw new ToolError('NOT_FOUND', 'only .json contract files are read', 'Pass the path to a contract .json file, or pass `contract` as an object.')
  const candidates = isAbsolute(p) ? [p] : [resolve(process.cwd(), p), resolve(ROOT, p)]
  const file = candidates.find(f => existsSync(f))
  if (!file) throw new ToolError('NOT_FOUND', `no file at ${p}`, 'Check the path. Call verafy_examples to list the example contracts that ship with the harness.')
  let text
  try { text = readFileSync(file, 'utf8') } catch { throw new ToolError('NOT_FOUND', `cannot read ${p}`, 'Check that the file exists and is readable.') }
  try { return { contract: JSON.parse(text), file } } catch {
    throw new ToolError('INVALID_CONTRACT', `${p} is not valid JSON`, 'Fix the JSON syntax, then call verafy_validate again.', { errors: [{ path: '', message: 'the file is not valid JSON', hint: 'Check for a trailing comma, a missing quote or a missing brace.' }] })
  }
}
