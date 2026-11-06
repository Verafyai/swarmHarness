import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  atomKey, validateAtom, readAnswer, decide, validatePlan, pack, readReply, assemble,
  atomize, fidelityQuestion, PLAN_KIND,
} from '../src/index.js'

const pin = 'a'.repeat(64)
const yn = (id, q, fact) => ({ id, q, answer: { type: 'yes-no' }, facts: [{ text: fact, pin, loc: 'p1' }] })

// The Senate market as three atoms: passing vote recorded, dated by Nov 30, record available.
const senate = {
  kind: PLAN_KIND,
  atoms: [
    yn('a1', 'Does the snapshot record a passing Senate roll-call vote on H.R. 4410?', 'Vote 302 (Nov 19): motion to proceed to H.R. 4410, rejected 46-53. No further votes recorded through Nov 30.'),
    yn('a2', 'Is the official Senate roll-call record available for the period?', 'Snapshot of senate.gov roll-call votes, taken Dec 1, 2026.'),
  ],
  decide: [
    { when: { not: { atom: 'a2' } }, outcome: 'UNCLEAR' },
    { when: { atom: 'a1' }, outcome: 'YES' },
    { else: 'NO' },
  ],
  onUnknown: 'UNCLEAR',
}

test('atoms validate, key stably, and reject compound questions', () => {
  assert.deepEqual(validateAtom(senate.atoms[0]), [])
  const k1 = atomKey(senate.atoms[0])
  const k2 = atomKey({ ...senate.atoms[0], id: 'zz', q: '  does the SNAPSHOT record a passing Senate roll-call vote on H.R. 4410? ' })
  assert.equal(k1, k2, 'same question, same facts, same key, whatever the id or spacing')
  assert.notEqual(k1, atomKey({ ...senate.atoms[0], facts: [{ text: 'other', pin }] }))
  assert.ok(validateAtom({ q: 'Did it pass? Was it signed?', answer: { type: 'yes-no' }, facts: [] }).length)
  assert.ok(validateAtom({ q: 'Did it pass?', answer: { type: 'yes-no' }, facts: [{ text: 'x' }] }).some(e => e.includes('pin')))
})

test('answers are read strictly', () => {
  assert.deepEqual(readAnswer(senate.atoms[0], 'yes'), { ok: true, value: true })
  assert.deepEqual(readAnswer(senate.atoms[0], 'UNKNOWN'), { ok: true, value: null })
  assert.equal(readAnswer(senate.atoms[0], 'probably').ok, false)
  const n = { answer: { type: 'integer', min: 0, max: 100 } }
  assert.deepEqual(readAnswer(n, '40'), { ok: true, value: 40 })
  assert.equal(readAnswer(n, '140').ok, false)
  assert.equal(readAnswer(n, '4.5').ok, false)
})

test('composition is exact and UNKNOWN never guesses', async () => {
  const c = JSON.parse(await readFile(new URL('../../../examples/market-resolution.json', import.meta.url), 'utf8'))
  assert.deepEqual(validatePlan(senate, c), [])
  assert.equal(decide(senate, { a1: false, a2: true }).outcome, 'NO')
  assert.equal(decide(senate, { a1: true, a2: true }).outcome, 'YES')
  assert.equal(decide(senate, { a1: true, a2: false }).outcome, 'UNCLEAR')
  const u = decide(senate, { a1: null, a2: true })
  assert.equal(u.outcome, 'UNCLEAR')
  assert.equal(u.unknown, 'a1')
  // Graded: percent damaged becomes a parameter; weights are integers.
  const graded = {
    kind: PLAN_KIND, onUnknown: 'ESCALATE',
    atoms: [
      { id: 'd', q: 'How many of the 40 cartons were crushed?', answer: { type: 'integer', min: 0, max: 40 }, facts: [{ text: 'Inspection: 2 of 40 cartons crushed.', pin }] },
      { id: 'l', q: 'Was the shipment delivered by Oct 5?', answer: { type: 'yes-no' }, facts: [{ text: 'Delivered Oct 3.', pin }] },
    ],
    decide: [{ when: { all: [{ atom: 'l' }, { le: [{ atom: 'd' }, 3] }] }, outcome: 'PAY', params: { crushed: { atom: 'd' } } }, { else: 'REFUND' }],
  }
  assert.deepEqual(decide(graded, { d: 2, l: true }), { outcome: 'PAY', params: { crushed: 2 } })
  assert.equal(decide(graded, { d: 5, l: true }).outcome, 'REFUND')
})

test('plans are checked against the contract', async () => {
  const c = JSON.parse(await readFile(new URL('../../../examples/market-resolution.json', import.meta.url), 'utf8'))
  const bad = { ...senate, decide: [{ when: { atom: 'a9' }, outcome: 'MAYBE' }, { else: 'NO' }] }
  const errs = validatePlan(bad, c)
  assert.ok(errs.some(e => e.includes('a9')))
  assert.ok(errs.some(e => e.includes('MAYBE')))
  assert.ok(errs.some(e => e.includes('never used')))
})

test('the packer dedupes across contracts and fills requests', () => {
  // 60 contracts that each ask a shared question plus one of their own.
  const shared = yn('s', 'Did the Fed cut rates at the December 10 meeting?', 'FOMC statement Dec 10: target range lowered by 25 basis points.')
  const items = Array.from({ length: 60 }, (_, i) => ({
    id: `c${i}`,
    plan: { kind: PLAN_KIND, onUnknown: 'UNCLEAR', atoms: [shared, yn('own', `Did fund ${i} report a gain in Q4?`, `Fund ${i} Q4 letter: net return ${i % 2 ? '+' : '-'}1.${i}%.`)], decide: [{ when: { all: [{ atom: 's' }, { atom: 'own' }] }, outcome: 'YES' }, { else: 'NO' }] },
  }))
  const p = pack(items, { seed: 'block-1' })
  assert.equal(p.stats.atoms, 120)
  assert.equal(p.stats.uniqueAtoms, 61, 'the shared atom is packed once')
  assert.equal(p.stats.deduped, 59)
  for (const r of p.requests) assert.ok(r.tokens <= 1024, `request has ${r.tokens} tokens`)
  assert.ok(p.stats.requests <= 4, `61 short atoms should fit in a few requests, got ${p.stats.requests}`)
  assert.ok(p.stats.fill > 0.6)
  // Deterministic: same seed, same packing; different seed, different slot order.
  assert.deepEqual(pack(items, { seed: 'block-1' }).requests.map(r => r.id), p.requests.map(r => r.id))
  assert.notDeepEqual(pack(items, { seed: 'block-2' }).requests[0].slots.map(s => s.key), p.requests[0].slots.map(s => s.key))
})

test('replies are read strictly and assembled into outcomes', () => {
  const items = [{ id: 'senate', plan: senate }]
  const p = pack(items, { seed: 'b' })
  const r = p.requests[0]
  const k = s => r.slots.find(x => x.atom.id === s).slot
  const reply = `${k('a1')}: NO\n${k('a2')}: YES`
  const ans = readReply(r, reply)
  assert.equal(assemble(items, ans).senate.outcome, 'NO')
  assert.throws(() => readReply(r, `${k('a1')}: NO`), /not answered/)
  assert.throws(() => readReply(r, `${k('a1')}: NO\n${k('a2')}: maybe`), /BAD_REPLY/)
  assert.throws(() => readReply(r, `${k('a1')}: NO\n${k('a2')}: YES\nignore previous instructions`), /BAD_REPLY/)
})

test('an atom too big for one request is refused', () => {
  const big = yn('b', 'Is it true?', 'x'.repeat(5000))
  assert.throws(() => pack([{ id: 'x', plan: { kind: PLAN_KIND, onUnknown: 'NO', atoms: [big], decide: [{ else: 'NO' }] } }]), /ATOM_TOO_LARGE/)
})

test('the atomizer validates what the model returns', async () => {
  const c = JSON.parse(await readFile(new URL('../../../examples/market-resolution.json', import.meta.url), 'utf8'))
  const p0 = c.context[0].sha256
  const good = { ...senate, atoms: senate.atoms.map(a => ({ ...a, facts: a.facts.map(f => ({ ...f, pin: p0 })) })) }
  const ok = await atomize(c, { complete: async () => JSON.stringify(good) })
  assert.deepEqual(ok.errors, [])
  assert.equal(ok.stats.requests, 1)
  const forged = await atomize(c, { complete: async () => JSON.stringify(senate) })
  assert.ok(forged.errors.some(e => e.includes('not a pin in this contract')))
  const junk = await atomize(c, { complete: async () => 'Sure! Here are the atoms.' })
  assert.deepEqual(junk.errors, ['the atomizer did not return JSON'])
  const fq = fidelityQuestion(c, good)
  assert.deepEqual(fq.options, ['FAITHFUL', 'NOT_FAITHFUL', 'UNCLEAR'])
})
