# Atoms and plans

*The small questions proof packing works with, and the exact rule that composes them.*

An atom is one question with a closed answer type (yes-no, a choice, or an integer in a range) and only the facts that decide it, each fact citing its pin in the contract's context.

A plan lists the atoms and a decision rule, such as: if the record is unavailable, UNCLEAR; if a passing vote is recorded, YES; else NO. If an atom the rule needs comes back UNKNOWN, the plan's declared fallback applies. It never guesses.

Every plan is validated against its contract: every outcome must be one of the contract's options, every atom must be used, and every cited pin must exist.

**Status.** Built (PACK-001 to 006). See the [specification](/spec).

**Related:** [Proof packing](/learn/proof-packing)
