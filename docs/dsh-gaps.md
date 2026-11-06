# DeepSeek Harness gaps for juror mode

What the juror plugin needed from DSH 0.2.2-rc.1 (pinned `fcc0ad4`) that DSH does not expose, or exposes awkwardly. None of these blocked milestone 2; each has a workaround in this repo, not in `upstream/`. Listed so they can be raised upstream or dropped when DSH changes.

1. **No way to require a tool call.** Neither `LlmCallConfig` nor `dsh-llm-pi-ai` has a `tool_choice` control, so a juror model can end its turn with the vote in prose (llama-4-maverick, qwen3-235b on 2026-11-06). Workaround: the plugin steers the agent at `agent/turn-stopping`, at most twice, saying only a `verafy_cast_vote` call counts. A forced tool choice on the final step would be cleaner and cheaper.

2. **A plugin row name cannot be computed.** `name: !!js ...` is rejected by the profile compatibility preflight (`name.startsWith is not a function`), and a patch file does not change the directory names resolve from. Workaround: `scripts/dsh-juror.mjs setup` symlinks `packages/dsh-verafy-juror` into `$DSH_HOME/profiles/headless/node_modules/@verafyharness/` so the literal name `@verafyharness/dsh-verafy-juror` resolves.

3. **The plugin's imports must resolve from its own directory.** DSH loads the plugin module from wherever it lives, so its imports of DSH packages and `@verafyharness/core` (declared `workspace:*`, and this repo is not a pnpm workspace) resolve from `packages/dsh-verafy-juror`. Installing it with `dsh plugin add` was not tried. Workaround: `scripts/dsh-link.mjs` links the peers (`@deepseek-ai/cordis`, `schemastery`, `dsh-tools`, `dsh-agent`, `dsh-llm`) to the built packages in the submodule, and `@verafyharness/core` to `packages/core`.

4. **Running from source outside the DSH directory needs `TSX_TSCONFIG_PATH`.** With another working directory, tsx does not find DSH's tsconfig path map and `@deepseek-ai/cordis` resolves to a build without `FiberState`. Workaround: the launcher sets `TSX_TSCONFIG_PATH` to DSH's `tsconfig.json`, so each juror can use its own empty directory as its workspace.

5. **The root postinstall fails inside a git submodule.** `scripts/install-lefthook.mjs` refuses because `core.worktree` is in the submodule's common git config, so `pnpm install` exits 1 after installing everything. Workaround: `CI=true`, which the script already treats as "skip hooks".

6. **`includeRuntimeContext: false` still leaves a runtime context snapshot.** The juror still receives the working directory and "You are the root agent. Your name is lead." as a user message, contributed by other plugins. Harmless here, but a juror should ideally see only the contract.

7. **`tools.restrict` needs an agent scope.** It throws on the plugin's global context. Workaround: restrict inside `agent/created` on `agent.ctx`. This works; noted only because the `tools/pre-execute` gate alone would leave every other tool advertised to the model.

8. **No cost in the session record.** DSH records token usage per request but not the provider's reported cost, so per-ruling cost for DSH jurors has to come from the provider dashboard or a separate request to OpenRouter.
