#!/usr/bin/env node
/**
 * Stages the npm package @verafy/mcp in a directory, ready for `npm pack` or
 * `npm publish`.
 *
 * The server reads the example contracts, the contract schema, three guides and
 * verafy.config.json from the repository root, three levels above
 * packages/mcp/src. The package keeps that layout, so the code runs unchanged:
 *
 *   package.json            @verafy/mcp, bin verafy-mcp
 *   packages/mcp/           the server
 *   packages/core/src/      the zero-dependency core it imports
 *   examples/ schemas/ docs/ verafy.config.json README.md LICENSE
 *
 * Usage: node scripts/pack-mcp.mjs [outDir]   (default: dist/mcp)
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(process.argv[2] ?? join(ROOT, 'dist', 'mcp'))
const mcp = JSON.parse(readFileSync(join(ROOT, 'packages/mcp/package.json'), 'utf8'))

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const copy = (from, to = from) => cpSync(join(ROOT, from), join(OUT, to), { recursive: true })
copy('packages/mcp/src')
copy('packages/mcp/package.json')
copy('packages/core/src')
copy('examples')
copy('schemas')
for (const doc of ['run-a-harness.md', 'coin-agnostic.md', 'testnet.md']) copy(`docs/${doc}`)
copy('verafy.config.json')
copy('LICENSE')
copy('integrations/mcp/README.md', 'README.md')

const pkg = {
  name: mcp.name,
  version: mcp.version,
  description: mcp.description,
  type: 'module',
  license: mcp.license,
  homepage: mcp.homepage,
  repository: { type: 'git', url: 'https://github.com/Verafyai/verafyHarness.git', directory: 'packages/mcp' },
  bin: { 'verafy-mcp': 'packages/mcp/src/cli.js' },
  exports: './packages/mcp/src/server.js',
  engines: mcp.engines,
  keywords: ['mcp', 'verafy', 'verafy-harness', 'actually-smart-contracts'],
}
writeFileSync(join(OUT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
console.log(`staged ${pkg.name}@${pkg.version} in ${OUT}`)
