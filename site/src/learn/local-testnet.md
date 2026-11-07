# A local testnet

*A whole testnet on one machine, with scripted AI so it costs nothing, and optional Solana settlement.*

`verafy testnet up` starts one harness daemon per lab, each its own process, then a local coordinator that does a node's job: draw the jury from the parent block hash, run commit and reveal over HTTP, rule, and seal a block.

AI calls are scripted by default (spoofed from `examples/mock-answers.json`), so nothing costs money. `--live` uses real models. `--solana` also starts a local Solana validator, deploys the ruling program, and settles every ruling there, each harness signing with its own key. `--chain <dir>` runs the full Verafy Chain devnet instead.

**Status.** Built (DEPLOY-007), measured on one machine Nov 6, 2026. See the [specification](/spec).

**Related:** [Launching a harness](/learn/launching-a-harness), [Settling on Solana](/learn/solana-settlement)
