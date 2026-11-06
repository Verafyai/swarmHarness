---
simd: 'XXXX'
title: Inference Evaluators and Attestations
authors:
  - Rex St. John (Verafy)
category: Standard
type: Interface
status: Idea
created: 2026-11-05
feature: (fill in with feature key and github tracking issues once accepted)
---

## Summary

These SIMDs are part of a broader proposal to bring Inference Programs to
Solana natively: [Bringing Inference Programs To Solana](https://blog.verafy.ai/articles/20261105-simd-verifiable-inference).

This proposal defines how off-chain model operators take part in inference
programs. An **evaluator** registers an Ed25519 signing key, its prices and a
**model commitment**: a record of exactly which model it runs. For each request
it serves, it commits to an answer and then reveals an **attestation**: a signed
message binding the request, the pinned prompt and context, the input, its
outcome, its confidence, and an optional reference to a zero-knowledge proof
that the committed model produced the output. Because today's proofs are far too
large to store or verify on chain, it defines what is stored instead (binding
commitments, availability references and bonds), how anyone can **challenge** a
vote by re-execution, proof on demand or hardware report, and an ordered set of
**assurance levels**, from signatures alone (L0) to verified proofs (L2), with
on-chain verification (L3) reserved.

This is one of three companion proposals that bring inference programs to
Solana:

1. **Inference Programs**: natural-language programs on chain, their
   context, and how other programs call and pay for them.
2. **Inference Evaluators and Attestations**: who runs the models, what they
   commit to, and the signed, optionally provable, vote each one casts.
3. **Inference Rulings, Disputes and Challenges**: how votes become a signed
   ruling that programs act on, and how rulings are disputed, challenged and
   overturned.

The motivation, use cases and diagrams for all three are in the
[overview post](https://blog.verafy.ai/articles/20261105-simd-verifiable-inference).

## Motivation

A signature proves which key signed, not which model ran. An operator could
quietly swap in a cheaper model, a fine-tuned one, or a person. Recent work
on zero-knowledge proofs of LLM inference
([Anthropic, 2026](https://www.anthropic.com/research/provable-inference))
shows that a provider can prove that committed weights produced an output
without revealing them. Such proofs are large and slow today (tens of
megabytes, seconds to verify, one open model), so they cannot be verified in
a transaction, but they can be referenced and checked off chain.

This lets each side do what it is good at: models think off chain on
hardware built for it, and Solana keeps a permanent, checkable record of who
voted, for what, and with what proof. A common registry and attestation
format lets any program trust any evaluator's work across implementations.

## Dependencies

This proposal depends on the following proposals, submitted together:

- **SIMD-XXXX: Inference Programs**

  Defines the RulingRequest whose pinned hashes and jury specification every
  attestation answers.

- **SIMD-XXXX: Inference Rulings, Disputes and Challenges**

  Counts revealed attestations into a ruling.

## New Terminology

- **Evaluator**: An off-chain operator that runs a model against inference
  programs and signs attestations with a registered Ed25519 key.


- **Model commitment**: A record of exactly what an evaluator runs: a model
  identifier, a hash of the weights, a hash of the tokenizer and a hash of the
  inference configuration.


- **Attestation**: An Ed25519-signed message from an evaluator binding a
  request, the prompt and context hashes, an input hash, an output and a model
  commitment.


- **Proof of inference**: A proof, verified off chain, that a committed model
  produced a given output. Attestations reference it by hash.


- **Assurance level**: How much a ruling proves, from signatures alone (L0) up
  to verified proofs of inference (L2).


## Detailed Design

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in [RFC
2119](https://www.ietf.org/rfc/rfc2119.txt) and [RFC
8174](https://www.ietf.org/rfc/rfc8174.txt).

All integers are little-endian. All hashes are SHA-256 unless stated
otherwise. Account layouts begin with an 8-byte discriminator equal to the
first 8 bytes of `sha256("inference-programs:" || account_name)`.

### Accounts

#### Evaluator


A PDA at `["evaluator", operator]`.

```text
discriminator        [u8; 8]
operator             Pubkey     // controls this record
signing_key          [u8; 32]   // Ed25519 key that signs attestations
encryption_key       [u8; 32]   // X25519 key for encrypted content
model_commitment     Pubkey     // ModelCommitment account
family               [u8; 32]   // model family label, e.g. "llama-4"
max_context          u32        // largest context the model accepts, tokens
payout_wallet        Pubkey     // where this evaluator's fees are paid
base_fee             u64        // lamports per attestation
input_price          u64        // lamports per 1,000 input tokens
output_price         u64        // lamports per 1,000 output tokens
proof_fee            u64        // lamports for a proof of inference, if offered
bond                 u64        // lamports locked, slashable on a proven fault
bond_unlock_slot     u64        // earliest slot a withdrawal can complete
faults               u16        // attestation challenges lost
status               u8         // 0 active, 1 paused, 2 retired
registered_slot      u64
```

#### ModelCommitment


```text
discriminator        [u8; 8]
model_id             [u8; 64]   // UTF-8, zero padded
weights_hash         [u8; 32]
tokenizer_hash       [u8; 32]
config_hash          [u8; 32]   // hash of decoding settings
                                // (e.g. temperature 0, fixed seed)
proof_system         [u8; 32]   // proof-of-inference system id,
                                // all zeros if none
weights_ref          [u8; 96]   // where open weights can be fetched,
                                // zero padded, empty for closed models
runtime_hash         [u8; 32]   // hash of the pinned inference runtime
                                // and kernels, for re-execution
tee_measurement      [u8; 32]   // expected secure-hardware measurement,
                                // all zeros if none
publisher            Pubkey
```

Model commitments are published once and MUST NOT change. Closed models whose
weights cannot be committed MAY use a zero `weights_hash`. Rulings that rely on
them cannot reach L1+ or L2, except through secure hardware (see "Hardware
attestation").

#### EvaluatorSet (optional)


A list of evaluator accounts an inference program accepts, controlled by the
inference program's authority. It is REQUIRED when the prompt or any context
document is encrypted, since only listed evaluators hold keys. Without one,
any active evaluator may attest, subject to the request's quorum rules.

#### Attestation


A PDA at `["attestation", ruling_request, evaluator]`.

```text
discriminator        [u8; 8]
ruling_request       Pubkey
evaluator            Pubkey
commitment           [u8; 32]   // sha256(message || salt), set at commit
outcome              u8         // set at reveal
confidence           u8         // 0 to 100, the model's own confidence
output_hash          [u8; 32]   // sha256 of the full model output
output_ref           [u8; 96]   // where the full output can be fetched
proof_hash           [u8; 32]   // sha256 of the proof, or zero
proof_ref            [u8; 96]   // where the proof can be fetched, or zero
tee_report_hash      [u8; 32]   // sha256 of a hardware report, or zero
proof_verifications  u8         // count of verifier attestations, see L2
challenge            Option<Pubkey>  // open AttestationChallenge, if any
voided               bool       // true once a challenge proves a fault
revealed             bool
```

#### AttestationChallenge

A PDA at `["attestation-challenge", attestation]`.

```text
discriminator        [u8; 8]
attestation          Pubkey
challenger           Pubkey
kind                 u8         // 0 output mismatch on re-execution,
                                // 1 proof demanded, 2 proof invalid,
                                // 3 hardware report invalid
bond                 u64        // lamports the challenger locks
respond_deadline     u64        // slot by which the evaluator must answer
resolve_deadline     u64        // slot by which verifiers must attest
upheld_votes         u8         // verifiers confirming the fault
rejected_votes       u8         // verifiers rejecting it
status               u8         // 0 open, 1 fault proven, 2 rejected,
                                // 3 expired
```

### Attestation message


Evaluators sign the following byte string with Ed25519:

```text
"solana-inference-attestation:v1"   // 31 bytes, ASCII, no terminator
ruling_request        [u8; 32]
prompt_hash           [u8; 32]
context_hash          [u8; 32]
ext_context_hash      [u8; 32]
input_hash            [u8; 32]
evidence_hash         [u8; 32]
model_commitment      [u8; 32]      // ModelCommitment account address
outcome               u8
confidence            u8
output_hash           [u8; 32]
proof_hash            [u8; 32]
tee_report_hash       [u8; 32]
```

An evaluator that will only produce a proof on demand signs a zero `proof_hash`;
its commitment to the output is `output_hash`, and the proof it later publishes
MUST be for that output. The domain prefix prevents a signature over this
message from being valid for any other purpose. Binding `ruling_request`
prevents replay across requests. Binding `prompt_hash`, `context_hash`,
`ext_context_hash` and `input_hash` means an attestation applies to exactly one
prompt, one context set, one external context and one input.

### Commit, then reveal

Each evaluator first submits only
`sha256(message || salt)` before `commit_deadline`. After that slot, the
evaluator (or anyone holding the message, salt and signature) calls
`RevealAttestation`. The program MUST check that:

1. The transaction contains an Ed25519 precompile instruction verifying
   `signing_key`'s signature over the message. The program reads it with
   instruction introspection.
2. The message fields match the request and the evaluator's model commitment.
3. `sha256(message || salt)` equals the stored commitment.

No evaluator can see another's answer before committing to its own.

### Eligibility

Only active evaluators that match every constraint of a request's
`JurySpec`, whose `max_context` fits the request's `context_budget`, and that
are in the program's evaluator set when it has one, may commit. Prices are
pinned at request time.

### Why proofs stay off chain

A proof of inference shows that committed weights produced an output. It is
the strongest evidence of which model ran, and it does not fit on Solana. The
one published system for large language models reports figures far beyond
every relevant limit ([Anthropic,
2026](https://www.anthropic.com/research/provable-inference)):

| Quantity               | One proof today      | Solana limit           |
|------------------------|----------------------|------------------------|
| Size                   | about 18.78 MB       | 1,232 B per tx         |
| Account to hold it     | about 18.78 MB       | 10 MiB per account     |
| Rent to store it       | about 131 SOL        | 6,960 lamports per B   |
| Uploading it           | about 19,000 txs     | about 1 KB per tx      |
| Verifying it           | 17 s on 24 threads   | 1.4M compute units     |
| Models covered         | one open model       | any, ideally           |

The size comes from what is proven: every layer of a model with hundreds of
billions of parameters, for every token. Proof systems that need no trusted
setup grow with the work they cover, so they suit very large computations
but do not produce the constant-size proofs a chain can check cheaply. A
ruling with five proven votes would need about 650 SOL of rent, and verifying
it would need about five orders of magnitude more computation than a
transaction allows.

The problem is not only cost. If the chain cannot check a proof, a proof hash
alone proves nothing: an evaluator could post the hash of a proof that does
not exist or does not verify. Assurance beyond signatures therefore needs
three things in place of the proof itself:

1. **A binding commitment.** The output, the model, the runtime and, where
   one exists, the proof are fixed by hash in the signed attestation, so the
   evaluator cannot change its story later.
2. **Availability.** Whatever is needed to check the vote (the output, the
   proof, and for open models the weights) MUST stay retrievable from
   `output_ref`, `proof_ref` and `weights_ref` for at least the program's
   dispute and challenge windows.
3. **A cost for lying.** A bond the evaluator loses when anyone shows, by a
   check that has one right answer, that the commitment was false.

### Precedent (informative)

None of these ideas is new. Each is in production elsewhere:

- **Oracles** deliver data to chains with signatures and economic
  incentives, not proofs. Chain programs trust a quorum of independent,
  staked operators.
- **Optimistic rollups and optimistic oracles** accept a claim unless it is
  challenged within a window. A single honest challenger is enough, because
  a false claim can be shown false.
- **Optimistic machine learning**
  ([opML, 2024](https://arxiv.org/pdf/2401.17555)) applies that pattern to
  model inference: a result stands unless a challenger re-executes it, and a
  bisection game finds the first step that differs.
- **Proof wrapping** in zero-knowledge virtual machines compresses a large
  proof into a small one by proving, inside a succinct proof system, that the
  large proof verified. Solana already verifies small Groth16 proofs on
  chain through its BN254 syscalls
  ([groth16-solana](https://lib.rs/crates/groth16-solana)).
- **Confidential GPU computing** runs a model inside protected hardware that
  signs a report of what it ran
  ([NVIDIA](https://docs.nvidia.com/confidential-computing/)). Hosted
  inference behind such reports is already offered commercially
  ([Phala](https://phala.com/posts/GPU-TEEs-is-Alive-on-OpenRouter)).

This proposal combines them: diversity and quorum by default, re-execution
and bonds for open models, proofs on demand where a proof system exists,
hardware reports as an alternative, and on-chain verification once proofs
can be wrapped small enough.

### Bonds

An evaluator locks lamports in `bond` with `PostBond`. A request's
`JurySpec.min_bond` sets the least bond each counted evaluator must hold.
`WithdrawBond` completes only after `bond_unlock_slot`, which MUST be later
than the end of the dispute and challenge windows of every request the
evaluator attested, and only if none of its attestations has an open
challenge.

Programs SHOULD require that the bonds behind a quorum exceed the value a
ruling can move. A ruling that guards more than its quorum can lose is
secured by honesty alone.

### Attestation challenges

Anyone may call `ChallengeAttestation` on a revealed attestation before the
request's dispute window closes, locking a challenger bond. There are four
kinds:

1. **Output mismatch (re-execution).** For an open model whose commitment
   pins `weights_ref`, `config_hash` and `runtime_hash`, the challenger
   claims that running the committed model on the pinned inputs does not
   produce `output_hash`. Registered verifiers re-execute and sign
   `"solana-inference-reexec:v1" || attestation || recomputed_output_hash`
   with `AttestReexecution`.
2. **Proof demanded.** The challenger asks for a proof of an attestation
   signed without one. The evaluator MUST call `PublishProof` with
   `proof_hash` and `proof_ref` before `respond_deadline`. A missing proof
   is a fault.
3. **Proof invalid.** The challenger claims a published proof does not
   verify against the evaluator's model commitment and `output_hash`.
   Verifiers check it and sign with `AttestProof`.
4. **Hardware report invalid.** The challenger claims a hardware report does
   not verify, does not match `tee_measurement`, or uses a revoked
   certificate. Verifiers check it and sign.

`ResolveAttestationChallenge` counts verifier signatures. Each check has one
right answer, so a program SHOULD require a supermajority of a verifier set
it trusts, from distinct operators. If the fault is proven, the attestation
is marked `voided`, the evaluator's bond is slashed (a share, set by the
program, to the challenger and the rest to the request's `refund_to`), its
`faults` count increases, and the challenger's bond is returned. Otherwise
the challenger's bond goes to the evaluator.

A voided attestation no longer counts. If the ruling it was part of loses its
quorum, the Rulings proposal reopens it for review.

### Hardware attestation

An evaluator running inside protected hardware MAY include a hash of the
hardware's signed report in `tee_report_hash` and keep the report at
`output_ref`. The report binds the runtime measurement, which MUST equal
`tee_measurement`, and the output. Hardware reports let closed models reach a
level above L1 without publishing weights. They move trust to the hardware
vendor's keys, and such hardware has a history of side-channel attacks, so a
request accepts them only when its `JurySpec.accept_tee` is set.

### Assurance levels

`assurance` is ordered, so a program can require a minimum:

- **0, L0 signatures.** Signed by `quorum` registered evaluators.
- **1, L1 diverse.** L0, plus commit-reveal and at least `quorum` distinct
  model families.
- **2, L1+ checkable.** L1, plus every counted evaluator holds at least
  `min_bond`, and every counted attestation can be checked by an attestation
  challenge: an open model with pinned weights and runtime, a committed proof
  system, or, with `accept_tee`, a hardware report. The request's challenge
  window has passed with no fault proven.
- **3, L2 proven.** L1+, plus every counted attestation carries a published
  proof, or with `accept_tee` a hardware report, confirmed by at least the
  program's required number of verifier signatures.
- **4, L3 verified on chain.** Reserved for a future proposal that verifies
  wrapped proofs inside the transaction.

Proofs are not verified on chain by this proposal. A **verifier** is an
evaluator-like registered key that signs
`"solana-inference-proof:v1" || attestation || proof_hash || result`, and
`AttestProof` counts these signatures in `proof_verifications`. Verifiers
check, they do not judge, so their quorum is about availability and
honesty, not diversity of opinion.

### Path to on-chain verification

On-chain verification becomes possible when a proof of inference can be
wrapped into a succinct proof of a few hundred bytes that Solana's existing
BN254 syscalls verify within a transaction's compute budget. Wrapping an
18 MB proof is itself a large proving job that has not been shown for model
inference. When it is, a future proposal can define L3 and an instruction
that accepts a wrapped proof in place of verifier signatures, with no change
to the attestation message.

### Fast evaluators (informative)


A new class of models, sometimes called System 1 models, returns a typed
answer (a choice from a list, a score or a yes or no) with a calibrated
probability, instead of generated text. One early example reports 70 to 500
milliseconds per decision, at a small fraction of a language model's cost,
with lower accuracy than frontier models on the vendor's own benchmark
([TypeSafe Jev, 2026](https://thenewstack.io/typesafe-jev-system-one/)).
These figures are vendor-reported and not independently reproduced.

They fit this interface in three ways, none of which needs new accounts:

1. **As a screen.** A creator publishes a second inference program with the
   same context set and a prompt that asks one yes-or-no question per rule. A
   caller requests a ruling from it first. Calling programs MAY act on a
   screen result only for outcomes that are safe on their own, such as
   `default_outcome`, or within value limits they enforce in code, and SHOULD
   escalate everything else to a full request.
2. **As an evaluator.** A System 1 evaluator can attest: its outcome and
   probability fill `outcome` and `confidence`. It cannot be the rapporteur,
   because it writes no summary, reasoning or sources, so a quorum SHOULD
   include enough language-model evaluators to post and sign off an opinion.
3. **To size the jury.** A client MAY use the screen's probability to choose
   the full request's `JurySpec`: a larger jury, or a higher assurance level,
   when the screen is unsure.

A hosted, closed System 1 model publishes no weights commitment, so it cannot
reach L2, and it counts as one model family. Calibrated probabilities are not
correct answers. These models are also weaker on numeric checks, which belong
in the calling program's own code anyway.

### Instructions

- `PublishModelCommitment` (signer: publisher): Creates an immutable
  ModelCommitment.

- `RegisterEvaluator` (signer: operator): Creates or updates an Evaluator.

- `CommitAttestation` (signer: evaluator signing key): Records the commitment
  before `commit_deadline`.

- `RevealAttestation` (signer: anyone): Checks the Ed25519 signature and the
  commitment, records the outcome.

- `PostBond` and `WithdrawBond` (signer: operator): Lock lamports as the
  evaluator's bond, or withdraw them after `bond_unlock_slot` with no open
  challenges.
- `ChallengeAttestation` (signer: anyone): Opens an AttestationChallenge of
  one of the four kinds and locks the challenger's bond.
- `PublishProof` (signer: evaluator signing key): Answers a proof demand
  with `proof_hash` and `proof_ref`.
- `AttestReexecution` (signer: registered verifier): Records the output hash
  a verifier obtained by re-running the committed model.
- `ResolveAttestationChallenge` (signer: anyone, after the deadlines):
  Counts verifier signatures, voids the attestation and slashes the bond on
  a proven fault, and settles both bonds.
- `AttestProof` (signer: registered verifier): Records a verifier's signature
  that an attestation's proof verifies against the evaluator's model
  commitment, and increments `proof_verifications`.

### Edge Cases

- **Non-deterministic hardware.** Two GPUs can produce different floating
  point results for the same model. Re-execution challenges are valid only
  when `runtime_hash` pins kernels and settings that make outputs
  reproducible, and verifiers MUST run that exact runtime. Without such a
  runtime, an open model is checkable only by proof.
- **Proofs or outputs that vanish.** If a challenged evaluator's
  `output_ref` or `proof_ref` cannot be fetched before `respond_deadline`,
  that is a fault.
- **Verifiers that disagree.** If neither side reaches the required
  supermajority before `resolve_deadline`, the challenge expires, both bonds
  are returned and the attestation stands.
- **Revoked hardware certificates.** A report signed under a certificate
  revoked before the report's slot is invalid.
- **Encrypted content without keys.** An evaluator with no KeyWrap cannot
  read the content and MUST NOT attest.

- **External content mismatch.** Evaluators MUST refuse to attest if fetched
  bytes do not hash to `content_hash`.

- **Retired evaluators or keys.** An evaluator retired after committing MAY
  still reveal for that request. Its key MUST NOT be accepted for new requests.

- **Too many signatures for one transaction.** Each reveal is its own
  transaction, so quorum size is not limited by transaction size.

- **Empty or malformed outputs.** An attestation whose outcome is not in the
  prompt's outcome list MUST be rejected at reveal.

### Validator Components Affected

None. Each proposal is an interface implemented by an on-chain program using
the existing Ed25519 signature-verification precompile. No runtime, virtual
machine, consensus or networking change is required. RPC providers, indexers
and explorers MAY decode the account layouts defined here.

## Alternatives Considered

- **Trusted execution environments.** Hardware attestations from secure
  enclaves can show which binary ran. They depend on hardware vendors and have
  a history of side-channel attacks. A model commitment can carry a TEE
  attestation in place of, or alongside, a proof of inference. A future
  revision could add it as an assurance level.

- **On-chain verification of proofs of inference now.** Current proofs for
  large language models are far larger than transaction and account limits
  allow, and take seconds of multi-core CPU time to verify. That rules out
  on-chain verification today.

## Impact

- **Evaluator operators** get one registration and attestation format,
  usable across applications, with published prices.
- **Calling programs** can require diversity of model families, or proofs.
- **Model providers** can publish commitments, and prove which model ran
  without publishing weights.
- **Validators and core contributors** are not affected.

## Security Considerations

- **Unchecked proof hashes.** A hash of a proof that does not exist, or does
  not verify, looks the same on chain as a real one. Only availability,
  challenges and bonds give a proof hash meaning. Programs MUST NOT treat a
  non-zero `proof_hash` alone as evidence.
- **Under-bonded quorums.** If the value a ruling moves exceeds the bonds
  behind its quorum, evaluators can profit from a false vote even when they
  lose their bonds.
- **Verifier collusion.** Verifiers that collude can void honest votes or
  protect false ones. Programs SHOULD use verifier sets with distinct
  operators and require a supermajority.
- **Griefing.** Challengers lock a bond that is forfeited when they lose, so
  frivolous challenges cost them money.
- **Proofs show the model, not the truth.** A proof or report shows which
  model produced an output. It does not show the output is right: a forged
  document in the evidence fools a proven model as easily as an unproven one.
- **Model substitution.** Without proofs of inference, an evaluator can run a
  different model than it committed to. Only L2 rulings address this, and
  closed models cannot reach L2.

- **Collusion.** Evaluators can coordinate. Commit-reveal stops copying within
  a request but not collusion arranged in advance. Distinct-family
  requirements, evaluator sets and bonds reduce but do not remove this risk.

- **Self-reported confidence.** Confidence is the model's own estimate and is
  not calibrated. Programs SHOULD weigh `agreeing` over `confidence_mean`.

- **Replay.** Attestations bind the request address, pinned hashes and input
  hash. Calling programs MUST check that `input_hash` matches the exact action.

- **Key compromise.** A compromised evaluator key can sign false attestations
  until retired. Quorums with distinct operators limit the impact of one key.

- **Determinism.** Proofs of inference require fixed decoding settings, so
  `config_hash` MUST describe them. Outputs that vary across runs cannot reach
  L2.

## Backwards Compatibility

This proposal adds a new program interface and changes nothing existing.

## Conformance

- A reference implementation of these instructions, with tests for
  commit-reveal with valid and invalid salts, rejection of unlisted outcomes,
  eligibility checks, distinct-family enforcement and verifier counting,
  bonds and withdrawals, and each kind of attestation challenge, upheld,
  rejected and expired, with slashing and bond settlement.
- Test vectors for the attestation message: input bytes, keys, expected
  hashes and expected signatures.
