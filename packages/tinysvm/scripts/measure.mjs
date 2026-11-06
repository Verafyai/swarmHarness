// Measure compute units and sidecar round trips for each TinySVM request.
//   node packages/tinysvm/scripts/measure.mjs   (needs scripts/build.sh first)
import { Engine, tinySvmRuntime } from '../src/index.js'
import { accountKey } from '../../core/src/index.js'
const t0 = performance.now()
const e = await Engine.start()
const startMs = performance.now() - t0
const t = tinySvmRuntime(e)
const k = accountKey
const ops = {
  'escrow jury split (5 votes)': () => t.jury({ id: 'x', escrow: 0.6, split: { jurors: 0.8, auditors: 0.1, storage: 0.05 }, counted: ['a','b','c','d','e'], passed: true, sealer: 'a' }),
  'graded_payout claim': () => t.exit({ program: 'graded_payout', entry: 'claim', state: { reserve: 50e9, paid: 0, claims: 0 }, input: { percent: 43, coverage: 5e9, pot: k('p'), beneficiary: k('b') } }),
  'ranked_split split (3 of 5)': () => t.exit({ program: 'ranked_split', entry: 'split', state: {}, input: { prize: 1e10, shares: [500000,300000,200000], ranking: [3,0,1], pot: k('p'), entrants: [0,1,2,3,4].map(i => k('e'+i)) } }),
  'milestone_escrow release': () => t.exit({ program: 'milestone_escrow', entry: 'release', state: { released: [], paid: 0 }, input: { milestone: 1, tranches: [2e9,3e9,5e9], pot: k('p'), contractor: k('c') } }),
  'bond slash': () => t.bond({ state: { deposited: 500, locked: 500, slashed: 0, released: 0 }, op: 'slash', amount: 100 }),
  'ledger apply (2 transfers)': () => t.ledger({ table: [{ key: k('a'), balance: 10 }], transfers: [{ key: k('a'), delta: -4 }, { key: k('b'), delta: 4 }], capacity: 8 }),
}
const N = 1000
console.log(`engine start and hello: ${startMs.toFixed(0)} ms`)
for (const [name, f] of Object.entries(ops)) {
  const r = await f()
  const s = performance.now()
  for (let i = 0; i < N; i++) await f()
  const per = (performance.now() - s) / N
  console.log(`${name}: ${r.computeUnits} compute units, ${(per * 1000).toFixed(0)} us per request round trip (mean of ${N})`)
}
e.close()
