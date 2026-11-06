# Roadmap

Swarm Harness goes from a local prototype to an open network in stages. Each milestone has a done condition that can be checked. Dates are not set.

## Milestone 1: Local prototype (done)

- [x] Actually Smart Contract format `swarm.asc/0`: context, question, payment, exits, with a JSON Schema
- [x] Context pinning by SHA-256 and a loader that rejects mismatched content
- [x] Harnessed validator: intake, bond check, juror prompt with evidence wrapping, vote parsing
- [x] Ed25519 identities, commit-then-reveal, signed attestations
- [x] Agreement for verdicts, forecasts and graded answers, compared with a bar
- [x] Contract runtime: exits, escrow split, conservation check, cross-chain triggers, escalation below the bar
- [x] Seeded jury draw across labs; rulings sealed into linked blocks
- [x] CLI with scripted and live (OpenAI-compatible) providers; five example contracts; 14 tests
- [x] Payment routers: per-harness accept lists and a local payout ledger, in the contract's own asset (added with the run-a-harness guide)

Done when: `npm test` passes and `npm run demo` seals five blocks. Met.

## Milestone 2: Juror mode inside DeepSeek Harness (done, 2026-11-06)

- [x] Build DSH at the pinned commit and load `packages/dsh-swarm-juror` into it. Not through DSH's pnpm workspace, which would mean editing `upstream/`: DSH is built in place, and `scripts/dsh-juror.mjs setup` links the plugin into the headless profile and links its peers to the built DSH packages
- [x] Run a headless DSH agent with `config/cordis.swarm.yml` that loads a contract and casts a committed vote
- [x] Confirm the tool lock denies every non-swarm tool during a juror run: the agent is offered 2 tools; a scripted probe called all 24 other tools the headless profile mounts, and all 24 were denied (measured, every juror in a five-juror run)
- [x] Record a keyless session snapshot of a juror run: `results/dsh-juror-session-2026-11-06.jsonl`
- [x] One harness per lab, each a DSH process with a different `dsh-llm-pi-ai` route

Done when: five DSH processes on five model routes rule on `examples/market-resolution.json` and the CLI seals the block from their reveals. Met on 2026-11-06 with live models through OpenRouter: anthropic/claude-haiku-4.5, openai/gpt-5-mini, google/gemini-2.5-flash, meta-llama/llama-4-maverick, qwen/qwen3-235b-a22b-2507. All five voted NO, agreement 100% against a bar of 80%, block sealed. Details and the runs that failed first are in [docs/dsh-juror.md](docs/dsh-juror.md); what DSH does not expose is in [docs/dsh-gaps.md](docs/dsh-gaps.md).

## Milestone 3: Live juries

- [ ] Live runs of every example on real models, with measured latency and cost per ruling published
- [ ] Track record: per-harness agreement with final rulings and forecast scores (Brier) once outcomes arrive
- [ ] Auditor role: re-run a random sample of sealed rulings with a different lab and flag disagreement
- [ ] Challenge with new evidence: a challenged ruling is affirmed, overturned or superseded, never erased
- [ ] A fast lane: a System 1 screen that settles only the safe default and escalates the rest

Done when: 100 live rulings across the four market types, with audit results and costs published.

## Milestone 4: A network of harnesses

- [ ] Harness daemon: a long-running process that watches for funded contracts and takes jury seats
- [ ] Gossip between harnesses for commitments and reveals; a sealer rotation
- [ ] Availability layer: storage harnesses that serve context by hash through the challenge window
- [ ] Bonds and slashing on a test network; faults proven by audit or by a missing reveal
- [ ] Hardware attestation where providers offer it, recorded with each vote

Done when: ten independently operated harnesses, on at least five labs' models, seal blocks on a test network for a week.

## Milestone 5: Solana integration

- [ ] A Solana program that accepts quorum-signed triggers, matching the draft SIMDs
- [ ] A devnet prediction market resolved end to end by a Swarm Harness jury
- [ ] Harnesses as evaluators under SIMD 2: model commitments, attestations, bonds and challenges

Done when: a devnet market is created, funded, resolved by a jury, and settled by a quorum-signed call, with the ruling readable by any program.

## Milestone 5a: Self-funding harnesses

- [ ] Operations agent in the harness: keep the bond topped up, hold a reserve, swap earnings into what bills need on approved venues, and pay allowlisted suppliers (model credits, GPU or cloud host, storage) within caps
- [ ] Off-ramp hook for suppliers that only take cards or bank transfers
- [ ] Per-ruling accounting: what each ruling earned and what it cost to produce

Done when: a testnet harness runs for a week paying its own model and hosting costs from its earnings, with every swap and payment logged and no manual transfers.

## Milestone 6: Proofs of inference

- [ ] Optional proof per vote for open models that can be proven today
- [ ] Off-chain proof verification by auditors, with proof hashes recorded in rulings
- [ ] Track proof size and verification time as they change, and move rulings from bonded to proven as they become practical

Done when: a ruling with a verified proof for every counted vote is sealed.

## Not planned

- A token. Escrow is paid in an existing currency.
- Unbounded authority for any single ruling. Contracts cap what one ruling can move.
- Resolving disagreement by hiding it. Dissent is always recorded.
