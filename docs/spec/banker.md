# The Banker: a "send me anything" receiver and converter

Part of the Verafy spec v0.0.1-alpha. Requirements BANK-006 to BANK-011 in [VERAFY-SPEC.md](VERAFY-SPEC.md).

Nov 6, 2026.

## Is it an agent?

No. The Banker is a **deterministic service**: a state machine with hard policy limits. A model never decides whether, when, what, or how much money moves.

**Why:**
- Money-moving decisions must be reproducible, testable and auditable.
- A model can be talked into things: a token's name, a memo or a transaction note is attacker-controlled text.
- Every swap must be explainable as "rule X allowed it, quote Y met limit Z".

**Where AI is allowed:** an optional **Banker advisor** that is read only. It can:
- write the daily report in plain words
- explain why a deposit is stuck
- flag anomalies for a human, such as an unusual deposit size or a token that looks like a phishing copy
- suggest policy changes, which a person must approve

It holds no keys and can't call the Banker's write methods. It is the same pattern as Jev in the jury: it advises, it doesn't rule.

In the harness, the Banker is one block of the **routing agent** (keyblock, banker, API router, payment wallet). "Agent" there means an autonomous process, not an LLM.

## Rules

- **Git:** branch and PR only. Rex merges.
- **Dependencies:** core stays at zero dependencies. Chain adapters live in `packages/banker-*`, optional.
- **Keys:** nothing outside the keyblock holds a raw secret. Every signing goes through scoped keys with per-key caps.
- **No token, ever.** Nothing mints. The Banker only moves existing tokens.
- **The bond is never spent.** It's never swapped and never used for gas.
- **Copy:** no em or en dashes. Label every number.
- **Mainnet:** devnet and testnet first. Mainnet only after Rex says go, with caps he sets.

## What it does

```
deposit lands on a watched address
  -> detect (light client, multi-RPC agreement)
  -> classify (allowlist? minimum? sanctions screen?)
  -> hold (confirmations)
  -> quote (two or more venues, plus an independent reference price)
  -> simulate (dry run on chain)
  -> swap (or skip, with the reason)
  -> sweep (to the treasury wallet, in the target token)
  -> record (ledger, cost basis, receipts)
```

Each step is a state in a per-deposit state machine. Transitions are idempotent and keyed by `(chain, txid, index)`, so a restart can't double-swap.

## 1. Deposit addresses

**Families:**
- **Solana:** one address, plus one associated token account per allowed SPL token. Optionally, one address per payer for attribution: derived addresses from one keyblock seed.
- **EVM:** one address valid on every EVM chain you watch. Optionally, per-payer counterfactual deposit addresses (CREATE2) that are deployed and swept only when funded.
- **Bitcoin:** one address per payer (HD derivation, fresh per invoice).

**The front end.** A `receive` page or API shows "pay with" options: chain plus token. It returns the right address, a QR code, the minimum, and what you'll receive after conversion (a modeled quote, labeled). It never shows an address for a chain or token you don't watch.

## 2. Detect

- Watchers use the light client from master spec Part F.
  - **Solana:** multi-RPC agreement at `finalized`.
  - **Ethereum:** the light client.
  - **Other EVM chains and Bitcoin:** multi-RPC agreement at the configured confirmations.
- **Disagreement** puts the deposit in `UNCONFIRMED`. It never proceeds on a single source.
- **Required confirmations** come per chain from config, labeled (illustrative defaults: Solana finalized, Ethereum 12 blocks, Bitcoin 3).

## 3. Classify

These are policy checks, in order. The first failure decides the deposit's state.

1. **Allowlisted token** (by mint or contract address, never by name or symbol), or else `QUARANTINED`. Unknown tokens are never swapped, never approved and never interacted with. This defends against scam airdrops and malicious token contracts.
2. **Above the minimum** (`minUsd`, per token), or else `DUST`: held, with no gas spent.
3. **Sanctions screen** on the sender, when screening is enabled. A hit puts the deposit in `FROZEN`, and alerts a human. It is never auto-returned.
4. **Not a duplicate** `(chain, txid, index)`, or else ignored.
5. **Within the daily caps:** per token, per chain and in total. Over a cap, the deposit waits in `HOLD` for the next window or a human.

## 4. Quote

- **Venues** are adapters behind the existing `Banker` venue interface (`quote`, `swap`):
  - **Solana:** Jupiter.
  - **EVM:** one or more DEX aggregators.
  - **Cross-chain:** an intent or bridge service, only when the target token lives on another chain.
  - **Every venue is approved by id in config.**
- **Quote from at least two venues** and take the best, net of fees and gas.
- **Price sanity.** Compare the best quote with an independent reference price, from a price feed or a second venue's mid. Reject if the deviation exceeds `maxDeviation` (illustrative default 2%). This catches manipulated pools.
- **Slippage cap.** Set `maxSlippage` per pair (illustrative default 1%). Large swaps are split into slices, each under `maxSliceUsd`.

## 5. Simulate, then swap

- **Simulate first.** Dry-run the exact transaction against current state, through the Solana simulate API or an EVM `eth_call` or trace. If it fails, or the simulated output is below the quote minus slippage, don't send.
- **Sign through a scoped key** from the keyblock. Its scope covers only these venue programs or contracts, the treasury destination, and the per-transaction cap.
- **MEV protection.** On EVM, use private transaction submission where available. On Solana, set tight slippage and a priority fee within the gas budget.
- **Approvals.** Exact-amount token approvals only, never unlimited. Revoke after each swap where the chain charges for approvals.
- **Failures.** Retry with backoff up to `maxAttempts`, then `NEEDS_HUMAN`. Funds stay where they are; no partial states are left unrecorded.

## 6. Gas

- **A gas reserve per chain,** in the native coin, with a floor and a top-up target. Top-ups come from the treasury or from swap proceeds.
- **Ordering.** On EVM, a deposit with no native coin is swept by the Banker paying gas from the reserve. That gas is charged to the deposit's ledger entry.
- **Running low** below the floor pauses non-urgent sweeps and alerts a human.
- **Relayers and paymasters** are optional adapters for later.

## 7. Sweep and pay

- **Converted funds** go to the **treasury wallet** (cold or multisig), or to the **payment wallet** up to its working balance.
- **Payments.** The existing `PaymentWallet` and `Banker.pay` handle paying outward to allowlisted payees (AI APIs, GPU hosts). `Banker.ensure` converts just enough when a payee needs a token the wallet doesn't hold.
- **The bond reserve** is excluded from every balance the Banker can spend.

## 8. Ledger and receipts

- **Every state change** is appended to `.verafy/banker/ledger.jsonl`, hashed in a chain like everything else. Never edited.
- **Per deposit:** sender, chain, txid, token, amount, received time, reference price, and the swap details (venue, quote, executed out, fees, gas). It also records the destination, the final state, and the policy rule that allowed each step.
- **Cost basis.** Record the fair value at receipt and at conversion, for tax lots. Export to CSV.
- **Receipts.** The payer can fetch a signed receipt by txid.

## 9. Kill switch and limits

- **One command** (`verafy banker pause`) and one keyblock action (revoking the Banker's scoped keys) stop every outbound transaction at once.
- **Hard caps that config can't exceed** without a keyblock re-issue: per transaction, per day, and in total.
- **Approval above a threshold.** A swap above `approvalAbove` waits for a human signature (already in `PaymentWallet`).

## 10. Modes

| Mode | Who sends funds | What changes |
|---|---|---|
| `own` (default) | People paying you or your harness | No customer accounts. Screening optional but recommended. |
| `service` | Other people's money, converted on their behalf | **Disabled in code** until Rex enables it after legal review. It likely needs money-transmitter registration, KYC and mandatory screening. The spec only reserves the flag. |

## Interfaces (extend what exists)

| Exists | Add |
|---|---|
| `Banker` (`accepts`, `receive`, `quote`, `swap`, `ensure`, `pay`) | `BankerService`: the deposit state machine, watchers, policies, ledger, kill switch |
| `fixedRateVenue` | `jupiterVenue`, `evmAggregatorVenue`, `bridgeVenue` in `packages/banker-solana` and `packages/banker-evm` |
| `Keyblock` scoped keys | Scope templates for each venue and destination |
| `PaymentWallet` caps and `bondReserve` | Per-chain gas reserves; the treasury destination |
| Light client (master spec Part F) | Deposit watchers built on it |

**Config:** a `banker` section in `verafy.config.json`. It covers chains, addresses, the token allowlist by address, minimums, venues, slippage, deviation, caps, gas reserves, the treasury, screening, mode, and the confirmation counts.

## Tests

**Unit, with mock chains and mock venues:**
- Happy path: deposit, swap, sweep, ledger.
- Unknown token: quarantined, no interaction.
- Dust: held, no gas spent.
- Duplicate txid: one swap.
- Restart mid-swap: no double swap.
- Venue quote 10% off the reference: rejected.
- Simulation fails: not sent.
- Over the daily cap: `HOLD`.
- Bond never touched.
- Kill switch blocks every outbound transaction.
- Approvals exact and revoked.
- Ledger hash chain verifies.

**Property test:** across random deposits, total value in = swapped out + fees + gas + held, to the smallest unit.

**Devnet:** a Solana devnet deposit of a test SPL token, swapped by a test venue and swept, with the run recorded. An EVM testnet (Sepolia or Base Sepolia) equivalent.

**Report** measured gas, fees and latency per chain, labeled with the date.

## Milestones

1. The `BankerService` state machine, ledger and policies, with mock chains (no network).
2. Solana devnet: watcher, Jupiter adapter or a devnet venue, sweep.
3. EVM testnet: watcher, aggregator adapter, gas reserve.
4. The receive front end and receipts.
5. The Banker advisor (read-only reports and anomaly flags).
6. Mainnet `own` mode with small caps, after Rex says go.
7. Bitcoin and cross-chain targets, later.

## Decisions for Rex

- **Target token and treasury:** for example, USDC on Solana, to a multisig.
- **Chains and tokens on the allowlist at launch.**
- **Caps for mainnet** `own` mode.
- **Screening:** whether to enable sanctions screening from day one (recommended).
- **Service mode:** whether to ever enable it, which needs legal review first.
