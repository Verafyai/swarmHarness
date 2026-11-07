# Spec changelog

Versions follow semantic versioning with a pre-release tag. Requirement IDs never change meaning. See [VERAFY-SPEC.md](VERAFY-SPEC.md) for the rules.

## v0.0.1-alpha, November 6, 2026

The first versioned spec, with a scoring pass.

**New in the spec**
- One spec for Verafy Harness and Verafy Chain, in 17 areas with stable requirement IDs, generated from [requirements.json](requirements.json).
- The scoring pass: `npm run score` checks every claim against the code, scores each area, and lists gaps by impact ([SCORECARD.md](SCORECARD.md)). `npm test` fails if a claim's check fails.
- Multi-model routing (ROUTE): a fast screen, tiered panels that escalate on disagreement, calibrated cutoffs, audits and shadow mode.
- Proof packing and the prompt compressor (PACK): atoms, dedupe, packing, briefs, fidelity checks.
- The Banker as a deterministic service (BANK-006 to BANK-011, [banker.md](banker.md)).
- Proving (PROVE): prove once while one model is provable, proofs after the reveal, finality on verification.
- Disclosed reasoning (COT), governance (GOV), settling on Solana (SOL), Muse experiments (EXT).

**New in the code with this version**
- `packages/route`: the router, the Jev screen adapter, calibration and audits (12 tests).
- `packages/economics`: `cascade()` for tiered routing, and reasoning length in the proven-block model.
- `scripts/score.mjs`: the scoring pass.

**Already in the code before this version, now specified**
- Core protocol, live juries, auditors and challenges, the routing agent's four blocks, the light client, TinySVM phase 1, batching and the encrypted queue, proof packing (`packages/pack`), economics, the MCP server and agent plugins.
