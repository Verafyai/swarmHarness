# Upstream: DeepSeek Harness

Verafy Harness is built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT), pinned as a git submodule at `upstream/deepseek-harness`.

| Field | Value |
|---|---|
| Upstream | https://github.com/deepseek-ai/deepseek-harness |
| Pinned commit | `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159` (2026-11-04) |
| Upstream version | `0.2.2-rc.1`, developer preview |
| License | MIT, Copyright (c) DeepSeek-AI. See `upstream/deepseek-harness/LICENSE`. |

## Why a submodule and plugins, not a patched copy

DeepSeek Harness is built so that new behavior goes on documented extension points rather than into the agent loop. Verafy Harness follows that rule: juror mode is a plugin (`packages/dsh-swarm-juror`), model swapping is configuration (`config/cordis.swarm.yml`, through `@deepseek-ai/dsh-llm-pi-ai`), and the upstream tree stays unmodified so it can be updated by moving the pin.

## Updating the pin

```sh
git -C upstream/deepseek-harness fetch origin main
git -C upstream/deepseek-harness checkout <new-commit>
git add upstream/deepseek-harness
```

Then rebuild DSH and re-run the juror smoke test (ROADMAP.md, milestone 2). DSH is pre-stable and breaks compatibility between releases.
