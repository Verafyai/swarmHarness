# @verafyharness/prove

Proof of inference for L2 juries (MASTER_SPEC Part D). Optional, zero dependencies. The core holds no prover code: it stores proof hashes and checks verification results (`packages/core/src/proving.js`). Everything that touches a prover lives here, behind two interfaces.

```
Prover   { commitment(), infer(requests)?, prove(requests) -> [{id, answer, proofRef, proofHash}] }
Verifier { verify(proofRef, commitment, input, answer) -> bool }
```

`infer` is optional in the spec's interface and required for an L2 juror: the commit uses plain inference, and the proof comes after the reveal, so proving never blocks the commit.

## Status

| Part | Status |
|---|---|
| Timing: commit, reveal, then a signed proof record (hash only) before the proof deadline | Built, tested |
| Finality: final only when every counted vote's proof verifies; a missing or failed proof drops the vote, re-measures agreement, escalates below the bar, records a fault against the bond | Built, tested here and on the Verafy Chain devnet |
| `mock` prover and verifier | Built. Binds commitment, input and answer, so the flow can be tested. **Not a proof of inference**: anyone can make one |
| `deepprove` adapter (subprocess or HTTP) | Built, tested against a stand-in binary only. No DeepProve proof has been made or verified here (see below) |
| `flashprove` adapter (subprocess or HTTP), plus a direct `cp_verify` mode | Built, tested against a stand-in only. `cp_verify` has not been built or run here |
| Long contracts: `map-reduce/1`, every chunk's proof attached | Built, tested with the mock |
| Prover batches up to `proverBatch` (24 by default, vendor-reported, FlashProve, from `packages/economics`) | Built, tested |
| Proving as a service: `provers` entries in the API router, metered per proof; the harness verifies before it counts | Built, tested with a fake service |
| A real proof on real hardware, measured | Planned. Needs Rex (license, machine) |
| FlashProve proving harness runbook (Part D3 step 3) | Planned |

## The flow

```js
import { mockProver, mockCommitment, mockVerifier, l2Provider, proveVotes, verifyBundle } from '@verafyharness/prove'

const prover = mockProver({ model, complete })            // or deepProveProver({...}), flashProveProver({...}), serviceProver({...})
const provider = l2Provider(prover)                        // plain inference for the commit
const harness = new Harness({ ...setup, provider, modelCommitment: await prover.commitment() })

// commit and reveal as usual, then before the proof deadline:
const [{ record, bundle }] = await proveVotes(harness, provider, prover, [asc], { proverBatch: 24 })
// send `record` (hashes only) to the node; put `bundle` in the availability layer

// a verifier (an auditor or a node):
const { ok, reason } = await verifyBundle(mockVerifier(), asc, record, bundle, revealedVote)
```

`verifyBundle` re-plans the split from the contract alone, checks every proven input, checks that the reduce input is the map outputs in order, runs the Verifier on every proof under the record's model commitment, and checks that the final output parses to exactly the revealed vote.

Only the proof record reaches the chain: the proof hash, the model commitment, the vote commitment, chunk proof hashes and a locator. The bundle (prompts, outputs, proof bytes) stays off chain. A stored hash is not a proof by itself; it means something only alongside availability, bonds and challenges.

**The prover sees the plaintext it proves.** The encrypted queue protects a contract until the jury is drawn; it does not hide the contract from the proving machine.

## Long contracts: `map-reduce/1`

A prompt over `contextTokens` (1,024 by default, vendor-reported, FlashProve) less a 128-token answer reserve is split. Each chunk of the evidence is proven with the instructions and the question, and the model lists what that chunk shows without answering (map). One more proven request takes the instructions, the question and every chunk's findings in order, and its output is the vote (reduce). One level only: a contract whose findings do not fit one reduce request is refused. Tokens are estimated at four characters per token; a real prover's tokenizer decides, so leave headroom.

## The contract for a real prover

`deepprove` and `flashprove` talk to a wrapper around each build, so no prover code is linked into the harness. JSON in, JSON out; subprocess (`<command> [...args] <op>`, body on stdin) or HTTP (`POST <url>/<op>`):

| op | request | reply |
|---|---|---|
| `commitment` | `{}` | `{commitment}` |
| `infer` | `{requests: [{id, input}]}` | `{results: [{id, answer}]}` |
| `prove` | `{commitment, requests: [{id, input}]}` | `{results: [{id, answer, proofRef, proofHash}]}` |
| `verify` | `{proofRef, commitment, input, answer}` | `{ok, reason?}` |

`input` is `{system, user}`, the exact prompt; `answer` is the output text (greedy decoding); `proofHash` is the SHA-256 of the proof bytes. Exit code 0 on success. A wrapper refuses to prove under another commitment, and its `verify` returns `ok: false`, not an error, for a proof that does not check. `test/fixtures/fake-prover.mjs` is a stand-in that meets this contract with the mock scheme.

### DeepProve

Source read on Nov 6, 2026: github.com/Lagrange-Labs/deep-prove at commit 9d1a53e (May 26, 2026), `README.md` and `zkml/README.md`. The documented build is `cargo build --release -p zkml --bin bench-llm` on a pinned nightly toolchain (`nightly-2026-01-27`), and a run is `bench-llm --model gpt2 --hf openai-community/gpt2 --sequence 64`. `bench-llm` builds the proving context, proves one random prompt and verifies it in one run, writing `bench.csv`; it has no per-request prove or verify command, so a wrapper has to be written against the `zkml` crate.

Not built or run here, for two reasons:
- **License.** The repo's `LICENSE` is the Lagrange License: a personal, revocable license to use the software for testing and evaluation, and "by using the software" the user agrees to be bound, for their company too. The workspace `Cargo.toml` says `MIT OR Apache-2.0`, which conflicts; the README says the Lagrange License governs. Accepting it is Rex's decision.
- **Machine.** The vendor-reported figures are from a 24-core, 504 GB AMD EPYC 9254 server. This Mac is an Apple M4 with 10 cores and 16 GB of RAM, with 30 GB of disk free. The README publishes no peak-memory figure for GPT-2, so whether even the smallest run fits here is unknown until someone measures it.

So the DeepProve preset in `packages/economics` stays vendor-reported (Gemma 3: 19 min to prove, 4.3 s to verify, 27 MiB; GPT-2: 7.6 min, 1.3 s, 10.7 MiB; 512-token sequences; github.com/Lagrange-Labs/deep-prove).

### FlashProve

github.com/anthropics/FlashProve (Apache 2.0, version 0.16.0, "a research artifact: not maintained"), read at commit 9e2bdd8 (Oct 30, 2026). Its CPU verifier is public: `cp_verify`, a C++ program built by `verifier/build.sh` (Linux, bash, g++ 13 or later, under 2 GB RAM). The repo's README says it is tested, not verified: the Lean proofs are about the protocol and a verifier written in Lean, not about `cp_verify`.

`flashProveVerifier({ cpVerify: '<path to cp_verify>', bindsTo })` calls it exactly as the README documents, `cp_verify <config> <ivk> <req> <y> <proof> -id <commitment> -q`, and accepts only exit code 0 with a last line of exactly `YES`. `cp_verify` knows nothing about our prompt text, so `bindsTo(proofRef, input, answer)` must also confirm that the request and reply files are this prompt and this answer (through FlashProve's tokenizer); with no `bindsTo`, `verify` returns false. That binding check is planned. `cp_verify` was not built here: the session's permission rules blocked building third-party code, and the README's route 1 targets Linux.
