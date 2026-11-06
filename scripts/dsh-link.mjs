#!/usr/bin/env node
/**
 * Give packages/dsh-swarm-juror the packages it imports, without touching the
 * DeepSeek Harness tree: its peers (@deepseek-ai/cordis, schemastery, dsh-tools, dsh-agent, dsh-llm)
 * resolve to the built packages in upstream/deepseek-harness, and
 * @verafyharness/core resolves to packages/core. Run after building DSH.
 *
 *   node scripts/dsh-link.mjs
 */
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH = join(ROOT, 'upstream', 'deepseek-harness')
const NM = join(ROOT, 'packages', 'dsh-swarm-juror', 'node_modules')
const links = {
  '@deepseek-ai/cordis': join(DSH, 'vendor', 'cordis'),
  '@deepseek-ai/schemastery': join(DSH, 'vendor', 'schemastery'),
  '@deepseek-ai/dsh-tools': join(DSH, 'packages', 'core', 'tools'),
  '@deepseek-ai/dsh-agent': join(DSH, 'packages', 'core', 'agent'),
  '@deepseek-ai/dsh-llm': join(DSH, 'packages', 'llm', 'llm'),
  '@verafyharness/core': join(ROOT, 'packages', 'core'),
}
for (const [name, target] of Object.entries(links)) {
  if (!existsSync(join(target, 'package.json'))) throw new Error(`${name}: ${target} is missing; init the submodule and build DSH first`)
  const at = join(NM, name)
  mkdirSync(dirname(at), { recursive: true })
  rmSync(at, { force: true, recursive: true })
  symlinkSync(relative(dirname(at), target), at, 'dir')
  console.log(`linked ${name} -> ${relative(ROOT, target)}`)
}
