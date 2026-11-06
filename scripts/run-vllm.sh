#!/usr/bin/env bash
# Serve an open-weights model on this machine for a Swarm Harness, through vLLM's
# OpenAI-compatible server on 127.0.0.1:8000. Needs Docker, the NVIDIA Container
# Toolkit, and enough GPU memory for the model (see docs/run-a-harness.md).
#
#   MODEL=openai/gpt-oss-120b bash scripts/run-vllm.sh      # one 80 GB GPU
#   MODEL=openai/gpt-oss-20b  bash scripts/run-vllm.sh      # one 16 GB+ GPU
#   MODEL=Qwen/Qwen3-235B-A22B-Instruct-2507-FP8 TP=4 bash scripts/run-vllm.sh
set -euo pipefail

MODEL="${MODEL:-openai/gpt-oss-120b}"
TP="${TP:-1}"                       # tensor parallel size = number of GPUs
VLLM_IMAGE="${VLLM_IMAGE:-vllm/vllm-openai:latest}"   # pin a digest for audits
: "${VLLM_API_KEY:=$(openssl rand -hex 16)}"
echo "VLLM_API_KEY=$VLLM_API_KEY   (export this in the harness shell)"

docker run --rm --gpus all --ipc=host -p 127.0.0.1:8000:8000 \
  -v "$HOME/.cache/huggingface:/root/.cache/huggingface" \
  -e HF_TOKEN="${HF_TOKEN:-}" \
  "$VLLM_IMAGE" \
  --model "$MODEL" \
  --tensor-parallel-size "$TP" \
  --api-key "$VLLM_API_KEY" \
  --generation-config vllm \
  --seed 0
