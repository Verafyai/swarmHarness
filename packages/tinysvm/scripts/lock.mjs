// Write or check programs.lock.json: the SHA-256 of every built TinySVM program.
// A program's hash is its identity: contracts declare exit programs by it, and
// the engine refuses to load a binary whose hash is not the one pinned here.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const root = new URL('..', import.meta.url)
const BUILTINS = ['escrow', 'bond', 'ledger']
const EXITS = ['graded_payout', 'ranked_split', 'milestone_escrow']
const lockUrl = new URL('programs.lock.json', root)

const programs = {}
for (const name of [...BUILTINS, ...EXITS]) {
  const so = readFileSync(new URL(`programs/target/deploy/${name}.so`, root))
  programs[name] = { sha256: createHash('sha256').update(so).digest('hex'), builtin: BUILTINS.includes(name), bytes: so.length }
}
let sbf = 'unknown'
try { sbf = execFileSync('cargo-build-sbf', ['--version'], { encoding: 'utf8' }).trim().split('\n').join(', ') } catch {}

if (process.argv.includes('--write')) {
  writeFileSync(lockUrl, JSON.stringify({ toolchain: sbf, programs }, null, 2) + '\n')
  console.log('tinysvm: wrote programs.lock.json')
} else {
  const lock = JSON.parse(readFileSync(lockUrl, 'utf8'))
  const bad = Object.entries(programs).filter(([n, p]) => lock.programs[n]?.sha256 !== p.sha256)
  for (const [n, p] of bad) console.log(`tinysvm: ${n}.so is ${p.sha256}; programs.lock.json pins ${lock.programs[n]?.sha256 ?? 'nothing'}`)
  if (bad.length) { console.log('tinysvm: the build does not reproduce the pinned programs (toolchain in the lock: ' + lock.toolchain + ')'); process.exit(1) }
  console.log(`tinysvm: all ${Object.keys(programs).length} programs match programs.lock.json`)
}
