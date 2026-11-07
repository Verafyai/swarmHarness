#!/usr/bin/env node
/**
 * verafy: run Actually Smart Contracts through a network of harnessed validators.
 *
 *   verafy run <asc.json> [--live] [--json]   rule on a contract and seal a block
 *   verafy validate <asc.json>                check a contract
 *   verafy pin <asc.json>                     write SHA-256 pins for every context entry
 *   verafy seal <asc.json> <juror-dir...>     seal a block from reveals that separate
 *                                             harness processes wrote (DSH jurors)
 *   verafy chain                              print the local chain
 *   verafy doctor [--live]                    check Node, the pool, and each model endpoint
 *   verafy read solana <slot|genesis|account <pubkey>> [--config file]
 *                                             read the source chain across the light
 *                                             client's endpoints (read only, no keys)
 *   verafy confirm solana <signature> [--config file]
 *                                             confirm a transaction landed, through the outbox
 *   verafy harness commit-model <harness-id> <commitment> [--config file]
 *                                             publish a prover's model commitment (64 hex, such
 *                                             as FlashProve's commitment ID) on the harness card;
 *                                             L2 proofs are checked against it
 *
 * The light client is off unless the config has a `lightclient` block (see
 * config/lightclient.devnet.json and packages/lightclient). When it is on,
 * `run` checks the contract's escrow (payment.source) before the jury is drawn,
 * and a disagreement between sources pauses the contract and records why in
 * .verafy/pauses.jsonl.
 *
 * Mock mode (default) uses examples/mock-answers.json. --live calls real models
 * through the OpenAI-compatible endpoint in verafy.config.json (or, on a setup
 * from before the rename, swarm.config.json). The key is read from
 * VERAFY_API_KEY, else SWARM_API_KEY. The chain is written to .verafy/chain.json;
 * while .verafy/ is empty, an existing .swarm/chain.json is read as the parent.
 * `swarm` is kept as an alias for this command.
 */
import { readFile, writeFile, mkdir, readdir, appendFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Harness, drawJuryFor, rule, ruleFromReveals, seal, validate, pin, ascHash, short,
  mockProvider, openaiProvider, createRouter, configPath, chainPaths, envValue,
  fundingCheck, Outbox, PauseLog,
} from '../packages/core/src/index.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHAIN = chainPaths(ROOT)
const args = process.argv.slice(2)
const flag = f => args.includes(f)
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--config')
const [cmd, file, ...rest] = positional

const c = process.stdout.isTTY && !flag('--json')
  ? { b: s => `\x1b[1m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m`, g: s => `\x1b[32m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m`, a: s => `\x1b[34m${s}\x1b[0m` }
  : { b: s => s, d: s => s, g: s => s, y: s => s, a: s => s }

async function readJson(p) { return JSON.parse(await readFile(resolve(p), 'utf8')) }

/**
 * `verafy harness commit-model <id> <commitment>`: write the model commitment
 * onto one pool entry, so the harness's card carries it. It never reads a key.
 */
async function commitModel(id, commitment) {
  const i = args.indexOf('--config')
  const path = i >= 0 ? resolve(args[i + 1]) : configPath(ROOT)
  if (!id || !/^[0-9a-f]{64}$/.test(String(commitment))) {
    console.log('usage: verafy harness commit-model <harness-id> <commitment: 64 lowercase hex> [--config file]')
    process.exitCode = 2
    return
  }
  const config = await readJson(path)
  const entry = config.pool?.find(h => h.id === id)
  if (!entry) { console.log(`no harness "${id}" in ${path}`); process.exitCode = 1; return }
  const before = entry.modelCommitment ?? null
  entry.modelCommitment = commitment
  await writeFile(path, JSON.stringify(config, null, 2) + '\n')
  console.log(`${id}: model commitment ${before === commitment ? 'unchanged' : before ? `changed from ${short(before)} to` : 'set to'} ${commitment}`)
  console.log(`${path} updated. Restart the harness so its card carries the commitment; nodes check L2 proofs against it.`)
}

async function loadChain() {
  try { return await readJson(CHAIN.read) } catch { return [] }
}

/**
 * The live provider for one pool entry. An entry may override the default
 * endpoint, for example to point at a local vLLM server.
 * @param {object} config - the harness config.
 * @param {object} h - one pool entry.
 * @returns {object} an OpenAI-compatible provider.
 */
function providerFor(config, h) {
  const baseURL = h.baseURL ?? config.provider.baseURL
  // envValue reads VERAFY_* names and falls back to the SWARM_* names they replaced.
  const apiKey = envValue(h.apiKeyEnv ?? config.provider.apiKeyEnv ?? 'VERAFY_API_KEY')
  // Each harness retries 429, 5xx and network errors on its own, with backoff;
  // set provider.retry (or a pool entry's retry) to tune it, or false to disable.
  const retry = h.retry ?? config.provider.retry ?? {}
  return openaiProvider({ baseURL, apiKey, retry })
}

async function loadConfig() {
  const i = args.indexOf('--config')
  return readJson(i >= 0 ? args[i + 1] : configPath(ROOT))
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

/** The light client from config, loaded only when the config has a `lightclient` block. */
async function lightclientFor(config) {
  if (!config.lightclient) return null
  const { fromConfig } = await import('../packages/lightclient/index.js')
  return fromConfig(config.lightclient)
}

function printRead(r) {
  console.log(`${r.status === 'agreed' ? 'agreed ' : 'UNKNOWN'} ${r.chain} ${r.method} at ${r.commitment}, policy ${r.policy}, ${r.attempts} attempt(s): ${r.reason}`)
  for (const s of r.sources) console.log(`  ${s.verdict.padEnd(7)} ${s.id.padEnd(20)} ${s.operator.padEnd(12)} ${s.origin.padEnd(40)} slot ${s.slot ?? '-'}${s.error ? `  ${s.error}` : ''}`)
  if (r.status === 'agreed') console.log(`  value ${JSON.stringify(r.value)}${r.slot != null ? `  (agreed slot ${r.slot})` : ''}`)
}

async function readCommand(confirm) {
  const lc = await lightclientFor(await loadConfig())
  if (!lc?.solana || file !== 'solana') {
    console.log('usage: verafy read solana <slot|genesis|account <pubkey>> --config <file with a lightclient block> | verafy confirm solana <signature> --config <file>')
    process.exitCode = 2
    return
  }
  if (confirm) {
    const out = new Outbox({ sourceChain: lc.checker })
    const c = await out.confirm(out.record({ asc: 'cli', ruling: 'cli', trigger: { type: 'call', chain: 'solana' }, landed: { chain: 'solana', signature: rest[0] } }))
    printRead(c.read)
    console.log(`outbox: ${c.status}`)
    process.exitCode = c.status === 'confirmed' ? 0 : 1
    return
  }
  const [what, arg] = rest
  const r = what === 'slot' ? await lc.solana.slot() : what === 'genesis' ? await lc.solana.genesisHash() : what === 'account' && arg ? await lc.solana.account(arg) : null
  if (!r) { console.log('read what? slot, genesis, or account <pubkey>'); process.exitCode = 2; return }
  printRead(r)
  process.exitCode = r.status === 'agreed' ? 0 : 1
}

async function main() {
  if (cmd === 'doctor') return doctor()
  if (cmd === 'read') return readCommand(false)
  if (cmd === 'confirm') return readCommand(true)
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
  if (cmd === 'harness' && file === 'commit-model') return commitModel(rest[0], rest[1])
  if (cmd !== 'run' || !file) {
    console.log('usage: verafy run <asc.json> [--live] [--json] [--config file] | verafy seal <asc.json> <juror-dir...> | verafy doctor [--live] [--config file] | verafy validate <asc.json> | verafy pin <asc.json> | verafy chain | verafy read solana <slot|genesis|account <pubkey>> --config file | verafy confirm solana <signature> --config file')
    process.exitCode = 2
    return
  }

  const asc = await readJson(file)
  const config = await loadConfig()
  const lc = await lightclientFor(config)
  if (lc) {
    const pauses = new PauseLog()
    const funding = await fundingCheck(asc, { sourceChain: lc.checker, pauses })
    if (funding.read?.method) printRead(funding.read)
    if (pauses.entries.length) {
      await mkdir(CHAIN.dir, { recursive: true })
      await appendFile(join(CHAIN.dir, 'pauses.jsonl'), pauses.entries.map(e => JSON.stringify(e)).join('\n') + '\n')
    }
    if (!funding.ok) {
      console.log(`${funding.paused ? 'PAUSED' : 'REFUSED'} ${asc.id}: ${funding.problems.join('; ')}`)
      process.exitCode = 3
      return
    }
    if (!flag('--json')) console.log(c.d(`light client: ${funding.checked ? 'escrow funded' : funding.reason}`))
  }
  const script = flag('--live') ? null : await readJson(join(ROOT, 'examples', 'mock-answers.json'))
  const pool = config.pool.map(h => new Harness({ ...h, provider: flag('--live') ? providerFor(config, h) : mockProvider(script, asc.id, h.lab) }))
  const chain = await loadChain()
  const parent = chain.at(-1) ?? null
  const jury = drawJuryFor(asc, pool, parent?.hash ?? 'genesis')
  const sealer = pool.find(h => !jury.includes(h)) ?? jury[0]
  const log = flag('--json') ? () => {} : event => print(event, asc)

  if (!flag('--json')) {
    console.log(c.b(`\n${asc.title}`))
    console.log(c.d(`mode ${flag('--live') ? 'live models' : 'mock answers'} · escrow ${asc.payment.escrow} ${asc.payment.currency} · bar ${pct(asc.payment.bar)} · jury ${asc.payment.jury.size} across ${asc.payment.jury.minLabs}+ labs`))
  }
  const ruling = await rule(asc, jury, sealer, log, { seed: parent?.hash ?? 'genesis' })
  const block = seal(parent, [ruling], sealer)
  const router = createRouter(config.payments)
  const payouts = ruling.passed ? await router.settle(ruling, asc, config.payments?.book) : []
  await mkdir(CHAIN.dir, { recursive: true })
  await writeFile(CHAIN.write, JSON.stringify([...chain, block], null, 2))
  if (flag('--json')) { console.log(JSON.stringify(block, null, 2)); return }
  console.log(c.b('\nSEAL'))
  console.log(`  block ${block.height}  ${short(block.hash)}  parent ${short(block.parent)}  sealed by ${block.sealer}`)
  console.log(c.d(`  rulings root ${short(block.rulingsRoot)} · written to .verafy/chain.json`))
  console.log(c.d(`  payment router ${router.name}: ${payouts.length} payouts in ${asc.payment.currency}${asc.payment.chain ? ` on ${asc.payment.chain}` : ''}${router.name === 'ledger' ? ` recorded to ${config.payments?.file ?? '.verafy/payouts.jsonl'}` : ''}\n`))
}

/**
 * Seal a block from commitments and reveals written by separate harness
 * processes. Each juror directory holds `<ascHash>.commit.json` and
 * `<ascHash>.reveal.json`. The sealer is a pool harness from verafy.config.json
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
  const config = await readJson(configPath(ROOT))
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
  await mkdir(CHAIN.dir, { recursive: true })
  await writeFile(CHAIN.write, JSON.stringify([...chain, block], null, 2))
  if (flag('--json')) { console.log(JSON.stringify(block, null, 2)); return }
  console.log(c.b('\nSEAL'))
  console.log(`  block ${block.height}  ${short(block.hash)}  parent ${short(block.parent)}  sealed by ${block.sealer}`)
  console.log(c.d(`  rulings root ${short(block.rulingsRoot)} · written to .verafy/chain.json`))
  console.log(c.d(`  payment router ${router.name}: ${payouts.length} payouts in ${asc.payment.currency}${asc.payment.chain ? ` on ${asc.payment.chain}` : ''}${router.name === 'ledger' ? ` recorded to ${config.payments?.file ?? '.verafy/payouts.jsonl'}` : ''}\n`))
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
