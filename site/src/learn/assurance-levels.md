# Assurance levels

*L0 to L3: how much proof a contract asks for, from a plain jury to proofs of inference.*

A contract sets its assurance level, and the router never lowers it.

- **L0:** a jury of hosted models. Fast and cheap.
- **L1:** a wider or more diverse jury, with audits.
- **L2:** every counted vote must carry a proof of inference that verifies. Closed models cannot be proven, so L2 runs open weights only, and a fast screen's answer is never used.
- **L3:** L2 plus independent re-verification.

**Status.** L0 to L2 routing built (BANK-005); L2 proofs work end to end with a mock prover (PROVE). See the [specification](/spec).

**Related:** [Proofs of inference](/learn/proof-of-inference), [Multi-model routing](/learn/multi-model-routing)
