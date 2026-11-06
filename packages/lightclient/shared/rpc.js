/**
 * JSON-RPC through the API router. The light client never builds a URL or
 * holds a key: each endpoint names an API entry plugged into the router
 * (`packages/core/src/apirouter.js`), and the router attaches any key from the
 * keyblock or from an environment reference, meters the call, and returns the
 * body. Public endpoints are API entries with no secret.
 *
 * @module @verafyharness/lightclient/shared/rpc
 */
import { originOf, safeError } from './quorum.js'

/**
 * Make a JSON-RPC caller bound to one router and scoped key.
 * @param {{call: Function, apis?: Map<string, object>}} router - an ApiRouter, or anything with the same `call`.
 * @param {string | null} [token] - a scoped key with `call:<api>` for APIs whose key is in the keyblock; null for keyless APIs.
 * @returns {{rpc: (endpoint: object, method: string, params?: unknown[]) => Promise<any>, describe: (endpoint: object) => string}} the caller.
 */
export function rpcVia(router, token = null) {
  if (typeof router?.call !== 'function') throw new Error('lightclient: a router with call(token, apiId, request) is required')
  let id = 0
  return {
    async rpc(endpoint, method, params = []) {
      let res
      try {
        res = await router.call(token, endpoint.api, { path: endpoint.path ?? '', method: 'POST', body: { jsonrpc: '2.0', id: ++id, method, params }, purpose: `lightclient ${method}` })
      } catch (e) {
        throw new Error(`${method} failed: ${safeError(e)}`)
      }
      if (res.status !== 200) throw new Error(`${method}: HTTP ${res.status}`)
      const body = res.body
      if (body?.error) throw new Error(`${method}: RPC error ${body.error.code ?? ''} ${safeError(body.error.message ?? '')}`.trim())
      if (!body || !('result' in body)) throw new Error(`${method}: no result in the response`)
      return body.result
    },
    describe(endpoint) {
      return originOf(router.apis?.get?.(endpoint.api)?.baseURL)
    },
  }
}
