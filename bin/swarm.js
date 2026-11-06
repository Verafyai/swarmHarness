#!/usr/bin/env node
/**
 * swarm: run Actually Smart Contracts through a network of harnessed validators.
 *
 *   swarm run <asc.json> [--live] [--json]   rule on a contract and seal a block
 *   swarm validate <asc.json>                check a contract
 *   swarm pin <asc.json>                     write SHA-256 pins for every context entry
 *   swarm seal <asc.json> <juror-dir...>     seal a block from reveals that separate
 *                                            harness processes wrote (DSH jurors)
 *   swarm chain                              print the local chain
 *   swarm doctor [--live]                    check Node, the pool, and each model endpoint
 *
 * Mock mode (default) uses examples/mock-answers.json. --live calls real models
 * through the OpenAI-compatible endpoint in swarm.config.json.
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Harness, drawJury, rule, ruleFromReveals, seal, validate, pin, ascHash, short,
  mockProvider, openaiProvider, createRouter,
} from '../packages/swarm-core/src/index.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHAIN = join(ROOT, '.swarm', 'chain.json')
const args = process.argv.slice(2)
const flag = f => args.includes(f)
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--config')
const [cmd, file, ...rest] = positional

const c = process.stdout.isTTY && !flag('--json')
  ? { b: s => `\x1b[1m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m`, g: s => `\x1b[32m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m`, a: s => `\x1b[34m${s}\x1b[0m` }
  : { b: s => s, d: s => s, g: s => s, y: s => s, a: s => s }

async function readJson(p) { return JSON.parse(await readFile(resolve(p), 'utf8')) }

async function loadChain() {
  try { return await readJson(CHAIN) } catch { return [] }
}

/**
 * The live provider for one pool entry. An entry may override the default
 * endpoint, for example to point at a local vLLM server.
 * @param {object} config - the swarm config.
 * @param {object} h - one pool entry.
 * @returns {object} an OpenAI-compatible provider.
 */
function providerFor(config, h) {
  const baseURL = h.baseURL ?? config.provider.baseURL
  const apiKey = process.env[h.apiKeyEnv ?? config.provider.apiKeyEnv]
  return openaiProvider({ baseURL, apiKey })
}

async function loadConfig() {
  const i = args.indexOf('--config')
  return readJson(i >= 0 ? args[i + 1] : join(ROOT, 'swarm.config.json'))
}

async function doctor() {
  const config = await loadConfig()
  const major = Number(process.versions.node.split('.')[0])
  console.log(`${major >= 22 ? 'ok  ' : 'FAIL'} node ${process.versions.node} (need 22 or later)`)
  const labs = new Set(config.pool.map(h => h.lab))
  console.log(`ok   pool: ${config.pool.length} harnesses across ${labs.size} labs`)
  if (!flag('--live')) { console.log('skip model checks (add --live to call each model once)'); return }
  for (const h of config.pool) {
    const t = Date.now()
    try {
      const out = await providerFor(config, h).complete({ model: h.model, system: 'Reply with JSON only.', user: 'Return {"ok": true}.' })
      console.log(`ok   ${h.id.padEnd(16)} ${h.model}  ${Date.now() - t} ms  ${out.slice(0, 40).replace(/\s+/g, ' ')}`)
    } catch (err) {
      console.log(`FAIL ${h.id.padEnd(16)} ${h.model}  ${err.message.slice(0, 120)}`)
      process.exitCode = 1
    }
  }
}

async function main() {
  if (cmd === 'doctor') return doctor()
  if (cmd === 'validate') {
    const problems = validate(await readJson(file))
    console.log(problems.length ? problems.map(p => `- ${p}`).join('\n') : 'valid')
    process.exitCode = problems.length ? 1 : 0
    return
  }
  if (cmd === 'pin') {
    const pinned = pin(await readJson(file))
    await writeFile(resolve(file), JSON.stringify(pinned, null, 2) + '\n')
    console.log(`pinned ${pinned.context.length} context entries; asc ${short(ascHash(pinned))}`)
    return
  }
  if (cmd === 'chain') {
    for (const b of await loadChain()) console.log(`block ${b.height}  ${short(b.hash)}  parent ${short(b.parent)}  ${b.rulings.map(r => `${r.asc}: ${r.passed ? r.exit : 'below bar'}`).join(', ')}`)
    return
  }
  if (cmd === 'seal' && file && rest.length) return sealFromJurors(await readJson(file), rest)
  if (cmd !== 'run' || !file) {
    console.log('usage: swarm run <asc.json> [--live] [--json] [--config file] | swarm seal <asc.json> <juror-dir...> | swarm doctor [--live] [--config file] | swarm validate <asc.json> | swarm pin <asc.json> | swarm chain')
    process.exitCode = 2
    return
  }

  const asc = await readJson(file)
  const config = await loadConfig()
  const script = flag('--live') ? null : await readJson(join(ROOT, 'examples', 'mock-answers.json'))
  const pool = config.pool.map(h => new Harness({ ...h, provider: flag('--live') ? providerFor(config, h) : mockProvider(script, asc.id, h.lab) }))
  const chain = await loadChain()
  const parent = chain.at(-1) ?? null
  const jury = drawJury(pool, asc.payment.jury, parent?.hash ?? 'genesis')
  const sealer = pool.find(h => !jury.includes(h)) ?? jury[0]
  const log = flag('--json') ? () => {} : event => print(event, asc)

  if (!flag('--json')) {
    console.log(c.b(`\n${asc.title}`))
    console.log(c.d(`mode ${flag('--live') ? 'live models' : 'mock answers'} · escrow ${asc.payment.escrow} ${asc.payment.currency} · bar ${pct(asc.payment.bar)} · jury ${asc.payment.jury.size} across ${asc.payment.jury.minLabs}+ labs`))
  }
  const ruling = await rule(asc, jury, sealer, log)
  const block = seal(parent, [ruling], sealer)
  const router = createRouter(config.payments)
  const payouts = ruling.passed ? await router.settle(ruling, asc, config.payments?.book) : []
  await mkdir(dirname(CHAIN), { recursive: true })
  await writeFile(CHAIN, JSON.stringify([...chain, block], null, 2))
  if (flag('--json')) { console.log(JSON.stringify(block, null, 2)); return }
  console.log(c.b('\nSEAL'))
  console.log(`  block ${block.height}  ${short(block.hash)}  parent ${short(block.parent)}  sealed by ${block.sealer}`)
  console.log(c.d(`  rulings root ${short(block.rulingsRoot)} · written to .swarm/chain.json`))
  console.log(c.d(`  payment router ${router.name}: ${payouts.length} payouts in ${asc.payment.currency}${asc.payment.chain ? ` on ${asc.payment.chain}` : ''}${router.name === 'ledger' ? ' recorded to .swarm/payouts.jsonl' : ''}\n`))
}

/**
 * Seal a block from commitments and reveals written by separate harness
 * processes. Each juror directory holds `<ascHash>.commit.json` and
 * `<ascHash>.reveal.json`. The sealer is a pool harness from swarm.config.json
 * that did not sit on the jury.
 */
async function sealFromJurors(asc, dirs) {
  const h = ascHash(asc)
  const entries = []
  for (const d of dirs) {
    const files = await readdir(resolve(d))
    if (!files.includes(`${h}.commit.json`)) { console.error(`${d}: no commitment for contract ${short(h)}`); continue }
    const c = await readJson(join(d, `${h}.commit.json`))
    const reveal = files.includes(`${h}.reveal.json`) ? await readJson(join(d, `${h}.reveal.json`)) : null
    entries.push({ card: c.card, commit: c, reveal })
  }
  const config = await readJson(join(ROOT, 'swarm.config.json'))
  const sealer = new Harness({ ...config.pool.find(p => !entries.some(e => e.card.id === p.id)) ?? config.pool[0], provider: null })
  const chain = await loadChain()
  const parent = chain.at(-1) ?? null
  if (!flag('--json')) {
    console.log(c.b(`\n${asc.title}`))
    console.log(c.d(`mode reveals from ${entries.length} harness processes · escrow ${asc.payment.escrow} ${asc.payment.currency} · bar ${pct(asc.payment.bar)} · jury ${asc.payment.jury.size} across ${asc.payment.jury.minLabs}+ labs`))
  }
  const ruling = ruleFromReveals(asc, entries, sealer.id, parent?.hash ?? 'genesis', flag('--json') ? () => {} : event => print(event, asc))
  const block = seal(parent, [ruling], sealer)
  const router = createRouter(config.payments)
  const payouts = ruling.passed ? await router.settle(ruling, asc, config.payments?.book) : []
  await mkdir(dirname(CHAIN), { recursive: true })
  await writeFile(CHAIN, JSON.stringify([...chain, block], null, 2))
  if (flag('--json')) { console.log(JSON.stringify(block, null, 2)); return }
  console.log(c.b('\nSEAL'))
  console.log(`  block ${block.height}  ${short(block.hash)}  parent ${short(block.parent)}  sealed by ${block.sealer}`)
  console.log(c.d(`  rulings root ${short(block.rulingsRoot)} · written to .swarm/chain.json`))
  console.log(c.d(`  payment router ${router.name}: ${payouts.length} payouts in ${asc.payment.currency}${asc.payment.chain ? ` on ${asc.payment.chain}` : ''}${router.name === 'ledger' ? ' recorded to .swarm/payouts.jsonl' : ''}\n`))
}

function print(e, asc) {
  if (e.phase === 'propose') {
    console.log(c.b('\nPROPOSE'))
    console.log(`  asc ${short(e.ascHash)} · ${asc.context.length} context entries pinned`)
    for (const j of e.jury) console.log(`  ${c.a('harness')} ${j.id.padEnd(15)} ${j.lab.padEnd(10)} ${c.d(j.model)}`)
  }
  if (e.phase === 'commit') {
    console.log(c.b('\nCOMMIT'))
    for (const x of e.commitments) console.log(`  ${x.harness.padEnd(15)} ${c.d('commitment')} ${short(x.commitment)}`)
  }
  if (e.phase === 'reveal-failed') console.log(c.y(`  ${e.harness} reveal rejected: it does not match the commitment or signature`))
  if (e.phase === 'commit-failed') console.log(c.y(`  ${e.harness} dropped: ${e.error}`))
  if (e.phase === 'reveal') {
    console.log(c.b('\nREVEAL'))
    for (const v of e.votes) console.log(`  ${v.harness.padEnd(15)} ${String(v.answer).padEnd(12)} ${c.d(`confidence ${v.confidence}`)}`)
  }
  if (e.phase === 'rule') {
    const r = e.ruling
    console.log(c.b('\nRULE'))
    console.log(`  answer ${c.b(String(r.answer))} · agreement ${pct(r.agreement)} against a bar of ${pct(r.bar)} · ${r.passed ? c.g('final') : c.y('below the bar')}`)
    for (const d of r.dissent) console.log(c.d(`  dissent ${d.harness}: ${d.answer}. ${d.reasoning}`))
    console.log(`  exit ${r.exit} → ${r.effect.type}${r.effect.target ? ` ${r.effect.target}(${(r.effect.args ?? []).join(', ')})` : ''}`)
    console.log(c.b('\nPAY'))
    for (const d of r.diff) console.log(`  ${d.account.padEnd(36)} ${(d.delta >= 0 ? '+' : '') + d.delta.toFixed(4)}`)
    for (const t of r.triggers) console.log(c.a(`  trigger ${t.type}${t.chain ? ` on ${t.chain}: ${t.target}(${t.args.join(', ')})` : `: jury of ${t.jurySize}`}`))
  }
}

function pct(x) { return `${Math.round(x * 100)}%` }

main().catch(err => { console.error(err.message); process.exitCode = 1 })
