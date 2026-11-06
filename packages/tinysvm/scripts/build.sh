#!/usr/bin/env bash
# Build TinySVM: the sBPF programs, their lock file, and the engine sidecar.
#
#   scripts/build.sh            build everything and check the program hashes
#                               against programs.lock.json
#   scripts/build.sh --relock   build, then rewrite programs.lock.json
#
# Needs: cargo (rustup), and cargo-build-sbf from the Solana CLI (the Agave
# release, which downloads its platform tools into ~/.cache/solana on first use).
# Nothing here needs an account or sudo.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"

command -v cargo >/dev/null || { echo "tinysvm: cargo not found (install rustup)"; exit 1; }
command -v cargo-build-sbf >/dev/null || { echo "tinysvm: cargo-build-sbf not found (install the Solana CLI)"; exit 1; }

echo "tinysvm: building programs with $(cargo-build-sbf --version | tr '\n' ' ')"
(cd programs && cargo-build-sbf --sbf-out-dir target/deploy 2>&1 | grep -E '^(error|warning: unused)|Finished' || true)
for p in escrow bond ledger graded_payout ranked_split milestone_escrow; do
  test -f "programs/target/deploy/$p.so" || { echo "tinysvm: programs/target/deploy/$p.so was not built"; exit 1; }
done

if [ "${1:-}" = "--relock" ]; then node scripts/lock.mjs --write; else node scripts/lock.mjs --check; fi

echo "tinysvm: building the engine"
(cd engine && cargo build --release --locked 2>&1 | grep -E '^error|Finished' || true)
test -x engine/target/release/tinysvm || { echo "tinysvm: the engine did not build"; exit 1; }
echo "tinysvm: built engine/target/release/tinysvm"
