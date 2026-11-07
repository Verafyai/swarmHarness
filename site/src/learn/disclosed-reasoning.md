# Disclosed reasoning

*Where a juror's reasoning is kept, what it costs to store, and what goes on chain.*

Each reveal carries the juror's reasoning. On chain, only its hash is stored. The text itself goes to storage, kept through the challenge window, so an auditor or a challenger can read why a juror answered as it did.

Reasoning length is also a cost: in proof packing, every reasoning token a juror writes takes room from other questions in the 1,024-token window. Modeled at 1,000 contracts: no reasoning fits 16 atoms per request at $0.0069 a decision; 400 tokens fits 2 at $0.0251.

**Status.** Partly built (COT). See the [specification](/spec).

**Related:** [Proof packing](/learn/proof-packing), [The economics](/learn/economics)
