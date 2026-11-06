#!/usr/bin/env node
/**
 * verafy-mcp from a clone: `node bin/verafy-mcp.js [--allow-live] [--home <dir>] [--config <file>]`.
 * The server is packages/mcp; see packages/mcp/src/cli.js.
 */
await import('../packages/mcp/src/cli.js')
