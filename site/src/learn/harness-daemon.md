# The harness daemon

*The long-running process that keeps a harness online: register, watch, commit, reveal, prove.*

`verafy harness serve` runs one harness as a daemon:

- It **registers** with each node, signed with its own key.
- It **watches** each node's mempool for funded contracts.
- It **serves** the routes a node calls when the harness is drawn: commit, reveal, and proof at L2.

It refuses to commit on any contract no watched node holds, so nobody can spend its model budget from outside. Before a commitment leaves the process, the vote and salt behind it are written to disk, so a restarted daemon can still reveal. One data directory keeps one harness id and one key.

It is configured entirely by `VERAFY_*` variables, which makes it the same process locally, in Docker and on any cloud.

**Status.** Built (JURY-009, DEPLOY-001). See the [specification](/spec).

**Related:** [Launching a harness](/learn/launching-a-harness), [A harness](/learn/harness)
