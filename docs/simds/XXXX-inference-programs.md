---
simd: 'XXXX'
title: Inference Programs
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

This proposal defines **inference programs**: programs written in natural
language, stored on chain, called by other Solana programs, and executed off
chain by AI models. It standardizes how a program's prompt and context are
stored (inline, from a web page or a git repository at a commit, compact,
compressed or encrypted), how they change over time, and how a caller
requests a ruling: with a request prompt, external context, a jury
specification, and an escrowed budget that pays the model operators and
refunds the rest.

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

A smart contract can enforce only what code can express: balances,
signatures, timestamps and arithmetic. Many rules that matter most to
on-chain organizations are judgments: "the treasury shall not fund political
campaigns", "what a proposal does must match what its text says", "hold any
withdrawal that looks like an account takeover". Today they live in forum
posts and constitutions that nothing on chain can check, and judgment
happens off chain, by a multisig or a vote.

Large language models can read and apply rules like these. To use them from
a smart contract, the rules need a public, versioned home on chain, every
ruling must name the exact text it applied, and calling programs need one
way to ask, pay and read back. This proposal provides the first two and the
request side of the third.

The same request can ask for a judgment about the past ("was the milestone
delivered?") or a prediction about the future ("will this proposal pass?").
Prediction markets can use both: a forecast request records what independent
models expected, and a later resolution request records what happened.

## Dependencies

This proposal depends on the following proposals, submitted together:

- **SIMD-XXXX: Inference Evaluators and Attestations**

  Defines the evaluators that serve a request, and the JurySpec fields that
  refer to them.

- **SIMD-XXXX: Inference Rulings, Disputes and Challenges**

  Defines the Ruling that answers a request, and uses the request `kind` and
  `reviews` fields.

## New Terminology

- **Inference program**: An on-chain account that names a prompt, a context
  set, an output schema and evaluation requirements.


- **Prompt**: The instructions the model follows, with the list of allowed
  outcomes.


- **Context set**: An ordered list of context documents (policies, rules, a
  constitution, standards, contract terms, or linked pages such as a DAO
  discussion) that evaluators load into the model's context alongside the
  prompt.


- **Internal context**: The inference program's own materials, which apply to
  every request: a DAO constitution or bill of rights, run rules, an
  insurance policy, standards. Stored inline, or pulled from a web page or a
  trusted GitHub repository pinned at a commit.


- **External context**: Context a caller injects into one request: the
  evidence and case being decided, as links, text or documents. It never
  overrides internal context.


- **Request prompt**: The caller's question for one request, such as "Does
  proposal 42 comply?". It works within the program's instructions and
  cannot add outcomes.


- **Jury specification**: The part of a request that says who may rule: how
  many evaluators, the quorum, the required assurance level, and which model
  families or specific models are allowed.


- **Budget**: Lamports a requester escrows to pay evaluators and verifiers.
  Unspent budget is refunded.


- **Linked content**: A context document or evidence item given as a URL.
  It is fetched once into a snapshot, and every evaluator reads the same
  snapshot.


- **Content account**: An account that holds one prompt or one context
  document, in any supported encoding, inline or by external reference.


- **Encoding**: How stored bytes become model input: plain text, a compact
  compiled form, compressed, encrypted, or a combination.


- **Context budget**: The number of tokens an evaluator must be able to accept
  for the prompt, context and input together.


- **Revision**: A counter that increases every time a prompt or context set
  changes.


- **Mutability mode**: Whether a creator can change content immediately
  (mutable), only after a public delay (timelocked), or never (frozen).


- **Ruling request**: An account recording a request to run one inference
  program on one input, with the pinned prompt and context hashes, quorum and
  deadlines.


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

#### InferenceProgram


```text
discriminator        [u8; 8]
authority            Option<Pubkey>  // None once frozen
mutability           u8         // 0 mutable, 1 timelocked, 2 frozen
update_timelock      u64        // slots, used when mutability = 1
revision             u32        // +1 on every prompt or context change
prompt               Pubkey     // Content account holding the prompt
context_set           Option<Pubkey>  // ContextSet account
pending_prompt       Option<Pubkey>  // staged change, timelocked mode
pending_context_set   Option<Pubkey>  // staged change, timelocked mode
pending_after        u64        // slot after which staged changes apply
context_budget       u32        // tokens evaluators must accept
ext_context_mode     u8         // 0 not accepted, 1 optional, 2 required
ext_context_kinds    u16        // bit per ContextEntry kind a caller may add
ext_context_budget   u32        // tokens of external context allowed
min_evaluators       u8         // floor on evaluators per request
min_quorum           u8         // floor on agreeing attestations
min_assurance        u8         // 0, 1 or 2
distinct_families    bool       // require distinct model families
default_outcome      u8         // outcome on expiry or no quorum
evaluator_set        Option<Pubkey>  // optional EvaluatorSet account
name                 [u8; 64]   // UTF-8, zero padded
```

#### Content


Holds one prompt or one context document.

```text
discriminator        [u8; 8]
authority            Option<Pubkey>
revision             u32
content_hash         [u8; 32]   // sha256 of the stored bytes
source_hash          [u8; 32]   // sha256 of the plain-text source, or zero
encoding             u8         // bit flags, see "Encodings"
stored_len           u32        // bytes held here or externally
decoded_len          u32        // bytes after decryption and decompression
token_estimate       u32        // creator's estimate of model tokens
storage_kind         u8         // 0 inline, 1 external, 2 link,
                                // 3 git repository
external_ref         [u8; 96]   // e.g. an inscription's transaction
                                // signature, zero padded
link                 [u8; 256]  // URL when storage_kind is 2 or 3
git_commit           [u8; 20]   // pinned commit when storage_kind = 3
git_path             [u8; 128]  // file or folder in the repository
snapshot_slot        u64        // when the linked page was captured
key_envelope         Option<Pubkey>  // KeyEnvelope account, if encrypted
outcome_count        u8         // prompts only
outcomes_hash        [u8; 32]   // prompts only: sha256 of outcome list
writing              bool       // true while chunks are being written
updated_slot         u64
content              [u8]       // inline bytes when storage_kind = 0
```

Content larger than one transaction is written in chunks with
`WriteContentChunk` while `writing` is true. `SealContent` MUST check that the
sha256 of the bytes equals `content_hash` and sets `writing` to false.
Evaluators MUST NOT use content while `writing` is true.

With `storage_kind = 1`, the bytes live elsewhere (for example, an inscription
stored by another program, or a content-addressed store) and only the hash is
held here. Evaluators MUST fetch the bytes, check that their sha256 equals
`content_hash`, and refuse to attest otherwise.

**Linked content.** With `storage_kind = 2`, the content is a page on the
web, such as a DAO forum thread, a governance proposal, a news article or a
terms-of-service page. Live pages change, and evaluators fetching them at
different moments would rule on different text. So a link is always ruled on
through a snapshot:

1. `SnapshotLink` records the sha256 of the captured page in `content_hash`,
   a reference to the stored copy in `external_ref`, and `snapshot_slot`. Any
   signer may capture a link that has no snapshot yet. A program MAY limit
   capture to its authority or to listed evaluators.
2. Requests pin the snapshot's `content_hash`, like any other content.
   Evaluators MUST read the snapshot, not the live page, and MUST refuse to
   attest if it does not match the hash.
3. To rule on a newer version of the page, take a new snapshot. That changes
   the context hash, so it is a new revision.

**Git repositories.** With `storage_kind = 3`, the content is a file or
folder in a git repository the creator trusts to publish its rules, pinned
at `git_commit`. `content_hash` is the sha256 of the files at that commit, in
sorted path order. Moving to a newer commit is an update like any other, so
it follows the program's mutability mode.

Snapshots SHOULD store the page as text with its URL, title and capture time,
and SHOULD strip scripts and markup. Requests can also carry links as
evidence: the requester snapshots each linked page, and `evidence_hash`
covers the snapshot hashes.

#### ContextSet


```text
discriminator        [u8; 8]
authority            Option<Pubkey>
revision             u32
context_hash         [u8; 32]   // sha256 over the ordered list of
                                // (kind, label, content_hash) entries
count                u8
entries              [ContextEntry; count]

ContextEntry:
  content            Pubkey     // Content account
  content_hash       [u8; 32]   // must equal that account's content_hash
  kind               u8         // 0 constitution, 1 standard, 2 regulation,
                                // 3 contract terms, 4 internal policy,
                                // 5 rules, 6 discussion, 7 web page,
                                // 8 other shaping context,
                                // 9 prior ruling (see Rulings)
  label              [u8; 32]   // e.g. "EDO v1.0", zero padded
```

A context set lets one inference program apply several rule sets at once. For
example, a certification program can hold its standards (EDO v1.0 and EAO
v1.0) as two entries, and a treasury program can hold the DAO constitution
and the treasury policy. Context sets MAY be shared by many inference programs.

Evaluators MUST place the context documents in the model's context in entry
order, before the prompt and the input, each preceded by its `kind` and
`label`. The prompt SHOULD instruct the model to cite the context entry and
section behind each finding.

#### KeyEnvelope (encrypted content only)


```text
discriminator        [u8; 8]
content              Pubkey
scheme               u8         // 0 = X25519 + HKDF-SHA256 + ChaCha20-Poly1305
count                u8
wraps                [KeyWrap; count]

KeyWrap:
  evaluator          Pubkey     // Evaluator account
  ephemeral_pub      [u8; 32]
  wrapped_key        [u8; 48]   // content key encrypted to the evaluator
```

#### RulingRequest


A PDA at `["request", inference_program, requester, nonce_le_u64]`.

```text
discriminator        [u8; 8]
inference_program    Pubkey
revision             u32        // pinned at creation
prompt_hash          [u8; 32]   // pinned prompt content_hash
context_hash         [u8; 32]   // pinned context_hash, or zero
requester            Pubkey
input_hash           [u8; 32]   // sha256 of the canonical input
input_ref            [u8; 96]   // where evaluators fetch the input
evidence_hash        [u8; 32]   // sha256 over sorted evidence hashes,
                                // or zero
ext_context_hash     [u8; 32]   // sha256 over the external context, or zero
ext_context_count    u8
ext_context          [ContextEntry; 8]  // caller-supplied documents
request_prompt_len   u16
request_prompt       [u8; 1024] // the caller's question, UTF-8
jury                 JurySpec
max_input_tokens     u32        // cap used for pricing and context checks
max_output_tokens    u32
budget               u64        // lamports escrowed in this account
quoted               u64        // estimate from QuoteRuling at request time
spent                u64        // paid out so far
refund_to            Pubkey     // receives what is left
callback_program     Option<Pubkey>  // notified of the events below
callback_events      u8         // bits: final, needs funds, expired,
                                // disputed
topup_deadline       u64        // slot by which a shortfall must be covered
commit_deadline      u64        // slot
reveal_deadline      u64        // slot
opinion_window       u64        // slots for the rapporteur to post
signoff_deadline     u64        // slot by which sign-offs must land
dispute_window       u64        // slots after finalization
kind                 u8         // 0 ruling, 1 dispute, 2 challenge
reviews              Option<Pubkey>  // the Ruling under review, if any
status               u8         // 0 open, 1 revealing, 2 final,
                                // 3 disputed, 4 expired, 5 closed,
                                // 6 needs funds

JurySpec:
  evaluators         u8         // number of attestations sought (n)
  quorum             u8         // agreeing attestations required (k)
  assurance          u8         // 0 L0 ... 4 L3, see Attestations
  min_bond           u64        // least bond per counted evaluator
  accept_tee         bool       // hardware reports may count for L1+, L2
  distinct_families  bool
  family_count       u8
  allowed_families   [[u8; 32]; 8]  // empty = any family
  model_count        u8
  allowed_models     [Pubkey; 8]    // ModelCommitment accounts,
                                    // empty = any model
  max_fee_each       u64        // most any one evaluator may be paid
  verifier_fee       u64        // per proof verification, for L2
```

`RequestRuling` MUST set the jury's `evaluators`, `quorum` and `assurance` to
at least the inference program's minimums, MUST NOT allow a model or family
outside the program's evaluator set when it has one (a request can narrow
the jury, never widen it), and MUST copy `revision`, `prompt_hash` and
`context_hash` from the program as it stands at that slot. A request MAY
instead name an earlier revision's hashes, if that content is still
retrievable.

### Encodings


Models do not need prompts in tidy English. A prompt or context document can
be stored in whatever form is smallest or most private, as long as evaluators
can turn it into model input. `encoding` is a set of bit flags, applied in
this order when writing and reversed when reading:

- **Bit 0, compact.** A compiled, terse form of the source that a model reads
  directly: abbreviations, symbols and structured shorthand instead of full
  sentences. The source can be written in any human language. For example,
  this 178-byte rule:

  > Hold the withdrawal if it looks like an account takeover: a password,
  > email or 2FA change in the last 48 hours, followed by a withdrawal to an
  > address the account has never used.

  compiles to 68 bytes:

  ```text
  R5 HOLD if acct_sec_change<=48h(pw|email|2fa) AND dest∉prior_dests
  ```

  Compact content MUST carry a non-zero `source_hash`, so anyone holding the
  plain source can check which text it was compiled from. Creators SHOULD test
  that the compact form produces the same rulings as the source on a set of
  sample inputs, because compilation can change meaning.
- **Bit 1, compressed.** zstd. Evaluators MUST decompress before building
  model input. Models do not read compressed bytes directly.
- **Bit 2, encrypted.** ChaCha20-Poly1305 under a random content key, wrapped
  to each listed evaluator's X25519 key in a KeyEnvelope. Only those
  evaluators can read the content. Everyone else sees the hash, the length and
  the token estimate. Evaluators MUST decrypt before building model input.

`content_hash` always covers the stored bytes, so the chain can check that
nothing changed. `source_hash` covers the human-readable source, so a creator
can later publish the source and prove it is what the models ran.

### Storage size and cost (informative)

Content accounts can hold up to 10 MiB. Larger content is written in chunks. At
current parameters a rent-exempt account costs 6,960 lamports per byte plus a
128-byte header, refunded when it is closed. Five certification standards
together (22,712 bytes of text) compress to 5,246 bytes, about 0.0377 SOL of
rent; measurements for other texts are in the [overview
post](https://blog.verafy.ai/articles/20261105-simd-verifiable-inference). In
practice the limit is the evaluator's context, not storage: the prompt, all
context and the input must fit within `context_budget`. Creators SHOULD set
`token_estimate` on every content account.

### Mutability


Creators can change both the prompt and the context set. How fast depends on
`mutability`:

- **Mutable (0).** `SetPrompt`, `SetContextSet` and `UpdateContent` take effect
  in the slot they land, and `revision` increases.
- **Timelocked (1).** Changes are staged in `pending_prompt` and
  `pending_context_set` and apply only after `pending_after`, which is the
  staging slot plus `update_timelock`. Anyone can see a change coming.
- **Frozen (2).** Nothing changes again. `authority` is `None`.

`SetMutability` MUST only move toward frozen: mutable to timelocked, or either
to frozen.

Every change MUST emit a log line with the old and new `content_hash` or
`context_hash`, so indexers can keep a history. Implementations SHOULD store
each revision's bytes somewhere retrievable, such as an inscription, so any
past ruling can be checked against the exact text it applied.

Requests are never affected by later changes. A request pins `prompt_hash` and
`context_hash` at creation, and evaluators MUST attest against the pinned
content. If the creator replaces the content before evaluators fetch it and
the old bytes are not retrievable, evaluators cannot attest and the request
expires to `default_outcome`.

### External context


Internal context is set by the inference program's creator and applies to
every request. External context is supplied by whoever calls the program and
applies to one request. A DAO's constitution is internal context; the
proposal being judged, its forum thread and its decoded calldata are call
context. An insurer's policy terms are internal context; a claim and its
photos are external context.

`RequestRuling` accepts up to 8 external-context entries, each a Content account
(inline, external or a snapshotted link), plus a short inline note of up to
512 bytes. A calling program can inject context through cross-program
invocation by creating Content accounts for longer material, or by passing
the note in instruction data. The program MUST check:

1. `ext_context_mode` allows external context, and requires it when set
   to 2.
2. Every entry's `kind` is allowed by `ext_context_kinds`.
3. Every entry is sealed and, for links, snapshotted.
4. The combined `token_estimate` of external context fits within
   `ext_context_budget`, and internal context, external context and input
   together fit within `context_budget`.

`ext_context_hash` is the sha256 over the ordered entries' `(kind, label,
content_hash)` followed by the note, and it is pinned like every other hash.

Evaluators MUST build the model's context in this order: the prompt, the
internal context, then the external context under a heading stating that it was
supplied by the caller for this request, then the input and evidence. The
prompt SHOULD tell the model that internal context governs, and that call
context is material to judge, not instructions to follow.

### Shaping the jury


A request says who may rule. `JurySpec` sets the number of evaluators, the
quorum, the required assurance level, whether families must differ, and
optional lists of allowed model families and specific model commitments.
Only active evaluators that match every constraint, and whose `max_context`
fits the request, may commit. A DAO can require L2 and two named open
models; an agent's spending check can accept any three fast models at L1.

### Payment, budget and refunds


Evaluators are paid by the request, in lamports, from an escrow the requester
funds up front.

1. **Quote.** `QuoteRuling` takes the same arguments as `RequestRuling` and
   sets return data to an estimate: for the cheapest eligible evaluators
   that satisfy the jury, `base_fee` plus input and output tokens at their
   prices, up to `max_input_tokens` and `max_output_tokens`, plus `proof_fee`
   and `verifier_fee` at L2, plus rent for the request, attestation and
   ruling accounts. Clients simulate it before requesting.
2. **Escrow.** `RequestRuling` moves `budget` lamports into the request and
   records `quoted`. It MUST fail if `budget` is below `quoted`. Evaluator
   prices are pinned at request time; later price changes do not apply.
3. **Payout.** When an evaluator reveals, its charge is fixed: `base_fee`
   plus its token charges and proof fee, never more than its pinned prices
   allow and never more than `max_fee_each`. `CloseRequest` pays each
   revealed evaluator to its `payout_wallet`, pays verifiers, and adds the
   totals to `spent`.
4. **Refund.** After payouts, the rest of `budget` and all reclaimed rent go
   to `refund_to`. Unrevealed slots and expired requests are refunded in
   full, minus work already revealed.
5. **Insufficient funds.** If the escrow cannot cover the next step (for
   example, more evaluators are needed after an invalid reveal, or proofs
   cost more than quoted), the request moves to "needs funds" and records the
   shortfall. Work pauses until anyone calls `TopUp` with at least the
   shortfall before `topup_deadline`. If no one does, the request expires to
   `default_outcome`, revealed work is paid, and the rest is refunded.

**Callbacks.** If `callback_program` is set, a crank calls `NotifyCaller`
when an event in `callback_events` happens: final, needs funds, expired or
disputed. `NotifyCaller` invokes the callback program with the request, the
event and, for "needs funds", the shortfall. Callbacks only notify. They move
no funds, and a callback program MUST re-check the ruling with `ReadRuling`
before acting on it. Programs that do not use callbacks can poll the request.

Evaluator bonds, slashing and challenges to individual votes are defined in
the Evaluators and Attestations proposal. A request sets the least bond it
accepts with `JurySpec.min_bond`. Implementations SHOULD also record
equivocation (an evaluator revealing two different outcomes for one request)
so that clients can exclude that evaluator.

### Instructions

- `CreateContent` (signer: authority): Creates a Content account with its
  hash, length, encoding and token estimate.

- `WriteContentChunk` (signer: authority): Writes inline bytes at an offset
  while `writing` is true.

- `SealContent` (signer: authority): Checks the hash and marks the content
  ready.

- `UpdateContent` (signer: authority): Replaces a Content account's bytes and
  hash, subject to the owning program's mutability.

- `SnapshotLink` (signer: any, unless the program restricts it): Records a
  linked page's snapshot hash, reference and slot.

- `SetKeyEnvelope` (signer: authority): Attaches or replaces the key wraps for
  encrypted content.

- `CreateContextSet` and `SetContext` (signer: authority): Create a context set
  or replace its entries.

- `CreateInferenceProgram` (signer: authority): Creates the program with its
  prompt, context set, budget and minimums.

- `SetPrompt` and `SetContextSet` (signer: authority): Point the program at new
  content, immediately or staged, by mutability mode.

- `ApplyPending` (signer: anyone): Applies staged changes after
  `pending_after`.

- `SetMutability` (signer: authority): Moves toward frozen.

- `QuoteRuling` (signer: none): Estimates the cost of a request and returns
  it as return data.

- `RequestRuling` (signer: requester): Creates a RulingRequest with its call
  context and jury, and escrows the budget.

- `TopUp` (signer: anyone): Adds lamports to a request's escrow, and resumes
  it when the shortfall is covered.

- `NotifyCaller` (signer: anyone): Sends a pending event to the request's
  callback program.

- `CloseRequest` (signer: anyone, after the ruling is final or expired):
  Pays evaluators and verifiers, refunds the rest to `refund_to`, reclaims
  rent.

**Commit, then reveal.** Each evaluator first submits only
`sha256(message || salt)` before `commit_deadline`. After that slot, the
evaluator (or anyone holding the message, salt and signature) calls
`RevealAttestation`. The program MUST check that:

1. The transaction contains an Ed25519 precompile instruction verifying
   `signing_key`'s signature over the message. The program reads it with
   instruction introspection.
2. The message fields match the request and the evaluator's model commitment.
3. `sha256(message || salt)` equals the stored commitment.

No evaluator can see another's answer before committing to its own.

**Finalization.** After `reveal_deadline`, `FinalizeRuling` counts revealed
attestations by outcome. If at least `quorum` agree on one outcome, and that
quorum meets the program's family and assurance requirements, the Ruling
records that outcome. Otherwise the Ruling records `default_outcome` with
`certainty.agreeing` below `quorum`. Calling programs MUST treat that as "no
ruling".

### Edge Cases

- **Content changes during a request.** Requests pin hashes at creation.
  Evaluators attest only against pinned content. If it is no longer
  retrievable, the request expires.

- **Frozen programs.** `SetPrompt`, `SetContextSet`, `UpdateContent` and
  `SetContext` MUST fail once the relevant `authority` is `None`.

- **Shared context sets.** A context set used by several programs changes for
  all of them. Programs that need stability SHOULD use a frozen or
  timelocked context set.

- **Linked pages that change or vanish.** Rulings use the pinned snapshot,
  so later edits to the live page change nothing. If the snapshot itself is
  not retrievable, evaluators cannot attest and the request expires.

- **Pages that cannot be fetched.** Pages behind logins or paywalls, or that
  disallow automated access, SHOULD NOT be linked. Supply the text as inline
  or external content instead.

- **No eligible evaluators.** If no active evaluators match the jury
  specification and context size, `QuoteRuling` and `RequestRuling` MUST
  fail rather than create a request that cannot be served.

- **Estimates that are wrong.** Token counts are capped by
  `max_input_tokens` and `max_output_tokens`, so charges cannot exceed the
  quote's basis. A shortfall can still arise when extra evaluators or proofs
  are needed, and is handled by "needs funds".

- **External context not accepted.** If `ext_context_mode` is 0,
  `RequestRuling` MUST reject any external context. If it is 2, it MUST
  reject requests without any.

- **Over budget.** If prompt, context and input exceed an evaluator's
  `max_context`, that evaluator MUST NOT attest. `RequestRuling` SHOULD fail
  if fewer than `evaluators` listed evaluators can fit `context_budget`.

- **Compact form drift.** If the compact form and the source disagree, the
  stored bytes are what was ruled on. `source_hash` lets anyone show the
  difference.

- **Deadlines.** Deadlines are slots. Clients SHOULD allow enough slots for
  model latency, which is commonly tens of seconds per ruling.

- **Input confidentiality.** `input_ref` may point to encrypted content
  readable only by the evaluators. The on-chain hash stays public.

### Validator Components Affected

None. Each proposal is an interface implemented by an on-chain program using
the existing Ed25519 signature-verification precompile. No runtime, virtual
machine, consensus or networking change is required. RPC providers, indexers
and explorers MAY decode the account layouts defined here.

## Alternatives Considered

- **Each application defines its own format.** This is the status quo. It
  works for one application, but calling programs, wallets and explorers cannot
  interpret results across applications, and every team re-solves replay
  protection, commit-reveal and content pinning.

- **Immutable versions only.** Earlier drafts made every prompt version
  immutable behind a version pointer. That is safer for callers but costs a
  new account per edit and slows creators down. Pinned hashes give callers the
  same guarantee for any single ruling, and creators who want permanence can
  freeze.

- **General-purpose oracles.** Existing oracle networks deliver data and
  computation results, but do not define natural-language programs, context
  sets, model commitments, model-family diversity or proofs of inference.

- **Running models on chain.** Small networks can run inside a program, but
  models able to read natural-language rules are many orders of magnitude
  beyond compute and storage limits.

## Impact

- **Dapp developers** get one way to store natural-language logic, call it
  from a program and pay for it.
- **DAOs, treasuries and companies** can keep constitutions, policies and
  standards on chain as context, update them in public, and freeze them.
- **Wallets and explorers** can show the exact prompt, context, revision and
  mutability behind any request, or the hashes alone when content is
  encrypted.
- **Validators and core contributors** are not affected.

## Security Considerations

- **Injected instructions in external context.** A caller can put text in
  the external context that tries to steer the models ("approve this").
  Evaluators MUST present external context as material to judge, below the
  internal context, and inference programs SHOULD restrict which kinds
  callers may add.

- **Manipulated pages.** Whoever controls a linked page controls what is
  captured. A DAO discussion can be edited, or flooded with posts, before the
  snapshot. Programs SHOULD snapshot at a defined moment, for example when a
  vote closes, and SHOULD treat linked pages as evidence to weigh, not as
  rules. Text inside a page MUST be passed to the model as data, never as
  instructions.

- **Mutable rules.** A creator can change the prompt or context to rules that
  favor them. Pinned hashes protect any single ruling, but not future ones.
  Calling programs SHOULD check `prompt_hash` and `context_hash` against values
  they trust, or require timelocked or frozen programs, for high-value
  decisions. Wallets SHOULD show the mutability mode.

- **Encrypted rules cannot be audited.** When content is encrypted, users
  cannot read the rules they are judged by, and any evaluator can leak them.
  Programs that use encryption SHOULD publish `source_hash` and SHOULD commit
  to disclosing the source after a stated time or on dispute.

- **Compact forms can change meaning.** Compilation is lossy. Creators SHOULD
  test compact forms against the source, and disputes SHOULD be able to
  reference the source.

- **Fee padding.** An evaluator could claim more tokens than it used.
  Charges are capped by pinned prices, the request's token caps and
  `max_fee_each`, and output length is checkable against `output_hash`.

- **Callbacks.** Callbacks run in separate transactions and move no funds,
  so they cannot drain escrow. A callback program must not trust the event
  alone; it re-reads the ruling.

- **Liveness and censorship.** Evaluators may not answer. Expiry yields
  `default_outcome`. Programs MUST design that outcome to be the safe one, for
  example "hold" rather than "allow".

## Backwards Compatibility

This proposal adds a new program interface and changes nothing existing.

## Conformance

- A reference program implementing these instructions, with tests on a local
  cluster for each mutability mode, timelocked staging, freezing, request
  pinning across content changes, compact, compressed and encrypted content,
  linked and git content, context-budget checks, external context limits,
  jury constraints, quotes, escrow, refunds, "needs funds", top-ups and
  callbacks.
- Test vectors for the context hash, the external context hash, the encoding
  pipeline and the key envelope.

## Appendix A: Prompt format (informative)


```text
asc: 1
name: <short name>
applies_to: <the kind of input, e.g. withdrawal or proposal_execution>
outcomes:
  <id>: <one-line meaning>
default: <outcome id used on expiry or no quorum>
evidence: [<names of evidence items evaluators may read>]
---
<instructions in natural language, or their compact form>
```

Evaluators MUST reply in this form, and `output_hash` covers the whole reply:

```text
{
  "outcome": "<one id from outcomes>",
  "confidence": <0 to 100>,
  "summary": "<the decision in a few sentences>",
  "reasoning": "<why, step by step, applying the context to the input>",
  "sources": [
    { "kind": "context", "content_hash": "<hex>", "locator": "Art. 2, sec. 3" },
    { "kind": "evidence", "content_hash": "<hex>", "locator": "ticket" }
  ]
}
```
