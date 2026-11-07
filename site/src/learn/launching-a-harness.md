# Launching a harness

*Every way to run one: this machine, Docker, DigitalOcean, Hetzner, any cloud, or a one-click button.*

`verafy up` asks a few questions, shows the plan with keys masked, and runs it:

- **Local:** Node on this machine. Keys go to `~/.verafy/env`, mode 600.
- **Docker:** the container image, with a volume for the key.
- **DigitalOcean or Hetzner:** creates a server whose first boot installs Node, runs the daemon as a hardened service, and opens the port. The cloud token is used once and never stored.
- **Any cloud:** prints the first-boot script to paste as user data.

`verafy up --ui` asks the same questions as a page on your own machine.

Hardware profiles suggest a model: a hosted model on any machine, or open weights sized by modeled memory. Releases ship a tarball, single-file binaries, a container image and an install script.

**Status.** Built (DEPLOY-001 to 009); cloud creation tested against fake APIs only. Hosted harnesses run by Verafy are planned. See the [specification](/spec).

**Related:** [The harness daemon](/learn/harness-daemon), [A local testnet](/learn/local-testnet)
