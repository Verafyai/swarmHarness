#!/usr/bin/env node
/**
 * verafy-mcp: the Verafy Harness MCP server, over stdio.
 *
 *   verafy-mcp [--allow-live] [--home <dir>] [--config <file>]
 *
 *   --allow-live      let verafy_run and verafy_doctor call real models (also VERAFY_ALLOW_LIVE=1).
 *                     Each live call still needs live: true and a maxSpendUsd.
 *   --home <dir>      the workspace, where the chain and pinned files are written.
 *                     Default: VERAFY_HOME, else PLUGIN_DATA (Hermes), else ~/.verafy.
 *   --config <file>   the harness config. Default: <workspace>/verafy.config.json if it
 *                     exists, else the verafy.config.json that ships with the harness.
 *
 * Keys are read from the environment only: VERAFY_API_KEY, else SWARM_API_KEY.
 * stdout carries JSON-RPC only; notes go to stderr.
 */
import { createServer } from './server.js'
import { serveStdio } from './jsonrpc.js'
import { workspaceDir } from './workspace.js'

const args = process.argv.slice(2)
const value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }

if (args.includes('--help') || args.includes('-h')) {
  process.stderr.write('usage: verafy-mcp [--allow-live] [--home <dir>] [--config <file>]\n')
  process.exit(0)
}

const allowLive = args.includes('--allow-live') || process.env.VERAFY_ALLOW_LIVE === '1'
const workspace = workspaceDir({ home: value('--home') })
const log = line => process.stderr.write(`verafy-mcp: ${line}\n`)

const dispatch = createServer({ workspace, allowLive, configFile: value('--config'), log })
log(`ready; workspace ${workspace}; live calls ${allowLive ? 'allowed with a spend cap' : 'off'}`)
await serveStdio(dispatch)
