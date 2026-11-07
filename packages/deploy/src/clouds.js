/**
 * Thin clients for the clouds `verafy up` can create a server on. Each takes
 * the account's API token from the caller (read from the environment by the
 * CLI, never stored), creates one server with the first-boot script as user
 * data, and returns its id and address. Plans and prices are the provider's
 * and change; `verafy up` prints the plan it picked so the operator can check.
 *
 * @module @verafyharness/deploy/clouds
 */

async function call(f, url, token, method = 'GET', body) {
  const res = await f(url, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${new URL(url).host}: ${json.message ?? json.error?.message ?? `HTTP ${res.status}`}`)
  return json
}

/** Server sizes by need: `api` calls a hosted model; `small`, `mid` run open weights on the CPU. */
export const PLANS = Object.freeze({
  digitalocean: { api: 's-1vcpu-2gb', small: 's-4vcpu-16gb', mid: 's-8vcpu-32gb' },
  hetzner: { api: 'cx22', small: 'cx42', mid: 'cx52' },
})

export const CLOUDS = Object.freeze({
  digitalocean: {
    name: 'DigitalOcean',
    tokenEnv: 'DIGITALOCEAN_TOKEN',
    defaultRegion: 'sfo3',
    /** @returns {Promise<{id: string, name: string, plan: string, region: string}>} */
    async create({ token, name, plan, region, userData, sshKeys = [], fetch: f = globalThis.fetch }) {
      const r = await call(f, 'https://api.digitalocean.com/v2/droplets', token, 'POST', {
        name, region, size: plan, image: 'ubuntu-24-04-x64', user_data: userData, ssh_keys: sshKeys, tags: ['verafy-harness'], monitoring: true,
      })
      return { id: String(r.droplet.id), name, plan, region }
    },
    /** @returns {Promise<{status: string, ip: string|null}>} */
    async status({ token, id, fetch: f = globalThis.fetch }) {
      const r = await call(f, `https://api.digitalocean.com/v2/droplets/${encodeURIComponent(id)}`, token)
      const ip = r.droplet.networks?.v4?.find(n => n.type === 'public')?.ip_address ?? null
      return { status: r.droplet.status, ip }
    },
  },
  hetzner: {
    name: 'Hetzner Cloud',
    tokenEnv: 'HCLOUD_TOKEN',
    defaultRegion: 'hil',
    async create({ token, name, plan, region, userData, sshKeys = [], fetch: f = globalThis.fetch }) {
      const r = await call(f, 'https://api.hetzner.cloud/v1/servers', token, 'POST', {
        name, server_type: plan, location: region, image: 'ubuntu-24.04', user_data: userData, ssh_keys: sshKeys, labels: { app: 'verafy-harness' }, start_after_create: true,
      })
      return { id: String(r.server.id), name, plan, region }
    },
    async status({ token, id, fetch: f = globalThis.fetch }) {
      const r = await call(f, `https://api.hetzner.cloud/v1/servers/${encodeURIComponent(id)}`, token)
      return { status: r.server.status, ip: r.server.public_net?.ipv4?.ip ?? null }
    },
  },
})

/** A server name a provider accepts: lowercase letters, digits and dashes. */
export function serverName(harnessId) {
  return `verafy-${String(harnessId).toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`.slice(0, 60).replace(/-+$/, '')
}
