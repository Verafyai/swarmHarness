# Coin Agnostic

**Swarm Chain has no token, and it doesn't need one.** It runs on whatever asset people want to put into it. You can pay for a ruling, and be paid for judging one, in USDC, SOL, ETH or any other asset on any chain with smart contracts, from any wallet.

That is deliberate. The goal is something useful regardless of which crypto you hold, and a new coin would only get in the way of that.

> **The policy in one line:** no token, no presale, no airdrop, no points, no foundation, no UAE entity, no BVI company hidden somewhere. It is just a project. Come test it.

## Contents

- [Why there is no coin](#why-there-is-no-coin)
- [What the money pays for](#what-the-money-pays-for)
- [Harnesses that pay their own bills](#harnesses-that-pay-their-own-bills)
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

## Harnesses that pay their own bills

A harness earns in whatever assets its contracts pay in. Its bills are in whatever its suppliers charge: model API credits, GPU hours, a cloud server, bandwidth, storage. Because there is no coin to bridge the two, each harness carries an **operations agent** that does it automatically.

1. **Earn.** Shares arrive in the contract's asset: USDC on Solana, ETH on Ethereum, and so on.
2. **Reserve.** The agent first keeps the bond topped up and holds back a reserve the operator sets.
3. **Exchange.** It swaps the rest into what the bills need, such as USDC, on venues the operator has approved.
4. **Pay.** It pays the harness's own running costs: model credits at providers that take crypto, the GPU or cloud host, storage and bandwidth. Where a supplier only takes cards or bank transfers, it routes through an off-ramp the operator has set up.
5. **Report.** Every swap and payment is logged next to the votes that earned it, so the operator can see what each ruling cost and paid.

The effect is a validator that runs itself: it earns from rulings, pays for the AI and the machine that produced them, and keeps the bond in place, without anyone converting anything by hand and without a native token in the middle.

The operator stays in charge through limits in the harness config:

```json
{
  "operations": {
    "agent": "auto",
    "reserve": { "bond": "100%", "cash": "10%" },
    "swapTo": { "asset": "USDC", "venues": ["<approved venue>"], "maxSlippage": 0.005 },
    "bills": [
      { "payee": "model provider", "asset": "USDC", "monthlyCap": 50 },
      { "payee": "GPU or cloud host", "asset": "USDC", "monthlyCap": 400 }
    ],
    "approvalAbove": 100
  }
}
```

| Guardrail | What it does |
|---|---|
| Allowlisted payees | The agent can only pay the suppliers the operator listed |
| Caps | Monthly limits per bill; anything above `approvalAbove` waits for the operator |
| Approved venues and slippage | Swaps happen only where the operator allows, within a price limit |
| Bond first | The bond is never spent to pay a bill |
| Full log | Every swap and payment is recorded and attributable to the rulings that funded it |

**Status: planned.** The prototype records payouts with the `ledger` router and does not swap or pay anything. The operations agent is on the [roadmap](../ROADMAP.md) after the on-chain payment routers.

## How money moves

Money never moves to Swarm Chain. It stays on the chain where the requester holds it.

1. **Fund.** The requester locks escrow in a program or contract on their own chain: USDC in a Solana program, ETH in an Ethereum contract. The escrow names the Actually Smart Contract by its hash.
2. **Rule.** Swarm Chain draws a jury of harnesses, who commit and reveal their votes. The ruling and its payout diff are sealed into a block.
3. **Release.** A trigger signed by a quorum of harnesses tells the escrow on the source chain to pay out: to the winning side of a market, to a claimant, back to the requester on a refund, and to the harnesses whose votes were counted. Everything is paid in the same asset that was put in.

Swarm Chain itself only records decisions. It has no balance of its own to protect. What a harness does with its share afterwards, including exchanging it to pay its own bills, is up to its [operations agent](#harnesses-that-pay-their-own-bills).

## The payment router

Every harness plugs in a **payment router**. The router decides which payments the harness accepts and where its share is sent. Set it in the harness config:

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
