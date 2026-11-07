#!/usr/bin/env node
/**
 * Run a screen over the labeled calibration set and compute its cutoffs
 * (ROUTE-007). The cutoffs are what the router may use outside shadow mode;
 * a kind with no cutoff is never settled by the screen.
 *
 *   node scripts/calibrate-screen.mjs --screen jev      needs JEV_URL and JEV_API_KEY
 *   node scripts/calibrate-screen.mjs --screen model --model <id>   any OpenAI-compatible model as the screen (VERAFY_API_KEY)
 *   node scripts/calibrate-screen.mjs --screen simulated            a simulated screen, to check the pipeline only
 *   [--set examples/calibration/atoms.jsonl] [--target 0.97] [--out docs/calibration/<name>.json]
 *
 * The Jev request shape ({question, facts, options, range} -> {label, probability})
 * is this repo's assumption: TypeSafe's API is not public. Adjust `jevCall` to
 * the real one when access arrives.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { jevScreen, calibrate } from '../packages/route/src/index.js'
import { openaiProvider, apiKeyFromEnv } from '../packages/core/src/index.js'

const { values: a } = parseArgs({ options: { screen: { type: 'string', default: 'simulated' }, model: { type: 'string' }, set: { type: 'string', default: 'examples/calibration/atoms.jsonl' }, target: { type: 'string', default: '0.97' }, out: { type: 'string' }, limit: { type: 'string' } } })
let atoms = readFileSync(a.set, 'utf8').trim().split('\n').map(l => JSON.parse(l))
if (a.limit) atoms = atoms.slice(0, Number(a.limit))

function screenFor(kind) {
  if (kind === 'jev') {
    const url = process.env.JEV_URL, key = process.env.JEV_API_KEY
    if (!url || !key) { console.error('set JEV_URL and JEV_API_KEY'); process.exit(2) }
    return jevScreen({ call: async body => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`jev HTTP ${r.status}`); return r.json() } })
  }
  if (kind === 'model') {
    const p = openaiProvider({ baseURL: process.env.VERAFY_BASE_URL ?? 'https://openrouter.ai/api/v1', apiKey: apiKeyFromEnv() })
    return jevScreen({ usd: 0, ms: 0, call: async ({ question, facts, options }) => {
      const out = await p.complete({ model: a.model, system: `Answer from the facts only. Reply with JSON only: {"label": one of ${JSON.stringify([...options, 'UNKNOWN'])}, "probability": your probability that the label is right, 0 to 1}. If the facts do not settle it, label UNKNOWN.`, user: `Facts:\n${facts.map(f => `- ${f}`).join('\n')}\n\nQuestion: ${question}` })
      return JSON.parse(String(out).replace(/^```(?:json)?\s*|\s*```$/g, ''))
    } })
  }
  // Simulated: right 96% of the time, confident when right, less so when wrong. Checks the pipeline, says nothing about any real screen.
  let s = 7
  const r = () => { s = (s * 1103515245 + 12345) % 2 ** 31; return s / 2 ** 31 }
  return jevScreen({ call: async ({ question, facts }) => {
    const atom = atoms.find(x => x.q === question && x.facts[0].text === facts[0])
    const right = r() < 0.96
    const truth = atom.truth === null ? 'UNKNOWN' : atom.truth ? 'YES' : 'NO'
    const label = right ? truth : (truth === 'YES' ? 'NO' : 'YES')
    return { label, probability: right ? 0.85 + r() * 0.15 : 0.5 + r() * 0.45 }
  } })
}

const screen = screenFor(a.screen)
const records = []
let errors = 0
const t0 = Date.now()
for (const atom of atoms) {
  let d
  try { d = await screen.decide(atom) } catch (err) { errors++; d = { answer: undefined, p: 0 } }
  const correct = d.answer === atom.truth
  records.push({ id: atom.id, type: atom.kind, p: d.p, answer: d.answer ?? null, truth: atom.truth, correct })
}
const ms = Date.now() - t0
const cutoffs = calibrate(records, { target: Number(a.target) })
const byKind = {}
for (const r of records) { const k = (byKind[r.type] ??= { n: 0, correct: 0 }); k.n++; if (r.correct) k.correct++ }
const report = { screen: a.screen, model: a.model ?? null, set: a.set, atoms: records.length, errors, target: Number(a.target), measuredAt: new Date().toISOString(), wallMs: ms, label: a.screen === 'simulated' ? 'simulated: checks the pipeline only' : 'measured', accuracyByKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, Math.round((v.correct / v.n) * 1000) / 1000])), cutoffs, records }
console.log(`${report.label}. ${records.length} atoms, ${errors} errors, ${ms} ms`)
for (const [k, c] of Object.entries(cutoffs)) console.log(`  ${k.padEnd(10)} accuracy ${report.accuracyByKind[k]}  ${c.cutoff === null ? 'no cutoff: never settles' : `cutoff p >= ${c.cutoff.toFixed(3)}, settles ${Math.round(c.coverage * 100)}%, lower bound ${c.lower.toFixed(3)}`}`)
if (a.out) { mkdirSync(dirname(a.out), { recursive: true }); writeFileSync(a.out, JSON.stringify(report, null, 2) + '\n') }
