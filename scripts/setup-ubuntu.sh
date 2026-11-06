#!/usr/bin/env bash
# Set up a Verafy Harness on Ubuntu 22.04 or 24.04.
#   API harness (no GPU):        bash scripts/setup-ubuntu.sh
#   Open-weights harness (GPU):  bash scripts/setup-ubuntu.sh --gpu
# Prototype. Read it before running it; it uses sudo for apt.
set -euo pipefail

GPU=0
[[ "${1:-}" == "--gpu" ]] && GPU=1

echo "== system packages"
sudo apt-get update -y
sudo apt-get install -y git curl ca-certificates jq

echo "== Node 22 (nvm, per user)"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
  nvm install 22
fi
node --version

echo "== Verafy Harness"
if [[ ! -d "$HOME/verafyHarness" ]]; then
  git clone https://github.com/Verafyai/verafyHarness.git "$HOME/verafyHarness"
fi
cd "$HOME/verafyHarness"
npm test
npm run demo

if [[ "$GPU" == 1 ]]; then
  echo "== GPU checks"
  nvidia-smi || { echo "nvidia-smi failed: install the NVIDIA driver first"; exit 1; }
  if ! command -v docker >/dev/null; then
    echo "Docker is required for the vLLM server. Install Docker and the NVIDIA Container Toolkit, then run scripts/run-vllm.sh"
  fi
fi

cat <<'DONE'

Setup finished.
  API harness:   export VERAFY_API_KEY=...   then   node bin/verafy.js doctor --live
  GPU harness:   bash scripts/run-vllm.sh   then   node bin/verafy.js doctor --live --config verafy.config.local.json
DONE
