# The encrypted queue

*Contracts wait sealed until their jury is drawn, so nobody can front-run a ruling.*

A contract can be submitted sealed. Its clear metadata (escrow, jury rules) lets nodes plan a block, but its content opens only after the jury is drawn, when enough nodes release their key shares (Shamir sharing over a 521-bit prime field, with X25519).

This stops anyone from seeing a contract early and positioning around it. It does not hide the contract from the jurors or from a proving machine, which must read what they rule on.

**Status.** Built (CHAIN, batching). See the [specification](/spec).

**Related:** [Verafy Chain](/learn/verafy-chain), [Juries, commit and reveal](/learn/jury)
