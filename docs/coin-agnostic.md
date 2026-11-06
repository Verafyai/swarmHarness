# Coin Agnostic

**Swarm Chain has no token, and it doesn't need one.** It runs on whatever asset people want to put into it. You can pay for a ruling, and be paid for judging one, in USDC, SOL, ETH or any other asset on any chain with smart contracts, from any wallet.

That is deliberate. The goal is something useful regardless of which crypto you hold, and a new coin would only get in the way of that.

> **The policy in one line:** no token, no presale, no airdrop, no points, no foundation, no UAE entity, no BVI company hidden somewhere. It is just a project. Come test it.

## Contents

- [Why there is no coin](#why-there-is-no-coin)
- [What the money pays for](#what-the-money-pays-for)
- [The routing agent](#the-routing-agent)
- [How money moves](#how-money-moves)
- [The payment router](#the-payment-router)
- [What you can pay and be paid in](#what-you-can-pay-and-be-paid-in)
- [Bonds without a coin](#bonds-without-a-coin)
- [What we will never do](#what-we-will-never-do)
- [What this costs us](#what-this-costs-us)
- [Questions](#questions)

## Why there is no coin

A blockchain usually needs a token for three jobs: paying for work, securing the network through staking, and rewarding early participants. Swarm Chain does each without one.

| Job | Usual answer | Swarm Chain |
|---|---|---|
| Paying for work | Gas in the native token | The requester pays in their own asset, in escrow on their own chain |
| Rewarding validators | Block rewards in newly minted tokens | A share of each ruling's escrow, in the asset the contract was paid in |
| Security | Stake in the native token, slashed for faults | Bonds in the asset each harness earns in, slashed for proven faults |
| Rewarding early people | Allocations, airdrops, points | None. The reward is a useful tool, and the code is MIT licensed. |

A token would add a price to speculate on, a treasury to manage, and a reason to build the network around the coin instead of around the rulings. Without one, the only way the network is worth anything is if people find the rulings worth paying for.

This is also being built without venture capital, so the idea has to stand on its own. If it works, other people will copy it, and they are welcome to.

## What the money pays for

There is no coin to pay for anything, so every ruling pays its own way. The escrow a requester puts in covers the real work of producing a decision, and nothing else.

| Work | Who does it | What it costs them | Paid from |
|---|---|---|---|
| **Inference** | Jurors: each one runs its committed AI model on the contract's instructions, context and question | Model tokens, either per call to a provider or GPU time on their own hardware | `split.jurors`, shared across counted votes |
| **Running the harness** | Jurors | The machine, the network, uptime, keeping the model pinned and the endpoint healthy, and the capital locked in the bond | The same juror share |
| **Audits** | Auditors: they re-run a sample of sealed rulings with a different lab's model | More inference, on rulings they didn't sit on | `split.auditors`, plus the bond of any juror they catch |
| **Keeping the words available** | Storage harnesses: they serve every prompt, context file and piece of evidence by hash for as long as a ruling can be challenged | Disk and bandwidth | `split.storage` |
| **Bookkeeping** | Sealers and nodes: they collect reveals, check quorum, signatures and diffs, seal blocks and keep the chain | CPU, disk and bandwidth | `split.sealer` |
| **Settlement** | Whoever submits the quorum-signed trigger on the source chain | That chain's own transaction fee, in its own asset | Covered by the sealer share in the current design |

The requester sets the split in the contract. The examples use 80 percent to jurors, 10 to auditors, 5 to storage and 5 to the sealer. A ruling below the bar pays none of this yet; its escrow carries over to fund the larger jury.

### A worked example

The market-resolution example escrows **1.20 USDC** for a jury of five. **Illustrative** split, using the example's numbers:

| Share | Amount | Pays for |
|---|---|---|
| Jurors, 80 percent | 0.96 USDC, or 0.192 per counted vote | Five model runs and five harnesses' operating costs |
| Auditors, 10 percent | 0.12 USDC | Re-running a sample of rulings |
| Storage, 5 percent | 0.06 USDC | Serving the context through the challenge window |
| Sealer, 5 percent | 0.06 USDC | Sealing, bookkeeping and settlement fees |

For scale, the **measured** model cost of a five-model ruling on Nov 6, 2026 was about **$0.003**, or about $0.0007 per vote ([results](../results/live-2026-11-06.md)). So in this example inference is a small part of what a juror's share covers; the rest pays for the machine, the bond and the operator's time. Real escrow amounts will be set by requesters and by competition between harnesses, and will likely be much lower than this example.

## The routing agent

Every harness carries a **routing agent**: an API router with its own **payment wallet**. It is the part of the harness that deals with money and suppliers, so the AI can stay focused on judging. Earnings land in the wallet, and the router pays for the AI calls, the hosting and everything else the harness uses out of that wallet, automatically. It does four jobs.

![Block diagram: the routing agent inside the harness, with its payment wallet, inference router and hosting and bills, taking payments in any asset and paying AI APIs, provers and cloud hosts](assets/harness-diagram.png)

| Job | What the routing agent does |
|---|---|
| **Payments in** | Accepts payment in any asset on any chain the operator allows, and converts between them: USDC, SOL, ETH or any token, swapped on venues the operator approves. This is the payment router. |
| **Inference routing** | Connects to AI APIs and to models the operator hosts, and sends each contract to a route that meets the contract's provability requirement. A contract that demands a zero-knowledge proof of inference only goes to a route that can produce one. |
| **Hosting** | Connects to cloud backends to rent and pay for what the harness runs on: GPU servers for open-weights or proving routes, a small VM for an API harness, storage and bandwidth. |
| **Bills** | Pays the harness's own running costs from what it earns: model API credits, GPU or cloud hosting, storage. It keeps the bond topped up first, holds a reserve, and uses an off-ramp where a supplier only takes cards or bank transfers. |

The effect is a validator that runs itself: it takes payment in whatever the requester holds, buys exactly the inference the contract asks for, pays for the machine it runs on, and keeps its bond in place, with no native coin in the middle.

### The payment wallet

The wallet is how the harness pays its own way.

1. **In.** Each ruling's share for this harness arrives in the wallet, in the contract's asset, on the contract's chain.
2. **Hold.** The wallet keeps the bond reserve untouched and a cash reserve the operator sets.
3. **Convert.** When a bill is due in a different asset, the router converts on an approved venue within a slippage limit.
4. **Out.** The router pays each supplier as the harness uses it: the AI API for every model call, the cloud backend for the GPU or VM, storage and bandwidth. Payees must be on the operator's allowlist, each with a monthly cap, and anything above the approval threshold waits for the operator.
5. **Log.** Every receipt, conversion and payment is recorded against the ruling that funded it, so the operator sees what each ruling earned and cost.

The wallet's key is separate from the harness's identity key: the identity key signs votes, the wallet key moves money, and a stolen identity key can't spend. In the prototype, `PaymentWallet` in `packages/core/src/routing.js` enforces the allowlist, caps, approval threshold and bond reserve on a ledger; signing real transactions comes with the chain-specific routers.

### Provability comes first

The routing agent never trades provability for price. Each contract sets the minimum assurance for the AI that rules on it, in `payment.jury.assurance`, and the agent picks the cheapest route that meets it, or refuses the seat.

| Level | What the route must offer | Example routes |
|---|---|---|
| **L0, L1** | Any model; the jury supplies lab diversity and commit-reveal | Hosted APIs: Claude, GPT, Gemini, through a provider or a router |
| **L1+** | Re-executable by auditors: open weights at temperature 0 on a pinned runtime, or a hardware attestation of what ran | `gpt-oss-120b` or Qwen3 on a GPU the agent rents, pinned by weights hash and container digest |
| **L2** | A zero-knowledge proof of inference per vote, checked off chain by auditors | Today only Llama 4 Maverick, through research proving systems such as FlashProve, on a GPU host with large memory |

A hosted API can't prove which model it served, so it tops out at L1. When a contract asks for L2, the routing agent has to rent a proving-capable GPU and run an open model itself, or decline. That is available in the prototype today as `routeInference()` in `packages/core/src/routing.js`, which picks the cheapest qualifying route and refuses when none qualifies.

### Configuration

The operator stays in charge through limits in the harness config. The routing section is **planned**; `payments` already works with the `ledger` router.

```json
{
  "routing": {
    "inference": [
      { "id": "hosted-haiku", "kind": "hosted", "provider": "openrouter", "model": "anthropic/claude-haiku-4.5", "usdPerVote": 0.003 },
      { "id": "local-gptoss", "kind": "open-weights", "model": "openai/gpt-oss-120b", "host": "gpu-1", "usdPerVote": 0.001 },
      { "id": "proving-maverick", "kind": "open-weights", "model": "meta-llama/llama-4-maverick", "proofs": true, "host": "gpu-proving", "usdPerVote": 0.03 }
    ],
    "hosting": [
      { "id": "gpu-1", "backend": "<cloud provider>", "gpu": "1x80GB", "monthlyCap": 2000 },
      { "id": "gpu-proving", "backend": "<cloud provider>", "gpu": "1x80GB", "hostRamGB": 290, "onDemand": true }
    ],
    "convert": { "to": "USDC", "venues": ["<approved venue>"], "maxSlippage": 0.005 },
    "bills": [{ "payee": "openrouter", "asset": "USDC", "monthlyCap": 50 }],
    "reserve": { "bond": "100%", "cash": "10%" },
    "approvalAbove": 100
  },
  "payments": { "router": "solana-usdc", "accept": [{ "chain": "*", "asset": "*" }] }
}
```

| Guardrail | What it does |
|---|---|
| Provability floor | A route below the contract's required level is never used, however cheap |
| Allowlisted payees and backends | The agent only pays, and only rents from, suppliers the operator listed |
| Caps | Monthly limits per bill and per host; anything above `approvalAbove` waits for the operator |
| Approved venues and slippage | Conversions happen only where the operator allows, within a price limit |
| Bond first | The bond is never spent to pay a bill |
| Full log | Every conversion, rental and payment is recorded against the ruling that funded it |

**Status.** Inference routing by assurance level, and the payment wallet's spending rules, work in the core today. Accepting and converting payments on chain, renting hosts and paying bills are **planned**, after the on-chain payment routers; see the [roadmap](../ROADMAP.md).

## How money moves

Money never moves to Swarm Chain. It stays on the chain where the requester holds it.

1. **Fund.** The requester locks escrow in a program or contract on their own chain: USDC in a Solana program, ETH in an Ethereum contract. The escrow names the Actually Smart Contract by its hash.
2. **Rule.** Swarm Chain draws a jury of harnesses, who commit and reveal their votes. The ruling and its payout diff are sealed into a block.
3. **Release.** A trigger signed by a quorum of harnesses tells the escrow on the source chain to pay out: to the winning side of a market, to a claimant, back to the requester on a refund, and to the harnesses whose votes were counted. Everything is paid in the same asset that was put in.

Swarm Chain itself only records decisions. It has no balance of its own to protect. What a harness does with its share afterwards, including converting it to pay its own bills, is up to its [routing agent](#the-routing-agent).

## The payment router

The payment router is the payments-in part of the [routing agent](#the-routing-agent). Every harness plugs one in. The router decides which payments the harness accepts and where its share is sent. Set it in the harness config:

```json
{
  "payments": {
    "router": "solana-usdc",
    "accept": [{ "chain": "solana", "asset": "USDC" }],
    "book": { "harness:my-harness": { "solana": "<your Solana address>" } }
  }
}
```

- `router` picks how settlement happens. `ledger` (available now) records every payout to a local file and moves nothing. `solana-usdc` and `evm` (planned) release escrow on Solana and on Ethereum or other EVM chains.
- `accept` lists the chains and assets the harness will take jury seats for. `*` means anything. A harness refuses contracts that pay in anything else, so it is never owed an asset it can't receive.
- `book` is the payout book: one address per chain for each harness you run.

Want to be paid only in USDC on Solana? List only that. Want anything at all? Use `*`. Swapping routers is a config change; nothing else in the harness changes.

## What you can pay and be paid in

| Chain | Assets | Status |
|---|---|---|
| Any, locally | Any label | **Available now** with the `ledger` router: payouts are recorded, nothing moves |
| Solana | SOL, USDC, any SPL token | **Planned** (`solana-usdc` router), Solana devnet first |
| Ethereum and EVM chains | ETH, any ERC-20 | **Planned** (`evm` router) |
| Bitcoin | Wrapped BTC on a chain with contracts | Through those chains' routers. Native Bitcoin has no contracts to hold escrow, so it is not planned. |

A contract states its asset and chain in `payment.currency` and `payment.chain`. Jurors, auditors, storage and the sealer are paid their shares in that asset.

## Bonds without a coin

A harness posts a bond so that cheating costs it something. With no native token, bonds are posted on the chain a harness earns on, in an asset it accepts. A contract sets the minimum bond per vote in its own asset, and a harness takes seats only where its bond covers that.

Two things are harder without a coin, and they are open problems rather than solved ones:

- **Comparing bonds across assets.** A bond in SOL and a bond in USDC are not directly comparable. Testnet avoids this by pricing bonds per contract, in that contract's own asset.
- **Weighting nodes for ledger consensus.** Many chains weight nodes by staked native tokens. Testnet uses a fixed, permissioned set of nodes instead. How to open that up without a coin is still being worked out.

## What we will never do

- Launch a Swarm token, coin, points program, presale or airdrop.
- Mint any asset from a Swarm contract or config.
- Set up a foundation, a UAE entity, a BVI company, or any other entity to hold a treasury.
- Charge a protocol fee on top of what juries earn.
- Describe testnet participation as earning anything that converts into a future token.

If you see any of these attached to the name Swarm Chain, it isn't us.

## What this costs us

Being coin agnostic has real costs:

- No treasury to pay for development, audits or seed nodes. It's built by whoever finds it useful.
- No staking token to lean on for ledger consensus. See above.
- Every chain we support needs its own escrow program and router, and its own audit.
- Payouts are only as fast and cheap as the chain they settle on.

We think these are worth it, because the alternative is a network that exists to support a coin.

## Questions

**How do harness operators make money?**
From each ruling they sit on: a share of that ruling's escrow, paid in the contract's asset. Auditors also earn the bond of any juror they catch cheating. There are no block rewards. On testnet everything is play money. See [What it earns](run-a-harness.md#15-what-it-earns).

**Why would anyone run a harness without a token to speculate on?**
Because rulings pay. If nobody pays for rulings, the network shouldn't exist, and a token wouldn't change that.

**Can I pay in a stablecoin and be paid in SOL?**
Not directly. A contract pays out in the asset it was funded in. A harness that wants SOL accepts SOL contracts, or swaps on its own.

**Is there a fee to Verafy or anyone else?**
No. The escrow split goes to jurors, auditors, storage and the sealer, and nobody else.

**Will there be a token later?**
No.
