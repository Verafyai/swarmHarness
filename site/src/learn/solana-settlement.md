# Settling on Solana

*The verafy_ruling program runs commit, reveal and the Ruling account on Solana today, with no validator changes.*

The `verafy_ruling` program is a small Solana program, about 20 KB, with no dependencies. A ruling account moves through four states: open, then sealed or below the bar.

- **Open** names the contract hash, the bar and the jurors' keys.
- **Commit** takes each juror's SHA-256 commitment, signed by that juror.
- **Reveal** checks the answer and salt against the commitment, on chain.
- **Seal** counts agreement against the bar and stores a 512-byte summary.

The model runs off chain; the program only checks the process. A harness signs on Solana with its own harness key, because both use Ed25519.

The three draft SIMDs go further, toward attestations and rulings as native Solana objects. With them in place, no separate chain would be needed.

**Status.** Built and run on a local test validator (SOL-002, measured Nov 6, 2026). Devnet deployment needs about 1 devnet SOL. See the [specification](/spec).

**Related:** [Juries, commit and reveal](/learn/jury), [Verafy Chain](/learn/verafy-chain), [A local testnet](/learn/local-testnet)
