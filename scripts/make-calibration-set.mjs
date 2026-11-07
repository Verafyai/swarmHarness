#!/usr/bin/env node
/**
 * Build the labeled calibration set (ROUTE-007): atoms whose right answer is
 * known by construction, so a screen can be scored without a human labeler.
 * Deterministic: the same seed writes the same file.
 *
 * Kinds (the router calibrates per kind):
 *   compare     two figures in the facts; is one larger?
 *   deadline    an event date against a deadline
 *   tally       a vote count against a threshold
 *   presence    does the record list an item?
 *   unsettled   the facts do not decide it; the right answer is UNKNOWN
 *
 *   node scripts/make-calibration-set.mjs [--n 100] > examples/calibration/atoms.jsonl
 */
import { createHash } from 'node:crypto'
const n = Number(process.argv[process.argv.indexOf('--n') + 1] || 100)
let s = 0x9e3779b9
const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1_000_000) / 1_000_000 }
const pick = a => a[Math.floor(rnd() * a.length)]
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))
const pin = text => createHash('sha256').update(text).digest('hex')
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const ORGS = ['the port authority', 'the county clerk', 'the shipping line', 'the insurer', 'the league office', 'the city council', 'the weather service']
const ITEMS = ['container 4471', 'parcel B-12', 'invoice 2209', 'vessel Marlin', 'lot 31', 'flight VA 118', 'permit 77-A']
const out = []
const atom = (kind, i, q, facts, truth) => out.push({ id: `${kind}-${i}`, kind, q, answer: { type: 'yes-no' }, facts: facts.map(t => ({ text: t, pin: pin(t), loc: 'p1' })), truth })
for (let i = 0; i < n; i++) {
  const a = int(1000, 9999), b = a + pick([-int(1, 900), int(1, 900)]), org = pick(ORGS)
  atom('compare', i, `Did ${org} report more shipments in Q3 than in Q2?`, [`${org[0].toUpperCase() + org.slice(1)} quarterly report: Q2 shipments ${a.toLocaleString('en-US')}; Q3 shipments ${b.toLocaleString('en-US')}.`], b > a)
  const m = int(0, 11), d = int(1, 28), dl = d + pick([-int(1, 10), int(0, 10)]), item = pick(ITEMS)
  const dd = Math.min(28, Math.max(1, dl))
  atom('deadline', i, `Was ${item} delivered on or before ${MONTHS[m]} ${dd}?`, [`Delivery log: ${item} signed for on ${MONTHS[m]} ${d}, 2026.`], d <= dd)
  const yes = int(20, 80), no = 100 - yes - int(0, 5), need = pick([50, 51, 60, 67])
  atom('tally', i, `Did the motion receive at least ${need} yes votes?`, [`Roll call: ${yes} yes, ${no} no, ${100 - yes - no} not voting.`], yes >= need)
  const listed = [...new Set(Array.from({ length: 4 }, () => pick(ITEMS)))], target = pick(ITEMS)
  atom('presence', i, `Does the manifest list ${target}?`, [`Manifest, page 2: ${listed.join(', ')}.`], listed.includes(target))
  const item2 = pick(ITEMS)
  atom('unsettled', i, `Was ${item2} inspected by ${org}?`, [`${org[0].toUpperCase() + org.slice(1)} weekly bulletin: ${pick(['office hours changed', 'a new form is required', 'staff training on Friday'])}.`], null)
}
for (const x of out) console.log(JSON.stringify(x))
