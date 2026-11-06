// Measure how often an exact-integer jury split would disagree with runtime.js.
//
// runtime.js splits a ruling's escrow in IEEE-754 doubles, rounding each share
// to 1e-6 with Math.round. An integer split (micro-units, round half up) is the
// form TinySVM would prefer. This counts, over random rulings shaped like real
// contracts, how often the two give different diffs. It is why the escrow
// program reproduces the double arithmetic instead (see README.md).
//
//   node packages/tinysvm/scripts/integer-split.mjs [cases] [seed]
import { buildDiff } from '../../core/src/runtime.js'

const cases = Number(process.argv[2] ?? 200_000)
let s = Number(process.argv[3] ?? 20261106) >>> 0
const rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))
const half = (a, b) => (2n * a + b) / (2n * b) // a / b rounded half up, a >= 0

let differ = 0
let example
for (let i = 0; i < cases; i++) {
  const E = BigInt(int(1, 5_000_000))
  const j = int(500_000, 900_000), a = int(0, 1_000_000 - j), st = int(0, 1_000_000 - j - a)
  const n = int(1, 15)
  const counted = Array.from({ length: n }, (_, q) => `h${q}`)
  const asc = { id: 'x', payment: { escrow: Number(E) / 1e6, split: { jurors: j / 1e6, auditors: a / 1e6, storage: st / 1e6 } } }
  const float = buildDiff(asc, { effect: { type: 'record' } }, true, counted, 'seal').map(d => Math.round(d.delta * 1e6))
  const js = half(E * BigInt(j), 1_000_000n), each = half(js, BigInt(n)), au = half(E * BigInt(a), 1_000_000n), sto = half(E * BigInt(st), 1_000_000n)
  const integer = [...counted.map(() => each), au, sto, E - each * BigInt(n) - au - sto, -E].map(Number)
  if (float.join() !== integer.join()) { differ++; example ??= { escrowUnits: Number(E), jurorsPpm: j, auditorsPpm: a, storagePpm: st, counted: n, runtimeJs: float, integer } }
}
console.log(JSON.stringify({ cases, differ, share: differ / cases, example }, null, 1))
