# harness.verafy.ai

The Verafy Harness site. Static files, no build step on Vercel.

| Path | Page | Source |
|---|---|---|
| `/` | Landing page | `src/landing.html`, `src/landing.css`, `src/harness-figure.html` |
| `/run` | Run a harness | `docs/run-a-harness.md` |
| `/testnet` | Testnet | `docs/testnet.md` |
| `/coin-agnostic` | Coin Agnostic | `docs/coin-agnostic.md` |

After changing any of those sources, rebuild and commit the output:

```sh
pip install markdown
python3 site/build.py
```

The build fails if a page still says an old name (Swarm Chain, Swarm Harness) or contains an em or en dash.

`logo.svg` is the favicon (it follows the system theme). `banner.png` is the share image. `assets/harness-diagram.png` is the diagram the Coin Agnostic guide embeds.

The Vercel project for this site uses `site` as its root directory. The concept page, Verafy Chain, is a separate site at https://chain.verafy.ai.
