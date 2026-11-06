#!/usr/bin/env node
/**
 * Run Swarm jurors as DeepSeek Harness processes (ROADMAP.md, milestone 2).
 *
 *   node scripts/dsh-juror.mjs setup
 *       link the plugin's peers and mount it in the headless profile
 *   node scripts/dsh-juror.mjs vote --lab anthropic [--route scripted|openrouter] [--asc file] [--probe]
 *       one DSH juror loads the contract and casts a committed vote
 *   node scripts/dsh-juror.mjs jury [--route scripted|openrouter] [--asc file] [--probe]
 *       five DSH jurors on five labs' routes vote in parallel, then the CLI seals
 *       the block from their reveals (node bin/swarm.js seal ...)
 *
 * --route scripted (the default) uses scripts/scripted-llm.mjs and needs no key.
 * --route openrouter uses the live openrouter-<lab> routes and needs SWARM_API_KEY.
 * --probe makes the scripted model try a non-swarm tool first, to show the lock.
 *
 * DSH state lives in .dsh/ (gitignored): DSH_HOME at .dsh/home, juror keys and
 * votes at .dsh/jurors/<harness>, logs at .dsh/logs. The upstream tree is never
 * written to.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH = join(ROOT, 'upstream', 'deepseek-harness')
const STATE = join(ROOT, '.dsh')
const HOME = join(STATE, 'home')
const PROFILE = join(HOME, 'profiles', 'headless')
const LABS = ['anthropic', 'openai', 'google', 'meta', 'qwen']
const PORT = 8790

const argv = process.argv.slice(2)
const cmd = argv[0]
const opt = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback }
const route = opt('--route', 'scripted')
const ascPath = resolve(opt('--asc', join(ROOT, 'examples', 'market-resolution.json')))
const probe = argv.includes('--probe')
const config = JSON.parse(readFileSync(join(ROOT, 'swarm.config.json'), 'utf8'))
const { ascHash } = await import(join(ROOT, 'packages', 'swarm-core', 'src', 'index.js'))
const H = ascHash(JSON.parse(readFileSync(ascPath, 'utf8')))

// Each juror runs with its own empty directory as the workspace, so DSH finds
// no workspace files to read; tsx and the CLI entry are loaded from the DSH tree.
const TSX = pathToFileURL(createRequire(join(DSH, 'package.json')).resolve('tsx/esm')).href
function dsh(args, env, cwd) {
  return spawn(process.execPath, ['--import', TSX, join(DSH, 'apps', 'cli', 'src', 'bin.ts'), ...args], { cwd, env: { ...process.env, DSH_HOME: HOME, TSX_TSCONFIG_PATH: join(DSH, 'tsconfig.json'), ...env }, stdio: 'pipe' })
}

function setup() {
  if (!existsSync(join(DSH, 'node_modules')) || !existsSync(join(DSH, 'packages', 'core', 'tools', 'lib', 'index.js'))) {
    throw new Error('DSH is not built. Run: git submodule update --init --depth 1 && cd upstream/deepseek-harness && CI=true npx -y pnpm@11.28.5 install --frozen-lockfile && CI=true npx -y pnpm@11.28.5 run build')
  }
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'dsh-link.mjs')], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('dsh-link failed')
  if (!existsSync(join(PROFILE, 'package.json'))) {
    // The first launch of a profile initializes it from the shipped template.
    const init = spawnSync(process.execPath, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'headless', '--help'], { cwd: DSH, env: { ...process.env, DSH_HOME: HOME }, stdio: 'ignore' })
    if (init.status !== 0 || !existsSync(join(PROFILE, 'package.json'))) throw new Error('could not initialize the headless profile')
  }
  const at = join(PROFILE, 'node_modules', '@swarmharness', 'dsh-swarm-juror')
  mkdirSync(dirname(at), { recursive: true })
  rmSync(at, { force: true, recursive: true })
  symlinkSync(join(ROOT, 'packages', 'dsh-swarm-juror'), at, 'dir')
  console.log(`mounted @swarmharness/dsh-swarm-juror in ${at.replace(ROOT + '/', '')}`)
}

/** The harness and route a lab's juror runs as. */
function seat(lab) {
  const h = config.pool.find(p => p.lab === lab)
  if (!h) throw new Error(`no ${lab} harness in swarm.config.json`)
  const model = route === 'scripted' ? `scripted-${lab}` : h.model
  return { ...h, model, route: `${route}-${lab}`, out: join(STATE, 'jurors', h.id) }
}

function vote(lab) {
  const s = seat(lab)
  mkdirSync(join(STATE, 'logs'), { recursive: true })
  const env = {
    SWARM_ROUTE: s.route, SWARM_MODEL: s.model, SWARM_HARNESS_ID: s.id, SWARM_HARNESS_LAB: s.lab,
    SWARM_JUROR_OUT: s.out, SWARM_SCRIPTED_URL: `http://127.0.0.1:${PORT}/v1`, SWARM_SCRIPTED_KEY: 'scripted',
  }
  mkdirSync(s.out, { recursive: true, mode: 0o700 })
  // A fresh vote replaces any earlier one for this contract.
  for (const f of ['commit', 'reveal']) rmSync(join(s.out, `${H}.${f}.json`), { force: true })
  const task = `Rule on the contract at ${ascPath}`
  const args = ['--profile', 'headless', '--patch', join(ROOT, 'config', 'cordis.swarm.yml'), task]
  const started = Date.now()
  return new Promise(done => {
    const child = dsh(args, env, s.out)
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    child.on('close', code => {
      writeFileSync(join(STATE, 'logs', `${s.id}.log`), out)
      const f = join(s.out, `${H}.commit.json`)
      const commitment = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).commitment : null
      done({ seat: s, code, ms: Date.now() - started, out: out.trim(), commitment })
    })
  })
}

async function scripted() {
  if (route !== 'scripted') return null
  mkdirSync(join(STATE, 'logs'), { recursive: true })
  const child = spawn(process.execPath, [join(ROOT, 'scripts', 'scripted-llm.mjs'), '--port', String(PORT), '--asc', ascPath, ...(probe ? ['--probe'] : [])], { stdio: ['ignore', 'pipe', 'inherit'] })
  let log = ''
  await new Promise((ok, fail) => {
    child.stdout.on('data', d => { log += d; if (log.includes('"ready"')) ok() })
    child.on('exit', code => fail(new Error(`scripted server exited ${code}`)))
  })
  return { stop: () => { child.kill(); writeFileSync(join(STATE, 'logs', 'scripted-llm.jsonl'), log) }, log: () => log }
}

function report(r) {
  const c = r.commitment
  console.log(`${r.seat.id.padEnd(15)} ${r.seat.route.padEnd(22)} ${r.seat.model.padEnd(28)} exit ${r.code}  ${(r.ms / 1000).toFixed(1)}s  ${c ? `commitment ${c}` : 'no commitment'}`)
  if (r.out) console.log(r.out.split('\n').map(l => `    dsh: ${l}`).join('\n'))
  return c
}

async function main() {
  if (cmd === 'setup') return setup()
  if (!['vote', 'jury'].includes(cmd)) {
    console.log('usage: dsh-juror.mjs setup | vote --lab <lab> [--route scripted|openrouter] [--asc file] [--probe] | jury [--route ...] [--asc file] [--probe]')
    process.exitCode = 2
    return
  }
  if (route === 'openrouter' && !process.env.SWARM_API_KEY) throw new Error('--route openrouter needs SWARM_API_KEY in the environment')
  const labs = cmd === 'vote' ? [opt('--lab', 'anthropic')] : LABS
  const server = await scripted()
  try {
    const results = await Promise.all(labs.map(vote))
    const commits = []
    for (const r of results) commits.push(report(r))
    if (cmd === 'vote' || commits.some(c => !c)) { process.exitCode = commits.every(Boolean) ? 0 : 1; return }
    const dirs = results.map(r => r.seat.out)
    console.log(`\nnode bin/swarm.js seal ${ascPath.replace(ROOT + '/', '')} ${dirs.map(d => d.replace(ROOT + '/', '')).join(' ')}`)
    const sealed = spawnSync(process.execPath, [join(ROOT, 'bin', 'swarm.js'), 'seal', ascPath, ...dirs], { cwd: ROOT, stdio: 'inherit' })
    process.exitCode = sealed.status
  } finally {
    server?.stop()
  }
}

main().catch(err => { console.error(err.message); process.exitCode = 1 })
