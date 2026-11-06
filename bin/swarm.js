#!/usr/bin/env node
/**
 * swarm: the pre-rename name of the verafy command, kept so old scripts and
 * docs still work. It prints one notice to stderr, so `--json` output on stdout
 * stays clean, and then runs bin/verafy.js with the same arguments.
 */
process.stderr.write('notice: `swarm` is now `verafy`; this alias still works, but use `verafy` going forward.\n')
await import('./verafy.js')
