# The Banker

*A deterministic service, not an AI agent, that turns deposits in any allowed token into the target token, with every step recorded.*

The Banker receives deposits and converts them, in a fixed order:

detect, classify, hold, quote, simulate, swap, sweep, record.

- **Classify:** tokens are allowlisted by address, never by name. Unknown tokens are quarantined and never touched. Dust is held with no gas spent. A sanctions match freezes the deposit for a human.
- **Quote:** at least one real venue (Jupiter on Solana, LI.FI for EVM chains and bridges), checked against an independent reference price. A quote too far from it is rejected.
- **Simulate:** the exact transaction is dry-run first. If it fails, nothing is sent.
- **Execute:** off by default. Turning it on needs a scoped signer, and one kill switch stops everything outbound.

Every state change goes into a hash-chained ledger that cannot be edited. Each deposit is keyed by chain, transaction and index, so a restart never swaps twice. Converting other people's money is disabled in code until a legal review.

**Status.** Built (BANK-006, 008, 010, 011); venues quote live, execution untested on a funded wallet (BANK-007). See the [specification](/spec).

**Related:** [The routing agent](/learn/routing-agent), [API credits](/learn/api-credits), [Coin-free](/learn/coin-free)
