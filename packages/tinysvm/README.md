# TinySVM: exact settlement next to the AI

The AI judges, and TinySVM settles. TinySVM decides nothing. It executes the exit the jury chose, with exact arithmetic, and every node can re-run it.

This is phase 1, the prototype: [LiteSVM](https://github.com/LiteSVM/litesvm) 0.18.2 wrapped as a settlement engine, behind the same runtime interface as `jsRuntime` in `packages/core/src/settle.js`. It is optional. With it missing, `runtime.js` runs alone and nothing changes. It is **not** the default runtime: that needs Rex (Part E5 of the spec).

## Status

| Part | Status |
|---|---|
| sBPF programs `escrow`, `bond`, `ledger` and the exit programs `graded_payout`, `ranked_split`, `milestone_escrow` | Built with `cargo-build-sbf`; hashes pinned in `programs.lock.json` |
| Engine sidecar: LiteSVM, restricted to those programs, JSON lines over stdio | Built (`engine/`) |
| `exitProgram` in the contract format, params bounds, settlement (`packages/core`) | Built; runs with runtime.js alone |
| Both runtimes side by side; disagreement is a fault (`dualRuntime`) | Built and tested |
| Property test: random in-bounds rulings give identical results | Passes when the engine is built (see below) |
| WebAssembly build | Not possible with LiteSVM 0.18.2 (see below) |
| TinySVM as the default runtime | Planned; needs Rex |
| Phase 2: Anza's `solana-svm` crate, nodes re-running settlement on block verification | Planned |

## Build

```
packages/tinysvm/scripts/build.sh          # programs, hash check, engine
packages/tinysvm/scripts/build.sh --relock # after changing a program
```

Needs `cargo` (rustup) and `cargo-build-sbf` from the Solana CLI. Neither needs an account or sudo. The first `cargo-build-sbf` run downloads its platform tools into `~/.cache/solana`. Binaries and `target/` are ignored by git; only their hashes are committed.

Built and checked on Nov 6, 2026 with: Solana CLI 1.18.8 (cargo-build-sbf 1.18.8, platform tools v1.41, rustc 1.75.0) for the programs; rustc 1.98.1 for the engine. A rebuild of the programs from a copy of the sources at another path reproduced all six hashes in `programs.lock.json` (measured, Nov 6, 2026, same machine and toolchain).

## Why a sidecar and not WebAssembly

The spec prefers WebAssembly. LiteSVM 0.18.2 does not compile to `wasm32-unknown-unknown`. Measured with `cargo check --target wasm32-unknown-unknown` on Nov 6, 2026:

1. `getrandom` 0.2, 0.3 and 0.4 refuse the target until a JavaScript backend is chosen. That can be forced.
2. Then `blst` 0.3.17 fails: it is C code, pulled in by `solana-bls-signatures` (through `solana-vote-program`, a LiteSVM built-in) and by `solana-bls12-381-syscall`. Both are unconditional LiteSVM dependencies, and building them needs a C compiler that targets wasm32. Apple clang has no wasm32 target.

Getting past that means installing a wasm-capable LLVM system-wide, and the VM may hit further problems after it. So the engine is a Rust binary that speaks JSON lines over stdio, which the spec allows. Phase 2 (`solana-svm`) should be checked for WebAssembly again.

## Kept and cut

TinySVM trims by restricting, never by deleting code from LiteSVM or Agave.

- **Kept:** the sBPF VM; a minimal account model (owner and data; balances in existing tokens live in account data, never in lamports); logging; the SHA-256 syscall (available, unused so far); cross-program calls, but only to allowlisted programs (the engine checks every inner instruction). The programs make no cross-program calls today.
- **Not yet wired:** Ed25519 verification. On Solana it is a precompile, and LiteSVM's `precompiles` feature is off in this build; no program needs it yet.
- **Restricted:** only the programs in `programs.lock.json` load, each checked against its SHA-256 first. Built-ins may always run; an exit program runs only when the request's allowlist names its hash, which is the hash the contract declared. A program's address is its hash. Any cross-program call outside the allowlist fails the request. A compute cap applies per request (default 200,000 units).
- **Never enabled:** SPL programs, signature and blockhash checks, gossip, voting, a leader schedule, an RPC. LiteSVM still carries its built-in programs (including stake and vote) inside the process, but no request can reach them: every instruction's program is checked against the allowlist before the transaction is built.
- **Neutralized:** fees and rent. The engine's own payer covers LiteSVM's signature fee and every account is funded to rent exemption. Those lamports are bookkeeping inside the engine; no settlement touches them.

## Programs

All seven crates in `programs/` have no dependencies. `abi` reads the loader's input buffer and writes little-endian values; each program is a few dozen lines of integer math with checked overflow.

| Program | What it does |
|---|---|
| `escrow` | The jury pay rule runtime.js runs in `buildDiff`; hold and release a pot against an exit's transfer list |
| `bond` | Lock, release, slash. A slash or release can never exceed what is locked. There is no spend instruction |
| `ledger` | Balances per account and token key. A diff must sum to exactly zero; no balance goes below zero |
| `graded_payout` | Insurance by grade: coverage times percent, from a reserve that persists across claims |
| `ranked_split` | A prize split by the jury's ranking, in parts per million; rounding dust goes to first place |
| `milestone_escrow` | One tranche per ruling that a milestone was met; each milestone releases once |

Errors are small integers, the same in both runtimes, so a rejection is compared exactly like a success.

### The jury pay rule is IEEE-754, on purpose

runtime.js splits a ruling's escrow in doubles, rounding each share to 1e-6 with `Math.round`. An exact-integer split (micro-units, round half up) disagrees with it on **963 of 200,000** random rulings shaped like real contracts (0.48%, measured Nov 6, 2026, `node packages/tinysvm/scripts/integer-split.mjs 200000 20261106`). Disagreement is a fault, so `escrow` reproduces runtime.js's double arithmetic bit for bit (soft-float in sBPF), converts every delta to integer micro-units, and checks that they sum to exactly zero. The exit programs, bonds and the ledger are integer only.

Moving runtime.js to integer micro-units would change some future rulings' diffs by one micro-unit. That is a decision for Rex, and a precondition for an all-integer TinySVM.

## Measured cost

Nov 6, 2026, Apple M4, LiteSVM 0.18.2, release build, mean of 1,000 sequential requests each, including the JSON round trip through the sidecar (`node packages/tinysvm/scripts/measure.mjs`):

| Request | Compute units | Round trip |
|---|---|---|
| escrow jury split, 5 counted votes | 10,499 | 71 µs |
| graded_payout claim | 1,384 | 60 µs |
| ranked_split, 3 places of 5 | 2,449 | 61 µs |
| milestone_escrow release | 1,223 | 59 µs |
| bond slash | 669 | 40 µs |
| ledger apply, 2 transfers | 1,147 | 49 µs |

Engine start, loading and hash-checking all six programs: 8 ms (measured, same run). A second run gave the same compute units and round trips from 39 to 76 µs. The jury split costs more because sBPF has no floating point unit; the doubles run in software.

## Exits as programs

An exit may declare an optional `exitProgram`:

```json
{
  "outcome": "PAY",
  "effect": { "type": "record", "label": "paid by grade" },
  "exitProgram": {
    "programHash": "e449115b16b47e34cf0aec4250458108edab11f09b9861217d348eab4c51f0e4",
    "entry": "claim",
    "params": { "percent": { "type": "integer", "min": 0, "max": 100 } },
    "args": { "coverage": 5000000000, "reserve": 50000000000, "pot": "pot:hail-cover-2026", "beneficiary": "wallet:farm-117" }
  }
}
```

- The jury's ruling carries the params: each juror's vote may include `params`, checked against the bounds when the vote is parsed. The ruling takes the lower median of the integer params from the votes for the winning answer, or the most common ranking.
- `settle(asc, ruling, {state, runtime})` bounds-checks the params again, then runs the program. A ruling below the bar never reaches a paying exit, and the `*below-bar` exit cannot declare a program.
- State persists between rulings: `settle` returns the program's new state, and the next settlement starts from it.
- Contracts without `exitProgram` validate, hash and rule exactly as before (`packages/core/test/exitprogram.test.js` checks every existing example's hash against main).

Examples: `examples/graded-insurance.json`, `examples/ranked-prize.json`, `examples/milestone-escrow.json`. Their amounts and context are illustrative.

## Running both

```js
import { jsRuntime, settle } from '../core/src/index.js'
import { Engine, tinySvmRuntime, dualRuntime } from './src/index.js'

const engine = await Engine.start()
const both = dualRuntime(jsRuntime, tinySvmRuntime(engine))
const result = await settle(asc, ruling, { runtime: both }) // throws SettlementFault on any disagreement
engine.close()
```

## Tests

`npm test` at the repository root runs `test/tinysvm.test.js`. With the engine built it runs every check against both runtimes; without it, every engine test is reported as skipped with the reason. `TINYSVM_CASES` and `TINYSVM_SEED` set the property test's size and seed.

`cargo test` in `programs/` runs each program's logic natively.

## svmLLM: an optional third runtime (research, Part H)

[svmLLM](https://github.com/Verafyai/svmLLM) runs reduced-sBPF programs on hand-built transformer weights: every instruction is one forward pass through constant tensors, every activation is exactly 0 or 1, nothing is trained, and nothing drifts. Its settlement core (`svllm/settle.py` on the `settlement-core` branch) holds the integer settlement programs, written by hand in svmLLM's instruction subset, and `src/svmllm.js` runs it as a third runtime next to runtime.js and TinySVM. It is a demo. It decides nothing, and it is never the default runtime.

**Covered:** `graded_payout.claim`, `ranked_split.split`, `milestone_escrow.release`, `bond`, `ledger`. **Not covered:** the jury pay rule (`jury`) and escrow hold and release (`escrow`). The jury pay rule splits escrow in IEEE-754 doubles, which TinySVM reproduces bit for bit in soft-float; the svmLLM core is integer only, so `jury` and `escrow` stay two-runtime. The numbers and every decision run in the weights; which account key each delta belongs to is attached around the run, as TinySVM's `jury` does.

### Why hand-written, not the compiled programs

The compiled programs were traced on solana-sbpf 0.12.2 over 1,546 calls to the five integer programs (and 300 jury splits), encoded exactly as this package encodes them (svmLLM `results/settlement_subset.json`, measured Nov 6, 2026). The five integer programs execute 40 distinct opcodes, two of them outside svmLLM's subset (`be` and internal `call`), plus the `sol_memcpy_` and `sol_memset_` syscalls, and they need the loader's 10 KiB-per-account input buffer and 4 KiB stack frames. svmLLM has no calls, no syscalls and 1,024-byte windows here. So the settlement math was written again in 31 opcodes of svmLLM's subset (no ALU32, no calls), 288 instructions for all five programs. The cost of that choice: a second implementation that must be kept in step with `settle.js` by tests, not by construction.

### Run it

```
git clone -b settlement-core https://github.com/Verafyai/svmLLM ~/svmLLM && cd ~/svmLLM
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd <verafyHarness> && SVMLLM_HOME=~/svmLLM SVMLLM_PYTHON=~/svmLLM/.venv/bin/python npm test
SVMLLM_CASES=300 ...   # property test size (default 50 calls per program)
```

Without `SVMLLM_HOME`, the svmLLM tests are skipped with the reason and nothing else changes.

### Checks (Nov 6, 2026, Apple M4, 16 GB)

- `npm test` with svmLLM and TinySVM present: 172 tests, 172 pass. Without svmLLM: 168 pass, 4 skipped with the reason.
- Property test, three runtimes, seed 20261106, 300 calls per program (1,500 calls): faults 0 (`SVMLLM_CASES=300`).
- In svmLLM, `python run_settlement.py`: 1,547 calls (47 named edge cases, 300 random per program), weights machine equal to its reference interpreter, to Anza's solana-sbpf and to a transcription of `settle.js` on every one; full mode equal to lazy mode 20/20.

### Size and latency (measured Nov 6, 2026, Apple M4, 16 GB, one CPU thread, torch 2.15.0)

The settlement machine carries 690,256 constant parameters (2,761,024 bytes as float32), against 1,130,672 for svmLLM's general machine: it drops the 128-byte memory unit's shift tables and `xor`, and adds a 1,024-byte memory unit (98,464 parameters).

| Call | Steps | Weights, lazy | Weights, full | Reference interpreter |
|---|---|---|---|---|
| graded_payout, 43 percent | 40 | 179 ms | 2,153 ms | 0.030 ms |
| ranked_split, 3 places of 4 | 156 | 645 ms | 7,808 ms | 0.107 ms |
| milestone_escrow release | 27 | 67 ms | 1,070 ms | 0.022 ms |
| bond slash | 29 | 81 ms | 1,328 ms | 0.019 ms |
| ledger, one move | 88 | 189 ms | 3,740 ms | 0.060 ms |

Medians of 20 runs (lazy) and 4 (full). An earlier run the same day gave 169 ms lazy for graded_payout, so read these as plus or minus about 10%. Full mode evaluates every circuit each step, about 1.8 x 10^8 dense FLOPs per step (torch FlopCounterMode). TinySVM runs the same calls in 40 to 71 µs round trip (above).

### Proving one settlement

`node scripts/svmllm-proof.mjs --write` settles graded-insurance on all three runtimes, proves it with the mock prover from `packages/prove`, and models the cost of a real proof (`results/svmllm-settlement-2026-11-06.json`).

- **Mock:** ran. The proof verifies; a tampered answer and another commitment fail. The mock binds commitment, input and answer; it proves nothing about the computation.
- **DeepProve:** not run. Its license is not accepted; that is Rex's decision.
- **FlashProve:** not run. It needs Linux and an NVIDIA GPU, and it is built for a specific transformer architecture, not this network.
- **Modeled** with `packages/economics` (preset "L2, FlashProve, unpacked"), assuming proving cost scales with dense FLOPs: the judgment proof is 2 x 17B active parameters (Llama 4 Maverick, vendor-reported by Meta) x 1,024 tokens = 3.48 x 10^13 FLOPs at $0.0103 proving per request. A settlement is 0.014% to 0.080% of that for the measured calls ($1.4 x 10^-6 to $8.3 x 10^-6), and at most 0.32% at the worst step count in the suite (ranked_split, 624 steps). Verification and storage would not shrink with it.

**Success criterion: untested, so not met.** A settlement proof cheaper than the judgment proof is plausible on this model, but the model is an assumption: no prover that takes this network has been run. Until one has, svmLLM settlement stays a demo.
