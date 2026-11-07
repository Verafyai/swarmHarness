import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateAtom } from '../../pack/src/atom.js'

const atoms = readFileSync(new URL('../../../examples/calibration/atoms.jsonl', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l))

test('the calibration set: enough per kind for a 97% Wilson bound, valid atoms, labels by construction', () => {
  const kinds = {}
  for (const a of atoms) kinds[a.kind] = (kinds[a.kind] ?? 0) + 1
  for (const [k, n] of Object.entries(kinds)) assert.ok(n >= 130, `${k} has ${n}; under about 130 no screen can show a 97% lower bound`)
  assert.equal(new Set(atoms.map(a => a.id)).size, atoms.length)
  for (const a of atoms) assert.deepEqual(validateAtom(a), [], a.id)
  assert.ok(atoms.filter(a => a.kind === 'unsettled').every(a => a.truth === null))
  // Spot-check labels against the facts for two kinds.
  for (const a of atoms.filter(x => x.kind === 'compare')) {
    const [, q2, q3] = a.facts[0].text.match(/Q2 shipments ([\d,]+); Q3 shipments ([\d,]+)/)
    assert.equal(a.truth, Number(q3.replace(/,/g, '')) > Number(q2.replace(/,/g, '')), a.id)
  }
  for (const a of atoms.filter(x => x.kind === 'tally')) {
    const need = Number(a.q.match(/at least (\d+)/)[1]), yes = Number(a.facts[0].text.match(/(\d+) yes/)[1])
    assert.equal(a.truth, yes >= need, a.id)
  }
})
