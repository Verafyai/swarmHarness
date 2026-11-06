# Bringing Inference Programs To Solana

*Rex St John, November 5, 2026. Canonical version: [blog.verafy.ai](https://blog.verafy.ai/articles/20261105-simd-verifiable-inference). The three draft SIMDs it introduces are in [docs/simds](../simds).*

This is the essay that started Swarm Harness. The SIMDs bring inference programs to Solana as ordinary programs; [Swarm Chain](https://swarmchain.verafy.ai) asks what happens if you take the same idea all the way, and Swarm Harness is the validator for it.

---

Our intention is to propose, and have a discussion around, the potential of a new class of smart contracts, which we are loosely calling inference programs, or Actually Smart Contracts, and whether the technical and security building blocks realistically exist to justify or support them. The key motivator is Anthropic’s recent result on [zero-knowledge proofs of LLM inference](https://www.anthropic.com/research/provable-inference), and we wanted to test whether it could mean a new class of programs on Solana. We have no strong opinion on whether this is technically feasible, but we see interesting potential if it is. The drafts were written with help from AI tools, so please flag anything that’s poorly reasoned or overlong in the [discussion in the SIMD repository](https://github.com/solana-foundation/solana-improvement-documents/discussions/724).

**Three draft SIMDs.** All three are drafts, written to open a discussion, not yet submitted as proposals.

1. **SIMD-XXXX:** [Inference Programs](../simds/XXXX-inference-programs.md): natural-language programs on chain, their internal context, and how other programs call them, inject external context, shape the jury and pay. ([Markdown](../simds/XXXX-inference-programs.md))
2. **SIMD-XXXX:** [Inference Evaluators and Attestations](../simds/XXXX-inference-attestations.md): who runs the models, what they commit to, the signed vote each one casts, bonds and challenges, and proofs of inference, which are too large for the chain today. ([Markdown](../simds/XXXX-inference-attestations.md))
3. **SIMD-XXXX:** [Inference Rulings, Disputes and Challenges](../simds/XXXX-inference-rulings.md): the signed ruling programs act on, and how rulings are disputed, challenged with new evidence and overturned. ([Markdown](../simds/XXXX-inference-rulings.md))

Each will get its real number when it is submitted as a pull request. This started as one draft. It grew large enough that it reads better as three proposals that depend on each other, so each can be reviewed on its own.





---

![Slide: Motivation. Trustless systems still run on human judgment: a DAO constitution with no one to enforce it, an insurance policy whose claims are judged off chain, an exchange hot wallet guarded only by code.](https://blog.verafy.ai/content/20261105-simd-slide-gap.jpg)

Blockchains have made real progress toward trustless, decentralized systems that run without anyone in charge. But they still lean on people for judgment: discussion, opinion, motives and alignment, all happening off chain. That reliance has been a steady source of inefficiency, and of risk.

A DAO can pass a constitution, but it has no full-time lawyers to enforce it. An insurer can write a policy that a smart contract is meant to pay out on, but deciding whether a claim qualifies still happens off chain, by people. An exchange may want to wrap its hot wallets in procedures that protect user funds, and find it can only enforce what code can express. Code is law, and code can’t say everything.

That’s why we think it’s time to talk seriously about how AI and blockchains can converge to add the missing piece: judgment, and policy checks built into the contract itself. A program should be able to get a second opinion, ask an expert panel, or go to a judiciary for a ruling before it moves funds. Done right, that means better security and more control over how funds are managed.

To that end, we’re introducing Actually Smart Contracts as three SIMDs for Solana itself. Yesterday we [introduced the idea](/articles/20261104-actually-smart-contracts): smart contracts you can write in English, enforced by a jury of AI models. Today we’re publishing three draft Solana Improvement Documents that would make it a shared standard, so every program, wallet and explorer can use it the same way.

### The idea in one paragraph

Store a prompt on chain the way you’d store a program, along with the context that should shape the decision: policies, rules, a constitution, even a link to a DAO discussion. Let any Solana program call it. AI models run it off chain, and each one signs the result on chain: we ran this program, at this version, on this input, and this is the answer. A proof of inference shows which model actually did the thinking. The calling program checks the signatures before it acts.

![Animation: a Solana program requests a ruling; AI models off chain read the prompt and context stored on chain, vote and attach proofs; the signed ruling is recorded on chain; the program verifies it and acts.](https://blog.verafy.ai/content/20261105-simd-flow.svg)

That changes what a smart contract can be. Today a program can only enforce what code can express: balances, signatures, dates. With an inference program, it can enforce a sentence like “the treasury shall not fund political campaigns.”

### Why proof of inference is the key

![Slide: each side does what it is best at. Solana keeps the record and triggers programs, models do the thinking off chain, and the proof joins them.](https://blog.verafy.ai/content/20261105-simd-slide-whyproof.jpg)

Proof of inference lets each side do what it’s best at.

**Solana does what blockchains do best.** It keeps a permanent, public record of decisions, certifications and proof statements, and of every payment. It stores the programs and the context the models should use, and it lets other programs trigger them.

**Models do the deep thinking, off chain.** Reading a constitution, weighing evidence and deciding whether an action breaks a rule takes large models on serious hardware. That work doesn’t belong on chain, and it doesn’t need to be there.

**The proof joins them.** It shows which model gave the answer, so the chain can trust a decision it didn’t compute. Without it, you’re trusting whoever ran the model. With it, you’re checking. The catch, covered next, is that the proof itself is far too big for the chain, so the drafts make it checkable rather than storing it.

Together, that opens up a wide range of uses: DAO arbitration, ethics checks for AI models and agents, policy checks, certifications, and more.

### The proof problem: why proofs stay off chain

Here’s the hard part, and it’s critical. A proof of inference is the strongest evidence that a specific model produced an answer, and it doesn’t fit on Solana. The one published system for large language models reports these figures for a single proof:

| | One proof today | Solana limit |
|---|---|---|
| Size | about 18.78 MB | 1,232 bytes per transaction |
| Storage | about 131 SOL of rent | 6,960 lamports per byte, 10 MiB per account |
| Upload | about 19,000 transactions | about 1 KB per transaction |
| Verification | about 17 seconds on 24 CPU threads | 1.4 million compute units, milliseconds of work |
| Coverage | one open model | any model, ideally |



The size comes from what’s being proven: every layer of a model with hundreds of billions of parameters, for every token. Proof systems that need no trusted setup grow with the work they cover, so they handle huge computations but don’t produce the tiny proofs a chain can check cheaply. A ruling with five proven votes would need about 650 SOL of rent. And there’s a subtler problem: if the chain can’t check a proof, a proof hash on its own proves nothing. Anyone could post the hash of a proof that doesn’t exist.

![Slide: proofs are too big for the chain, make lying expensive instead. One proof against Solana's limits, what to store instead, and the assurance levels.](https://blog.verafy.ai/content/20261105-simd-slide-offchain.jpg)

**What we store instead.** Three things replace the proof:

1. **A binding commitment.** The output, the model, the inference runtime and, where one exists, the proof are fixed by hash in the signed vote, so an evaluator can’t change its story later.
2. **Availability.** Everything needed to check the vote (the output, the proof, and for open models the weights) must stay fetchable through the dispute and challenge windows.
3. **A cost for lying.** Evaluators post a bond. Anyone can challenge a vote, and a fault proven by a check with one right answer loses the bond.

**Precedent.** None of this is new. Oracles already deliver data to chains with signatures and money at stake rather than proofs. Optimistic rollups and optimistic oracles accept a claim unless someone challenges it within a window, and one honest challenger is enough. [Optimistic machine learning](https://arxiv.org/pdf/2401.17555) applies that to model inference: a result stands unless a challenger re-runs it. Zero-knowledge virtual machines wrap large proofs into small ones, and Solana already verifies small Groth16 proofs on chain through its [BN254 syscalls](https://lib.rs/crates/groth16-solana). And [confidential GPUs](https://docs.nvidia.com/confidential-computing/) run models inside protected hardware that signs a report of what it ran, which is already [offered for hosted inference](https://phala.com/posts/GPU-TEEs-is-Alive-on-OpenRouter).

**The workarounds, as a ladder.** The evaluators draft turns these into assurance levels a program can require:

- **L0, signatures.** A quorum of registered evaluators signed.
- **L1, diverse.** Different model families, votes committed before they’re revealed. One evaluator quietly swapping models can’t flip the result.
- **L1+, checkable.** Every evaluator is bonded, and every vote can be challenged: by re-running an open model on a pinned runtime and comparing outputs, by demanding the proof, or by checking a hardware report. Proofs are made only when someone asks for one.
- **L2, proven.** Every vote carries a published proof, or a hardware report if the request accepts those, confirmed by independent verifiers.
- **L3, verified on chain.** Reserved for when a proof of inference can be wrapped into a few hundred bytes that Solana checks inside a transaction.

Two cautions. Bonds only secure what they cover, so a program should require that the bonds behind a quorum exceed what a ruling can move. And proofs show which model ran, not whether its answer was right: the forged correction that fooled all ten models in our tests would have passed every proof. That’s why diversity, hard limits in code, and challenges to the ruling itself matter as much as proofs.

### Why now

![Slide: two missing pieces, knowing which model ran and a common format.](https://blog.verafy.ai/content/20261105-simd-slide-whynow.jpg)

Two pieces have been missing.

The first is a way to know which model ran. A signature proves which key signed, not which model did the work. [Anthropic’s research on provable inference](https://www.anthropic.com/research/provable-inference) shows that a provider can prove a committed set of model weights produced a specific answer, without revealing the weights. It’s a research prototype today, for one open model, and as the proof problem above shows, its proofs are far too large to store or check on chain. So the drafts keep a commitment, a bond and the right to challenge on chain, have independent verifiers check proofs off chain, and leave room to verify on chain later.

The second is a common format. Without one, every team invents its own requests, signatures and results, and nothing can read them across applications. That’s what a SIMD is for.

### What it would make possible

![Slide: rules that code alone cannot enforce, from constitutions to agent policies, with Verafy Judiciary as an example.](https://blog.verafy.ai/content/20261105-simd-slide-possible.jpg)

- **Constitutions that hold.** A DAO checks a passed proposal against its constitution, held as the program’s internal context, before it executes.
- **Treasury guardrails.** A withdrawal over a threshold waits for a ruling against a written policy.
- **On-chain certifications.** A published standard, like “a consumer device shall never record without a visible indicator,” becomes a program. Models review a specific commit against it, and the ruling is a public certificate.
- **Judgment clauses.** Grants and escrow that pay when what was promised actually happened.
- **Agent policies.** Programs acting for AI agents check risky actions against the agent’s written limits.
- **Predictions and prediction markets.** Independent models record a signed, timestamped forecast before an event, and a separate ruling resolves the market after it.

For an example of what we have in mind, see [Verafy Judiciary](https://judiciary.verafy.ai). You write your community’s rules once, and a jury of AI models from different companies applies them to a dispute and cites the clause behind each ruling. These SIMDs are how rulings like that could be recorded on chain, proven, and acted on by any Solana program.

### What’s in the drafts

![Slide: six pieces across three SIMDs: instructions, internal context and calls in SIMD 1; evaluators and attestations in SIMD 2; rulings in SIMD 3.](https://blog.verafy.ai/content/20261105-simd-slide-draft.jpg)

Across the three drafts there are six pieces. [Inference Programs](../simds/XXXX-inference-programs.md) covers the first three, [Evaluators and Attestations](../simds/XXXX-inference-attestations.md) the next two, and [Rulings, Disputes and Challenges](../simds/XXXX-inference-rulings.md) the last.

1. **Instructions.** What the inference program is for and the outcomes it may return, stored on chain in whatever form is smallest or most private.
2. **Internal context.** The program’s own materials, which apply to every call: a DAO constitution or bill of rights, run rules, an insurance policy, certification standards. They can be stored inline, pulled from a web page, or pulled from a trusted GitHub repository pinned at a commit. It loads into the model’s context window with the prompt, so one call can run a policy check, a legal check, a tax check, an insurance check or a DAO rules check.
3. **Calls.** Each call injects a request prompt (the question), external context (the evidence: a link, a paragraph, documents to check), jury shaping (which labs and models, how many, what level of proof) and payment. The caller gets a cost estimate first, escrows a budget that pays the model providers, is refunded what’s left, and gets a callback to add funds if it runs short. External context never overrides internal context.
4. **Evaluators.** Model operators register a signing key, their prices, a bond, and a commitment to exactly what they run: hashes of the weights, the tokenizer, the runtime and the decoding settings.
5. **Attestations.** One exact message format for the signature, bound to one request, its instructions, its internal and external context, and its input. Votes are committed before they’re revealed, and checked with Solana’s existing Ed25519 verification. Any vote can be challenged by re-running the model, demanding its proof, or checking a hardware report, and a proven fault loses the evaluator’s bond.
6. **Rulings.** The contract writes back a signed decision, like a court opinion: the outcome, a short summary, the full reasoning, the sources it relied on (each checked against the internal and external context it was given), how strongly the models agreed, every model’s wallet signature, and a sign-off where one model writes the opinion and the others co-sign it. Dissents stay on the record. Quorum, a safe default, disputes, challenges and assurance levels from L0 to L2 (with L3, on-chain verification, reserved) come with it.

![Diagram: anatomy of an Actually Smart Contract. The caller injects a request prompt, external context, jury shaping and payment; the inference program holds its instructions and pulls its internal context; evaluators off chain rule and return a signed ruling.](https://blog.verafy.ai/content/20261105-simd-slide-anatomy.jpg)

![Slide: calling an Actually Smart Contract. Inject a request prompt and external context, shape the jury, and pay from escrow with a quote, refunds and a top-up callback.](https://blog.verafy.ai/content/20261105-simd-slide-calling.jpg)

![Block diagram: what goes into a request. The RulingRequest account holds pinned rules, the question, external context, jury shaping, payment, and callbacks and deadlines, fed by the caller, the inference program and content accounts, and read by evaluators.](https://blog.verafy.ai/content/20261105-simd-slide-request.jpg)

![Diagram: what the contract writes back, a signed ruling with decision, certainty, pinned hashes, summary, reasoning, sources used, signatures, sign-off and dissents, returned to the calling program.](https://blog.verafy.ai/content/20261105-simd-slide-ruling.jpg)

![Block diagram: what a ruling records on chain, field group by field group with bytes: header, pinned hashes, decision, certainty, opinion, sources, vote signatures, sign-offs and dissents, with long material off chain by hash and a compact answer returned by ReadRuling.](https://blog.verafy.ai/content/20261105-simd-slide-rulingacct.jpg)

### Small, private and changeable

![Slide: small, private and changeable. A compact form, encryption, and updates that never rewrite past rulings.](https://blog.verafy.ai/content/20261105-simd-slide-small.jpg)

Models don’t need tidy English. A prompt can be written in any language and compiled into a terse form a model still reads directly. One of our 178-byte withdrawal rules compiles to 68 bytes:

```text
R5 HOLD if acct_sec_change<=48h(pw|email|2fa) AND dest∉prior_dests
```

On top of that, content can be compressed, and encrypted so that only the chosen evaluators can read it. Everyone else sees a hash. Evaluators decompress and decrypt before the model sees anything.

Context can also be a link: a DAO forum thread, a governance proposal, a web page. Live pages change, so a link is captured once into a snapshot with its hash, and every model rules on that same snapshot. To rule on a newer version, take a new snapshot.

Storage is cheap. Our five draft standards, about 3,400 words together, compress to about 5 KB, which costs roughly 0.04 SOL in rent at today’s rates. A single account holds up to 10 MiB. The real limit is the model’s context window, so every program declares a context budget and evaluators declare what they can take.

And both the prompt and its context can change. Whoever creates the program can update them at any time, stage changes behind a public delay, or freeze them for good. Every ruling pins the exact hashes it used, so a change never rewrites a past decision.

### Rulings can be challenged and overturned

A ruling isn't the last word, and it shouldn't be. Evidence turns out to be forged, a source is corrected, or the reasoning looks wrong once more is known. Courts deal with this by letting a later court overturn an earlier decision, sometimes generations later, while the original stays in the record. Inference programs work the same way.

There are two kinds of review. A dispute is quick: within a short window, a fresh ruling is re-judged on the same evidence by different model families, before anyone relies on it. A challenge can come at any time, with no deadline. The challenger names the grounds (new evidence, false evidence, misapplied rules, or rules that have since changed), posts a bond and pays for the review. The challenge jury gets the original ruling and its full reasoning, the original evidence, and the new material, clearly labeled as new. It has to compare itself to the original, source by source, and say which new source changed the answer.

![Slide: any ruling can be challenged, none is erased. Ruling R1, a dispute days later, new evidence years later, then a challenge ruling R2 that compares itself to R1 and overturns it. Grounds, results and guards listed.](https://blog.verafy.ai/content/20261105-simd-slide-challenge.jpg)

The result is affirmed, overturned, or superseded when the rules themselves changed. Nothing is erased: the original stays on chain, marked overturned, with a link to the ruling that overturned it, so the whole history can be read back. Past actions stay settled. What changes is the record and what programs do next. An insurer can pay a claim whose denial was overturned, and no program may act on an overturned ruling. To stop a losing side from relitigating until it draws a friendlier jury, every challenge must bring something no earlier review considered, the bond is returned only if the challenge wins, and each review uses fresh model families. Past rulings can also be cited as precedent in a program's context, always with their review status attached.

### Predictions and prediction markets

An inference program can make a prediction as well as a judgment. Ask about a future event, list the outcomes (yes or no, or ranges of a number), and each model’s vote carries its probability. Because votes are committed before they’re revealed and the ruling is finalized at a known slot, the result is a public, timestamped record of what independent models expected, before anyone knew the answer.

That makes prediction markets a natural fit. Before a market closes, the market, or anyone, requests a **forecast ruling**: the market’s question is the request prompt, and the evidence (news, filings, a forum thread, all snapshotted) is external context. After the event, a separate **resolver** program rules on what happened. Its internal context holds the market’s resolution rules: what counts, which sources decide, and what happens if they disagree. The market pays out only on a final resolution after its dispute window, and a resolution can still be challenged and overturned on new or false sources. Any program can read both rulings and score how well each model forecast.

![Slide: a forecast on record before the event, a ruling after it. Forecast ruling, resolution ruling, then score or challenge.](https://blog.verafy.ai/content/20261105-simd-slide-predict.jpg)

We’ve run the resolution half already: in one of our recorded runs, a forecast market resolved on the real FOMC statement, 6 of 6. Two cautions carry over from everything else here. The resolver never sees the forecast, so it can’t anchor on it. And a forecast is only the models’ estimate: they know nothing after their training data unless the external context supplies it, and anyone who controls a linked page can try to move a market, which is why snapshots, injection rules and challenges apply.

### Faster and cheaper: System 1 models

A ruling from a jury of language models takes 20 to 60 seconds in our recorded runs. That's fine for a DAO proposal and too slow for an agent's loop or a busy withdrawal queue. A new kind of model may help. [TypeSafe's Jev](https://thenewstack.io/typesafe-jev-system-one/) is what they call a System One model: instead of writing text, it returns a typed answer (a choice, a score, or a yes or no) with a calibrated probability, in 70 to 500 milliseconds and for about $0.0004 a decision, by the vendor's own figures.

The names come from psychology: System 1 is the fast gut check, System 2 is slow, careful reasoning. In an inference program, System 1 screens and System 2 rules. Each rule in the program's internal context becomes one yes or no question, checked in parallel. A clear, low-stakes case gets a fast result or the safe default. An unclear or costly one escalates to the full jury, and the screen's probability can decide how big that jury should be.

![Slide: System 1 screens, System 2 rules. A request goes to a System 1 screen that returns a typed answer and probability per rule; clear, low-stakes cases get a fast result or the safe default, unclear or high-stakes ones go to the full jury. Pluses and minuses listed.](https://blog.verafy.ai/content/20261105-simd-slide-systemone.jpg)

The pluses are real. It's sub-second, so it fits where a jury can't. Its typed answers map straight onto the outcomes a program lists. Its probabilities are trained to be calibrated, which beats a language model reporting how confident it feels. The minuses matter as much. It writes no reasoning, so it can't produce the opinion, summary and sources a ruling needs. It's one hosted, closed model, so it adds no diversity of labs and can't carry a proof of inference. On TypeSafe's own benchmark it scored 67.8% against 73 to 74% for frontier models, and calibrated isn't the same as correct. So it's the fast lane, not the court: the attestations draft adds an informative section on using System 1 models as a screen, as an evaluator that votes but doesn't write the opinion, and to size the jury.

### What it doesn’t do

![Slide: honest limits. No validator changes, no on-chain proof checks yet, and models are not infallible.](https://blog.verafy.ai/content/20261105-simd-slide-doesnt.jpg)

It doesn’t change the validator. Everything in the drafts can be built as a Solana program today. It doesn’t store or verify proofs of inference on chain, because they’re still far too big; commitments, bonds and challenges stand in for them. And it doesn’t make models infallible: in our tests, a forged correction in the evidence fooled all ten models we tried. The drafts say so, and ask calling programs to keep hard limits in their own code.

### Next step

![Slide: next step, opening the idea to Solana in the SIMD Ideas discussion.](https://blog.verafy.ai/content/20261105-simd-slide-next.jpg)

Solana’s SIMD process asks that ideas be discussed before a proposal is submitted. We’ve opened a [discussion in the SIMD repository](https://github.com/solana-foundation/solana-improvement-documents/discussions/724) to find out whether this is viable, what’s wrong with it, and who wants to build it with us. All three drafts are below.

[See Actually Smart Contracts run](https://asc.verafy.ai).

---
