# Proving harness runbook (FlashProve, Llama 4 Maverick)

MASTER_SPEC Part D3, step 3. A runbook only: nothing here has been run for Verafy Harness, and nothing is rented. Rex decides when to rent the machine, and Rex accepts the licenses. Every figure below is labeled with its source; none is measured by us.

Sources, read Nov 6, 2026: github.com/anthropics/FlashProve at commit 9e2bdd8 (version 0.16.0, Apache 2.0, "a research artifact: not maintained"): `README.md`, `AGENTS.md`, `docs/quickstart.md` route 4, `examples/maverick/README.md` and `examples/maverick/figures.txt`. Follow the repo's own pages where they differ from this one; they are the authority.

## What you end with

One machine that proves the harness's L2 votes on Llama 4 Maverick, and a model commitment published on the harness card, so every node and auditor can check each proof with FlashProve's CPU verifier (`cp_verify`) through `packages/prove`.

## 0. Decisions for Rex, before anything is rented

1. **The Llama 4 license.** The weights FlashProve's route 4 downloads are a third party's 4-bit GGUF conversion (`unsloth/Llama-4-Maverick-17B-128E-Instruct-GGUF`) of Meta's `meta-llama/Llama-4-Maverick-17B-128E-Instruct`, under the Llama 4 Community License Agreement. The calibration set needs the Llama 2 and Llama 4 tokenizers, which open only after Meta grants an access request on huggingface.co, and each request includes accepting that model's license. Request both before renting: approval is not instant.
2. **Public weights.** Route 4 commits with `-public-weights` and a published seed, so the commitment hides nothing of the weights. That is right for public weights like these. It is the only way this runbook commits.
3. **When to rent**, and which offer (step 1).

## 1. The machine

| Part | Spec | Source |
|---|---|---|
| GPU | 1 x NVIDIA H100 80 GB, used by nothing else | FlashProve README, vendor-reported |
| CPU | x86-64 with the SHA extensions; 24 cores on the machine FlashProve measured | FlashProve README and `figures.txt`, vendor-reported |
| Host RAM | **330 GB available** to start the commit stage (peak seen 310 GB); 290 GB to start proving (peak seen 268 GB) | `examples/maverick/figures.txt`, vendor-reported. Note: MASTER_SPEC B7 says "about 290 GB or more"; that is the prove stage. The one-time commit needs 330 GB |
| Disk | 245 GB for the weights and work directories, local disk | FlashProve route 4, vendor-reported. 1 TB is a safe start (B7, modeled) |
| OS and toolchain | x86-64 Linux 4.14 or later (Ubuntu 24.04 is the documented base); CUDA 13.2 Update 2 (nvcc 13.2.86); gcc and g++ 13 first on PATH; binutils, flock, python3; for route 4 also curl and Python 3.13 with `requirements.txt` | FlashProve README and quickstart |
| Network | 1 Gbps; at 387 proofs an hour, about 7.1 GB of proof upload an hour | MASTER_SPEC B7, modeled |

**Renting note.** Many single-H100 instances have well under 330 GB of host RAM (one 2026 listing shows 116 GB). Meeting it may mean a larger multi-GPU node or bare metal, which raises the effective cost per proving GPU-hour unless every GPU on the node proves. Model it with `gpuHourUsd` on harness.verafy.ai/economics before renting.

FlashProve's measured times on its machine (463 GB, 24 cores, one H100; "other programs, not the released ones"; vendor-reported): build about 29 min, weight sums 5 to 6 min, calibrate 127 s, commit 43 min, prove 4 min, verify 22 s. The 232.13 GB download is extra and has not been timed by FlashProve.

## 2. Set up the machine (needs root, once)

As in FlashProve's AGENTS.md: everything after this runs as an ordinary user, never under `sudo`.

```
apt-get update && apt-get install -y --no-install-recommends g++ make python3 unzip curl
useradd -m -s /bin/bash prover
```

Install CUDA 13.2 Update 2 and g++ 13 as `prover/docs/build.md` says (it prints the pip lines for the compiler), and Python 3.13 for route 4.

## 3. Build and check the verifier first (no GPU needed)

As `prover`, from the repository root:

```
git clone https://github.com/anthropics/FlashProve.git && cd FlashProve
verifier/build.sh
bin/cp_verify examples/accepted-proof/config examples/accepted-proof/ivk examples/accepted-proof/example.req examples/accepted-proof/example.y examples/accepted-proof/example.proof -id "$(cat examples/accepted-proof/ID.txt)"
```

Expect `THE VERIFIER IS BUILT:` from the build, then a last line `YES` and exit code 0. Quote any `build.sh: note:` line in the report. This is the same `cp_verify` every node and auditor runs on CPU; do it on a cheap Linux box before renting the GPU machine.

## 4. Check the GPU stack on a small model

```
examples/quickstart-gpu.sh
```

It builds `cp_verify`, `cp_commit` and `cp_prove`, then commits, proves one 64-token request and verifies it. Success: exit code 0 and a line starting `quickstart-gpu: all steps ended as expected`, and every `Compiled by` line ending in `release 13.2, V13.2.86`. It can be silent for over 15 minutes.

## 5. Download Llama 4 Maverick and make the commitment (one-time setup)

Exactly as `docs/quickstart.md` route 4 gives it. Type the first two lines, make the calibration set, then the third:

```
W=$(mktemp -d /var/tmp/maverick.XXXXXX) && M="$W/work" F="$W/weights" && echo "M=$M F=$F"
(umask 022; mkdir "${F:?first run the line with mktemp}" && while read -r sum name; do python3 -I -c 'import os, sys; sys.tracebacklimit = 0; os.write(os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644), (sys.argv[2] + "\n").encode())' "${F:?}/$name.weights-are-public" "$sum  $name" || exit 1; done < examples/maverick/weights.sha256)
python3 scales/make_calibration_set.py TRAIN_PARQUET LLAMA2_TOKENIZER_JSON LLAMA4_TOKENIZER_JSON "${F:?}/calibration_set.npy"
examples/maverick/run.sh all "${M:?first run the line with mktemp}" --weights "${F:?first run the line with mktemp}"
```

- The second line declares the weight files public (decision 2).
- The calibration set needs WikiText-2's raw training split (`Salesforce/wikitext`) and the two tokenizers (decision 1). It must end with `the set is as expected`, exit code 0.
- `/var/tmp` may be cleaned by the system; use another directory to keep the work.
- Run it in the background as `examples/maverick/README.md` says ("In the background").
- Success: `compare` prints `Your commitment is the published one.`, `prove` reports the last line `YES`, exit code 0.

Record, for the ROADMAP and the economics page, labeled measured with the date and the machine: download time, commit time and peak memory, one-token prove time, verify time, and proof size. Those are the first measured figures that may replace vendor-reported ones, and only the ones measured.

## 6. Publish the commitment on the harness card

The commitment ID is the one `cp_commit` printed, and it must equal the published one in `examples/maverick/expected.txt`. Then, on the harness:

```
verafy harness commit-model h-meta-1 <commitment ID, 64 hex>
```

This writes `modelCommitment` onto that pool entry in `verafy.config.json`. Restart the harness; its card carries the commitment, the chain checks every round card against the registration, and every L2 proof is checked against it. Verifiers take the commitment ID from the card (a party they trust), never from files sent with a proof.

## 7. Wire it into the harness

- **Prover.** Write a wrapper that meets the contract in `packages/prove/src/external.js` (`commitment`, `infer`, `prove`, `verify`) around `cp_prove`, and use `flashProveProver({ command })` or `flashProveProver({ url })`. `infer` must answer without proving, so proving never blocks the commit. Keep batches at most `proverBatch` (24, vendor-reported) and requests within 1,024 tokens; longer contracts split with `map-reduce/1`.
- **Verifier.** Every node and auditor uses `flashProveVerifier({ cpVerify: '/path/to/bin/cp_verify', bindsTo })`. `bindsTo` must check that the request and reply files (`req`, `y`) are this prompt and this answer, through the Llama 4 tokenizer; without it, verify returns false. Building `bindsTo` is the open piece of work.
- **The prover sees the plaintext it proves.** The encrypted queue protects contracts until the jury is drawn, not from the proving machine.

## 8. Stop paying

Proofs are useful only while the machine runs. When the block is sealed and the figures recorded, stop the instance. The work directory holds the commitment's public key directory, which verifiers need: copy it off first, and never copy the secret (`-isk`) anywhere.
