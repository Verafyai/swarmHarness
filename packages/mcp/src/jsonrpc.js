/**
 * Line-delimited JSON-RPC 2.0 over stdio, for both eras of MCP. One JSON
 * message per line on stdin, one per line on stdout. Nothing else is ever
 * written to stdout; logs go to stderr.
 *
 *   modern (2026-07-28)   no handshake. Each request names its protocol version in
 *                         `_meta["io.modelcontextprotocol/protocolVersion"]`; the
 *                         server answers `server/discover`, and every result carries
 *                         `resultType`, with `ttlMs` and `cacheScope` on lists and reads.
 *   legacy (2025-11-25 and older)   the `initialize` handshake and `ping`.
 *
 * A client of either era works. Everything else is passed to `handlers`.
 *
 * @module @verafy/mcp/jsonrpc
 */

/** The newest MCP protocol version this server speaks, the latest stable revision. */
export const LATEST_PROTOCOL_VERSION = '2026-07-28'

/** The newest version that still has the `initialize` handshake. */
export const LATEST_LEGACY_VERSION = '2025-11-25'

/** Versions without the handshake. */
export const MODERN_PROTOCOL_VERSIONS = ['2026-07-28']

/** Versions with the handshake, newest first. */
export const LEGACY_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

/** Every MCP protocol version this server accepts from a client, newest first. */
export const SUPPORTED_PROTOCOL_VERSIONS = [...MODERN_PROTOCOL_VERSIONS, ...LEGACY_PROTOCOL_VERSIONS]

const META_VERSION = 'io.modelcontextprotocol/protocolVersion'
const META_SERVER = 'io.modelcontextprotocol/serverInfo'
export const UNSUPPORTED_PROTOCOL_VERSION = -32022
/** Legacy resource-not-found code; modern revisions use INVALID_PARAMS. */
export const RESOURCE_NOT_FOUND = -32002
/** Results that carry cache hints in the modern era. */
const CACHED = new Set(['tools/list', 'resources/list', 'resources/templates/list', 'resources/read', 'prompts/list'])

export const PARSE_ERROR = -32700
export const INVALID_REQUEST = -32600
export const METHOD_NOT_FOUND = -32601
export const INVALID_PARAMS = -32602
export const INTERNAL_ERROR = -32603

/** An error a handler throws to answer with a JSON-RPC error object. */
export class RpcError extends Error {
  /**
   * @param {number} code - a JSON-RPC error code.
   * @param {string} message - what went wrong.
   * @param {unknown} [data] - extra detail for the client.
   */
  constructor(code, message, data) {
    super(message)
    this.code = code
    this.data = data
  }
}

/**
 * The protocol version to answer `initialize` with: the client's own version
 * when it is a handshake-era version this server supports, else the newest
 * handshake-era version. Modern clients do not send `initialize`.
 * @param {unknown} requested - the client's `protocolVersion`.
 * @returns {string} the version to declare.
 */
export function negotiateVersion(requested) {
  return LEGACY_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_LEGACY_VERSION
}

/**
 * Build a message dispatcher. It takes one parsed message and returns the
 * response to send, or null for a notification.
 * @param {{serverInfo: object, capabilities: object, instructions?: string, handlers: Record<string, (params: object) => Promise<unknown>>, log?: (line: string) => void}} options - the server description and its method handlers.
 * @returns {(message: unknown) => Promise<object | null>} the dispatcher.
 */
export function createDispatcher({ serverInfo, capabilities, instructions, handlers, log = () => {} }) {
  const state = { initialized: false, protocolVersion: null }
  return async function dispatch(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      // A response from the client (to a request this server never sends) is ignored.
      if (msg && typeof msg === 'object' && !Array.isArray(msg) && msg.jsonrpc === '2.0' && ('result' in msg || 'error' in msg)) return null
      return errorResponse(msg?.id ?? null, INVALID_REQUEST, 'not a JSON-RPC 2.0 request')
    }
    const isNotification = !('id' in msg)
    const { id, method } = msg
    const params = msg.params ?? {}
    const requested = params?._meta?.[META_VERSION]
    const modern = typeof requested === 'string' && !LEGACY_PROTOCOL_VERSIONS.includes(requested)
    try {
      if (modern && !MODERN_PROTOCOL_VERSIONS.includes(requested)) {
        throw new RpcError(UNSUPPORTED_PROTOCOL_VERSION, `unsupported protocol version ${requested}`, { supported: SUPPORTED_PROTOCOL_VERSIONS })
      }
      if (method === 'initialize') {
        state.protocolVersion = negotiateVersion(params?.protocolVersion)
        return result(id, {
          protocolVersion: state.protocolVersion,
          capabilities,
          serverInfo,
          ...(instructions ? { instructions } : {}),
        })
      }
      if (method === 'server/discover') {
        return result(id, { resultType: 'complete', supportedVersions: SUPPORTED_PROTOCOL_VERSIONS, capabilities, serverInfo, ...(instructions ? { instructions } : {}), ttlMs: 3600000, cacheScope: 'public', _meta: { [META_SERVER]: serverInfo } })
      }
      if (method === 'notifications/initialized') { state.initialized = true; return null }
      if (method.startsWith('notifications/')) return null
      if (method === 'ping' && !modern) return isNotification ? null : result(id, {})
      const handler = Object.hasOwn(handlers, method) ? handlers[method] : null
      if (!handler) return isNotification ? null : errorResponse(id, METHOD_NOT_FOUND, `method not found: ${method}`)
      const out = await handler(params ?? {})
      if (isNotification) return null
      if (!modern) return result(id, out)
      return result(id, { resultType: 'complete', ...out, ...(CACHED.has(method) ? { ttlMs: 60000, cacheScope: 'private' } : {}), _meta: { ...(out?._meta ?? {}), [META_SERVER]: serverInfo } })
    } catch (err) {
      if (isNotification) return null
      if (err instanceof RpcError) return errorResponse(id, modern && err.code === RESOURCE_NOT_FOUND ? INVALID_PARAMS : err.code, err.message, err.data)
      log(`internal error in ${method}: ${err?.stack ?? err}`)
      return errorResponse(id, INTERNAL_ERROR, 'internal error')
    }
  }
}

function result(id, value) {
  return { jsonrpc: '2.0', id, result: value }
}

function errorResponse(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }
}

/**
 * Serve a dispatcher over a pair of streams, one JSON message per line.
 * Requests are answered in the order they finish.
 * @param {(message: unknown) => Promise<object | null>} dispatch - from `createDispatcher`.
 * @param {{input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream}} [io] - defaults to stdin and stdout.
 * @returns {Promise<void>} resolves when the input closes and every reply is written.
 */
export function serveStdio(dispatch, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise(resolveDone => {
    let buffer = ''
    const pending = new Set()
    const send = msg => { if (msg) output.write(JSON.stringify(msg) + '\n') }
    const handleLine = line => {
      if (!line.trim()) return
      let msg
      try { msg = JSON.parse(line) } catch {
        send(errorResponse(null, PARSE_ERROR, 'parse error: each line must be one JSON-RPC message'))
        return
      }
      if (Array.isArray(msg)) {
        send(errorResponse(null, INVALID_REQUEST, 'batches are not supported; send one message per line'))
        return
      }
      const p = dispatch(msg).then(send, () => {}).finally(() => pending.delete(p))
      pending.add(p)
    }
    input.setEncoding?.('utf8')
    input.on('data', chunk => {
      buffer += chunk
      let nl
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '')
        buffer = buffer.slice(nl + 1)
        handleLine(line)
      }
    })
    input.on('end', async () => {
      if (buffer) handleLine(buffer)
      buffer = ''
      await Promise.allSettled([...pending])
      resolveDone()
    })
  })
}
