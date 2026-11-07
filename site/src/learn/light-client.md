# The light client

*How a harness reads other chains: several independent sources that must agree, never one RPC.*

A contract funded on Solana or Ethereum needs its funding checked before a jury sits. The light client asks several independent RPC providers, run by different operators, and proceeds only when they agree at the required commitment level.

If sources disagree or too few answer, the contract is paused, never admitted on one source's word. The Banker uses the same reads to confirm deposits.

**Status.** Built for Solana (LIGHT); Ethereum through Helios waits on Rex. See the [specification](/spec).

**Related:** [The Banker](/learn/banker), [The routing agent](/learn/routing-agent)
