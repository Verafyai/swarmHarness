# The routing agent

*The part of a harness that holds keys and pays bills: keyblock, payment wallet, API router and the Banker.*

A harness pays for its own model calls and hosting. The routing agent does that, in four parts:

- **The keyblock** holds keys encrypted at rest and issues scoped keys with expiry, use limits and revocation. Nothing outside it holds a raw secret.
- **The payment wallet** pays only allowlisted payees, within caps, with human approval above a threshold, and never touches the bond.
- **The API router** meters every model call, per call or accrued.
- **The Banker** converts what the harness was paid into what its suppliers take.

**Status.** Built (BANK-001 to 005). See the [specification](/spec).

**Related:** [The Banker](/learn/banker), [API credits](/learn/api-credits)
