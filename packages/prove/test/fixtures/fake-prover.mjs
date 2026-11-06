#!/usr/bin/env node
/**
 * A stand-in for a DeepProve or FlashProve wrapper: it meets the external
 * contract in src/external.js with the mock proof scheme, so the adapters can
 * be tested without a real prover. Not a prover.
 *
 *   fake-prover.mjs <op>              subprocess: body on stdin, reply on stdout
 *   fake-prover.mjs --http <port>     serve POST /<op>
 *   fake-cp-verify: FAKE_CP_VERIFY=1 fake-prover.mjs <config> <ivk> <req> <y> <proof> -id <id> -q
 *
 * Answers are deterministic: "echo:" plus the SHA-256 of the input.
 * FAKE_COMMITMENT sets the commitment; FAKE_FAIL=1 makes every op exit 1.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { sha256, canonical } from '../../../core/src/hash.js'
import { mockProof, checkMockProof, mockCommitment } from '../../src/mock.js'

const commitment = process.env.FAKE_COMMITMENT ?? mockCommitment('fake-model')
const answer = input => `echo:${sha256(canonical(input))}`

function handle(op, body) {
  if (op === 'commitment') return { commitment }
  if (op === 'infer') return { results: body.requests.map(r => ({ id: r.id, answer: answer(r.input) })) }
  if (op === 'prove') {
    if (body.commitment !== commitment) throw new Error('refusing to prove under another commitment')
    return { results: body.requests.map(r => { const a = answer(r.input); const p = mockProof(commitment, r.input, a); return { id: r.id, answer: a, proofRef: p, proofHash: sha256(p) } }) }
  }
  if (op === 'verify') return { ok: checkMockProof(body.proofRef, body.commitment, body.input, body.answer) }
  throw new Error(`unknown op ${op}`)
}

const argv = process.argv.slice(2)
if (process.env.FAKE_CP_VERIFY) {
  // cp_verify's calling convention: five files, -id, -q; last line YES and exit 0 on acceptance.
  const [, , , , proof, flag, id] = argv
  const ok = flag === '-id' && readFileSync(proof, 'utf8').trim() === `ok:${id}`
  console.log(ok ? 'result-v1 status=0\nYES' : 'NO: fake-rejection')
  process.exit(ok ? 0 : 1)
} else if (process.env.FAKE_FAIL) {
  console.error('fake failure')
  process.exit(1)
} else if (argv[0] === '--http') {
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    try {
      const out = handle(req.url.slice(1), JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out))
    } catch (err) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: err.message })) }
  })
  server.listen(Number(argv[1]), '127.0.0.1', () => console.log(`listening ${server.address().port}`))
} else {
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  try {
    process.stdout.write(JSON.stringify(handle(argv[0], JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))))
  } catch (err) { console.error(err.message); process.exit(1) }
}
