#!/usr/bin/env node
/**
 * A raw JSON-RPC smoke test for the MCP server, with no install: spawn
 * bin/verafy-mcp.js (or the command given after --), speak MCP over stdio,
 * and print what comes back. Mock mode only, in a temporary workspace.
 *
 *   node scripts/mcp-smoke.mjs
 *   node scripts/mcp-smoke.mjs -- npx -y -p github:Verafyai/verafyHarness verafy-mcp
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const i = process.argv.indexOf('--')
const [cmd, ...args] = i >= 0 ? process.argv.slice(i + 1) : [process.execPath, join(ROOT, 'bin', 'verafy-mcp.js')]
const home = mkdtempSync(join(tmpdir(), 'verafy-smoke-'))
const env = { ...process.env, VERAFY_HOME: home }
delete env.VERAFY_API_KEY
delete env.SWARM_API_KEY
const child = spawn(cmd, args, { cwd: ROOT, env, stdio: ['pipe', 'pipe', 'inherit'] })

let buf = ''
const waiting = new Map()
child.stdout.setEncoding('utf8')
child.stdout.on('data', d => {
  buf += d
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const msg = JSON.parse(buf.slice(0, nl))
    buf = buf.slice(nl + 1)
    waiting.get(msg.id)?.(msg)
  }
})
let id = 0
const request = (method, params) => new Promise((res, rej) => {
  const n = ++id
  const t = setTimeout(() => rej(new Error(`timeout on ${method}`)), 180000)
  waiting.set(n, m => { clearTimeout(t); res(m) })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, ...(params ? { params } : {}) }) + '\n')
})

const fail = []
const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) fail.push(label) }

const init = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'mcp-smoke', version: '1' } })
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
check(init.result?.serverInfo?.name === 'verafy-harness', `initialize: ${init.result?.serverInfo?.name} ${init.result?.serverInfo?.version}, protocol ${init.result?.protocolVersion}`)
const tools = (await request('tools/list')).result?.tools ?? []
check(tools.length === 8, `tools/list: ${tools.map(t => t.name).join(', ')}`)
const v = (await request('tools/call', { name: 'verafy_validate', arguments: { path: 'examples/market-resolution.json' } })).result
check(v?.structuredContent?.ok === true, `verafy_validate examples/market-resolution.json: ${JSON.stringify(v?.structuredContent)}`)
const r = (await request('tools/call', { name: 'verafy_run', arguments: { path: 'examples/market-resolution.json' } })).result?.structuredContent
check(r?.block?.height === 1, `verafy_run (mock): answer ${r?.answer}, agreement ${r?.agreement?.value} against a bar of ${r?.agreement?.bar}, block ${r?.block?.height} ${r?.block?.hash?.slice(0, 8)}`)
const live = (await request('tools/call', { name: 'verafy_run', arguments: { path: 'examples/market-resolution.json', live: true, maxSpendUsd: 1 } })).result?.structuredContent
check(live?.error?.code === 'LIVE_DISABLED', `verafy_run live without --allow-live: ${live?.error?.code}`)
const d = (await request('server/discover', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } })).result
check(d?.supportedVersions?.[0] === '2026-07-28', `server/discover: ${d?.supportedVersions?.join(', ')}`)
const res = (await request('resources/list')).result?.resources ?? []
check(res.length >= 8, `resources/list: ${res.length} resources`)
const prompts = (await request('prompts/list')).result?.prompts ?? []
check(prompts.length === 2, `prompts/list: ${prompts.map(p => p.name).join(', ')}`)
child.stdin.end()
console.log(fail.length ? `${fail.length} failed` : 'smoke test passed')
process.exitCode = fail.length ? 1 : 0
