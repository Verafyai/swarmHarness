# Exits and TinySVM

*The AI chooses an exit; TinySVM runs it with exact integer arithmetic that every node can re-run.*

An exit is what a contract does for one answer: pay, refund, split a prize by rank, pay by grade, release a milestone, or escalate.

TinySVM is a small settlement engine built from LiteSVM. It runs only the exit programs the contract declared by hash, with checked integer math, and every transfer list must sum to zero. It decides nothing; the jury already did.

Exit programs in the repo: `escrow`, `bond`, `ledger`, `graded_payout`, `ranked_split` and `milestone_escrow`. A JavaScript runtime gives the same answers, and running both side by side turns any disagreement into a fault.

**Status.** Built (SETTLE). TinySVM as the default runtime waits on Rex. See the [specification](/spec).

**Related:** [Actually Smart Contracts](/learn/actually-smart-contracts), [Verafy Chain](/learn/verafy-chain)
