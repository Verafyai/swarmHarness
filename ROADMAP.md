# Roadmap

Verafy Harness goes from a local prototype to an open network in stages. Each milestone has a done condition that can be checked. Dates are not set.

## Milestone 1: Local prototype (done)

- [x] Actually Smart Contract format `swarm.asc/0` (now `verafy.asc/1`; the old kind still validates): context, question, payment, exits, with a JSON Schema
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

- [x] Build DSH at the pinned commit and load the juror plugin (now `packages/dsh-verafy-juror`) into it. Not through DSH's pnpm workspace, which would mean editing `upstream/`: DSH is built in place, and `scripts/dsh-juror.mjs setup` links the plugin into the headless profile and links its peers to the built DSH packages
- [x] Run a headless DSH agent with the juror overlay (now `config/cordis.verafy.yml`) that loads a contract and casts a committed vote
- [x] Confirm the tool lock denies every non-juror tool during a juror run: the agent is offered 2 tools; a scripted probe called all 24 other tools the headless profile mounts, and all 24 were denied (measured, every juror in a five-juror run)
- [x] Record a keyless session snapshot of a juror run: `results/dsh-juror-session-2026-11-06.jsonl`, and again after the tool rename: `results/dsh-juror-session-verafy-2026-11-06.jsonl`
- [x] One harness per lab, each a DSH process with a different `dsh-llm-pi-ai` route

Done when: five DSH processes on five model routes rule on `examples/market-resolution.json` and the CLI seals the block from their reveals. Met on 2026-11-06 with live models through OpenRouter: anthropic/claude-haiku-4.5, openai/gpt-5-mini, google/gemini-2.5-flash, meta-llama/llama-4-maverick, qwen/qwen3-235b-a22b-2507. All five voted NO, agreement 100% against a bar of 80%, block sealed. Details and the runs that failed first are in [docs/dsh-juror.md](docs/dsh-juror.md); what DSH does not expose is in [docs/dsh-gaps.md](docs/dsh-gaps.md).

## Milestone 3: Live juries (started)

- [ ] Live runs of every example on real models, with measured latency and cost per ruling published. First pass measured 2026-11-06 ([results/live-2026-11-06.md](results/live-2026-11-06.md)): five contracts, wall time per contract, total cost only (OpenRouter reports cost per key, not per run), and one harness dropped on an upstream HTTP 429
- [x] Retry for rate-limited models: each harness's provider retries 429, 5xx and network errors with capped exponential backoff and full jitter, honoring Retry-After; a harness that still fails is dropped as before (`withRetry`, on by default in `openaiProvider`). Tested with fake providers only; not yet measured live
- [ ] Track record: per-harness agreement with final rulings and forecast scores (Brier) once outcomes arrive
- [x] Auditor role, in core: `drawAuditors` picks harnesses from labs not on the jury, `sampleForAudit` takes a seeded sample, and `audit` re-verifies a sealed ruling from its round record and re-runs the contract, returning a signed `swarm.audit/0` report that flags a bad record or disagreement. Tested with scripted models. Not yet: auditor pay from `pool:auditors`, auditor bonds, and audits run live or on a schedule
- [x] Challenge with new evidence, in core: `challengeContract` builds a `swarm.challenge/0` contract (the prior ruling as a pinned `ruling` context entry, the original evidence, the new material labeled new; a jury at least as large that shares no lab or harness with the original; exits that only record), and `resolveChallenge` returns a `swarm.review/0` record: affirm, overturn (new or false evidence, error), supersede (changed rules), or the original stands. `appendReview` and `reviewStatus` keep an append-only log; `seal` carries reviews only in the block of the ruling that decided them. The original ruling is never edited. Tested end to end with scripted models: forged evidence, then a challenge on false evidence, then overturned
- [x] Escalation, in core: `escalate` turns a below-bar ruling into a `swarm.escalation/0` contract funded by exactly the carried escrow, with a wider jury that excludes the original jury's labs and harnesses. Tested with a nine-seat jury drawn from labs not on the original
- [ ] Challenge bonds: lock on open, return on overturn or supersede, forfeit on affirm (draft rulings SIMD). Not built
- [ ] Run challenges and escalations from the CLI and the demo; today they are core functions and tests only
- [ ] A fast lane: a System 1 screen that settles only the safe default and escalates the rest

Audits do not catch forged evidence: an auditor reading the same pinned page reaches the same answer (the poison test shows this). Forged evidence is caught by a challenge that brings new material.

Done when: 100 live rulings across the four market types, with audit results and costs published.

### Core changes the chain asked for (Nov 2026)

From the verafyChain ROADMAP's "Needed in verafyHarness" list. Done in core:

- [x] `ruleFromRecords(asc, commits, reveals, {jury, sealer, seed})`: rules from recorded messages, pure and synchronous, no stand-in jurors. `rule()` now runs on top of it and accepts async reveals
- [x] A committed juror that never reveals is not counted and is listed in `round.faults` as `no-reveal` (and `no-commit` for a seated juror with no valid commitment); nothing throws
- [x] `verifyRuling(asc, ruling, {cards, pool, seed})` with reasons; `checkQuorum(asc, reveals)` exported
- [x] Every ruling carries `round`: seed, sealer account, jury cards with public keys, accepted commitments, counted reveals with salts, and faults, so it can be re-verified alone
- [x] The sealer account is configurable (`harness:<id>`, `node:<id>`, or any account; `accountFor`), and the pay rules are an exported check (`checkPay`)
- [x] `drawJury` takes a bond floor; `drawJuryFor(asc, pool, seed)` and `eligibleJurors` apply `maxValuePerVote` and the new `excludeLabs` and `excludeHarnesses` jury rules
- [x] `Harness` keeps an identity (`identity`) or loads one from a PEM file (`identityFile`, the same format as the DSH plugin's `identity.pem`)
- [x] `mockProvider(script)` answers any contract and lab, read from each request
- [x] `swarm.trigger/0` with `triggerMessage`, `signTrigger` and `verifyTrigger`; new triggers are now signed as `verafy.trigger/1`, and `swarm.trigger/0` still verifies
- [x] Challenge (`swarm.challenge/0`) and escalated-contract (`swarm.escalation/0`) formats, in the schema and `validate`
- [x] An optional `proofHash` on votes. Only the hash is recorded; a `proof` field anywhere in a ruling fails verification. A stored hash is not a proof by itself
- [x] `seal(parent, rulings, sealer, {time})` for deterministic headers
- [x] The rename to Verafy (Nov 6, 2026): CLI `verafy` with `swarm` as an alias, `verafy.asc/1`, `verafy.trigger/1`, `verafy.config.json`, `.verafy/`, `VERAFY_API_KEY`, `VERAFY_KEYBLOCK_PASSPHRASE`, juror tools `verafy_load_contract` and `verafy_cast_vote`. Every old name is still read, and old contracts keep their hashes (`packages/core/test/rename.test.js`)

Still open from that list: the harness daemon (milestone 4).

### Agent plugins (Nov 6, 2026)

- [x] `packages/mcp`: a zero-dependency MCP server with eight tools (validate, pin, hash, run, chain, block, doctor, examples), resources and two prompts. No vote, key or funds tool; contract text under `evidence`; live calls only with `--allow-live`, `live: true` and a `maxSpendUsd`
- [x] `integrations/`: Claude Code, Codex, Cursor, Gemini CLI, Goose, Hermes Agent, OpenClaw and any MCP client
- [ ] Publish `@verafy/mcp` to npm, then launch with `npx -y @verafy/mcp`
- [ ] Submit to the Claude Code, Hermes and OpenClaw catalogs, Cursor's directory and the Gemini CLI extension gallery

## Milestone 4: A network of harnesses

- [ ] Harness daemon: a long-running process that watches for funded contracts and takes jury seats
- [ ] MCP daemon tools, once the daemon exists: `verafy_harness_start`, `verafy_harness_status` and `verafy_harness_stop`. They run a real juror process with its own model and tool lock, so the agent that calls them still never votes. Not in `packages/mcp` yet.
- [ ] Gossip between harnesses for commitments and reveals; a sealer rotation
- [ ] Availability layer: storage harnesses that serve context by hash through the challenge window
- [ ] Bonds and slashing on a test network; faults proven by audit or by a missing reveal
- [ ] Hardware attestation where providers offer it, recorded with each vote

Done when: ten independently operated harnesses, on at least five labs' models, seal blocks on a test network for a week.

## Milestone 5: Solana integration

- [ ] A Solana program that accepts quorum-signed triggers, matching the draft SIMDs
- [ ] A devnet prediction market resolved end to end by a Verafy Harness jury
- [ ] Harnesses as evaluators under SIMD 2: model commitments, attestations, bonds and challenges

Done when: a devnet market is created, funded, resolved by a jury, and settled by a quorum-signed call, with the ruling readable by any program.

### Light client: reading the source chain without trusting one RPC

Built in `packages/lightclient` (zero dependencies) and wired into core through `packages/core/src/sourcechain.js`. Off unless the config has a `lightclient` block, so `npm test` and `npm run demo` run offline as before.

- [x] Solana multi-RPC reader: N endpoints (default 3) from at least 2 operators, commitment `finalized` by default; all agree is accepted, all different is unknown at once, a stale slot (more than 150 slots behind the newest answer, or below a floor) is rejected, and a 2 to 1 split follows the policy (default reject and retry, 2 retries; `accept-majority` is opt-in and still needs 2 operators in the majority). Tested with mocked RPCs
- [x] Endpoints are API router entries; a key is a keyblock secret or an environment reference (`secretEnv`), never a value. Results record each source's id, operator and host only, never a path, query or header. Tested, including a key that must not appear in results or the meter
- [x] EVM multi-RPC reader for any chain id: agree on a finalized head, check the block hash at it, then read balances, ERC-20 balances and receipts at that block. Tested with mocked RPCs
- [x] Intake checks escrow funding (`Harness.admit`, `fundingCheck`) before the jury is drawn; the outbox (`Outbox`) confirms a trigger landed and records the confirmation; a read whose sources disagree pauses the contract in an append-only `PauseLog` with the reason and the sources. Tested
- [x] One read-only run on Solana devnet, Nov 6, 2026 (**measured**): `api.devnet.solana.com` (Solana), `solana-devnet.api.onfinality.io/public` (OnFinality) and `devnet.rpcpool.com` (Triton) agreed on the genesis hash, the finalized slot, the SPL Token program account, and the finalized status of one transaction. A first attempt with Tatum's public gateway was replaced: it allows 5 requests per minute without a key
- [ ] Ethereum mainnet sync-committee verification. **Not built in this package.** `evm/helios.js` is an optional adapter for Helios (a16z, 0.12.0, released Oct 5, 2026; checked Nov 6, 2026), as a sidecar or a subprocess. It is tested only with Helios absent (reports "not installed") and with a mocked Helios RPC; it has not been run against a live Helios. Until it is, mainnet results are labeled `verification: multi-rpc`
- [ ] Run the funding check and trigger confirmation against a real devnet escrow (needs the Solana program in milestone 5)
- [ ] A harness daemon that re-reads paused contracts and resumes or refunds them (milestone 4)

**Watch for a Solana light-client protocol.** Status on Nov 6, 2026: none in production. Tinydancer, the main effort, has stopped development (Solana forum thread, May 2026); SIMD-0052 (transaction proofs and a block Merkle root for light clients) has had no recent activity. Alpenglow (SIMD-0326) changes how finality is reached, so recheck the commitment mapping when it activates. When a light-client protocol ships, add it as a source beside the RPC quorum, then make it the default. Recheck monthly.

## Milestone 5a: The routing agent

- [x] Payment wallet spending rules: allowlisted payees, monthly caps, approval threshold, bond reserve, full log (`PaymentWallet`)
- [x] Keyblock: API keys and wallet keys encrypted at rest; scoped keys with scopes, expiry, use limits, revocation and lock (`keyblock.js`)
- [x] Banker: accept any allowed token, best-quote swaps across approved venues, slippage limit, never sells the bond reserve, funds payments in the payee's token (`banker.js`, fixed-rate test venue)
- [x] API router: plug in AI APIs, external API routers, provers, hosts and payment endpoints; keys from the keyblock; metering; per-call and accrued billing through the banker (`apirouter.js`)
- [ ] Banker venue adapters for real DEX aggregators on Solana and EVM chains, and cross-chain bridges
- [x] Inference routing by assurance level: the cheapest route that meets the contract's L0 to L2 requirement, refusing when none does (`routing.js`)
- [ ] Accept payment in any asset and convert between assets on approved venues, within a slippage limit
- [ ] Connect to cloud backends: rent GPU and VM hosts for open-weights and proving routes, on demand where a contract needs L2
- [ ] Pay allowlisted suppliers (model credits, GPU or cloud host, storage) within caps; keep the bond topped up and a reserve
- [ ] Off-ramp hook for suppliers that only take cards or bank transfers
- [ ] Per-ruling accounting: what each ruling earned and what it cost to produce

Done when: a testnet harness runs for a week, accepting payment in at least two assets, renting its own host, paying its own model and hosting costs from its earnings, and serving one L2 contract on a proving route, with every conversion and payment logged and no manual transfers.

## TinySVM: exact settlement next to the AI (phase 1 built, 2026-11-06)

- [x] sBPF programs with no dependencies: `escrow`, `bond`, `ledger`, and the exit programs `graded_payout`, `ranked_split`, `milestone_escrow`, pinned by SHA-256 in `packages/tinysvm/programs.lock.json`
- [x] LiteSVM 0.18.2 as an engine sidecar (JSON lines over stdio), restricted to the pinned programs, an allowlist per contract, and a compute cap. LiteSVM does not build for WebAssembly (`packages/tinysvm/README.md`)
- [x] An optional `exitProgram` per exit with a params schema; params bounded before execution; settlement state kept across rulings. Existing contracts keep their hashes
- [x] runtime.js and TinySVM side by side on every built-in exit, with a property test over random in-bounds rulings; disagreement is a fault
- [ ] Move runtime.js's jury split to integer micro-units, so TinySVM can be integer only (needs Rex: it changes some future diffs by one micro-unit)
- [ ] TinySVM as the default runtime (needs Rex)
- [ ] Phase 2: Anza's `solana-svm` crate, and chain nodes re-running settlement when they verify a block

## Milestone 6: Proofs of inference

- [ ] Optional proof per vote for open models that can be proven today
- [ ] Off-chain proof verification by auditors, with proof hashes recorded in rulings
- [ ] Track proof size and verification time as they change, and move rulings from bonded to proven as they become practical

Done when: a ruling with a verified proof for every counted vote is sealed.

## Not planned

- A token. Escrow is paid in an existing currency.
- Unbounded authority for any single ruling. Contracts cap what one ruling can move.
- Resolving disagreement by hiding it. Dissent is always recorded.
