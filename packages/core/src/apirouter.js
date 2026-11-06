/**
 * The API router: one door from the harness to every outside API it uses,
 * and the way each one gets paid. It plugs into AI model APIs, hosting
 * backends and payment endpoints; it fetches the API key from the keyblock
 * with a scoped key, so callers never hold secrets; it meters each call; and
 * it pays each API through the banker in whatever token that API takes.
 *
 * An API entry:
 *   id          name used in scopes, such as "openrouter"
 *   kind        "inference" | "hosting" | "payment" | "data"
 *   baseURL     where requests go
 *   secret      the keyblock secret name holding its API key
 *   auth        "bearer" (default) or a header name such as "x-api-key"
 *   payee       the wallet payee id that bills for it
 *   price       {perCall?, perInputToken?, perOutputToken?} in the payee's token
 *   billing     "per-call" (pay as you go) or "accrue" (settle with settle())
 *
 * @module @verafyharness/core/apirouter
 */

export class ApiRouter {
  /**
   * @param {{keyblock: import('./keyblock.js').Keyblock, banker: import('./banker.js').Banker, apis: object[], fetch?: typeof fetch}} options -
   *   `fetch` can be replaced for tests or for a proxy.
   */
  constructor({ keyblock, banker, apis, fetch: f = globalThis.fetch }) {
    this.keyblock = keyblock
    this.banker = banker
    this.apis = new Map(apis.map(a => [a.id, a]))
    this.fetch = f
    this.owed = new Map()
    this.meter = []
  }

  /**
   * Call an outside API. The caller presents a scoped key with `call:<api id>`;
   * the router attaches the API key from the keyblock, sends the request,
   * meters it, and pays or accrues the cost.
   * @param {string} token - a scoped key from the keyblock.
   * @param {string} apiId - which API.
   * @param {{path: string, method?: string, body?: unknown, purpose?: string}} request - what to send.
   * @returns {Promise<{status: number, body: unknown, cost: number}>} the response and what it cost.
   */
  async call(token, apiId, { path, method = 'POST', body, purpose = 'api call' }) {
    const api = this.apis.get(apiId)
    if (!api) throw new Error(`no API named "${apiId}" is plugged in`)
    const res = await this.keyblock.withSecret(token, `call:${apiId}`, api.secret, key => {
      const headers = { 'content-type': 'application/json' }
      if (!api.auth || api.auth === 'bearer') headers.authorization = `Bearer ${key}`
      else headers[api.auth] = key
      return this.fetch(`${api.baseURL.replace(/\/$/, '')}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    })
    const data = await res.json().catch(() => null)
    const cost = this.price(api, data)
    this.meter.push({ api: apiId, kind: api.kind, purpose, status: res.status, cost })
    if (cost > 0) {
      if ((api.billing ?? 'per-call') === 'per-call') this.banker.pay(api.payee, cost, `${api.kind}: ${purpose}`)
      else this.owed.set(api.payee, (this.owed.get(api.payee) ?? 0) + cost)
    }
    return { status: res.status, body: data, cost }
  }

  /**
   * The cost of one call from the API's price card and the response's token usage.
   * @param {object} api - the API entry.
   * @param {any} data - the parsed response.
   * @returns {number} cost in the payee's token.
   */
  price(api, data) {
    const p = api.price ?? {}
    const u = data?.usage ?? {}
    return (p.perCall ?? 0) + (p.perInputToken ?? 0) * (u.prompt_tokens ?? 0) + (p.perOutputToken ?? 0) * (u.completion_tokens ?? 0)
  }

  /**
   * Pay everything accrued to each payee, such as a monthly hosting bill.
   * @returns {object[]} the payments made.
   */
  settle() {
    const paid = []
    for (const [payee, amount] of this.owed) {
      paid.push(this.banker.pay(payee, Math.round(amount * 1e6) / 1e6, 'accrued usage'))
      this.owed.delete(payee)
    }
    return paid
  }
}
