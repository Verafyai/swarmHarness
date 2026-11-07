#!/bin/sh
# Install Verafy Harness from a GitHub release.
#   curl -fsSL https://raw.githubusercontent.com/Verafyai/verafyHarness/main/install.sh | sh
# Needs Node 22 or later. Installs to ~/.verafy/app and links `verafy` into ~/.local/bin.
# VERAFY_VERSION=v0.0.2-alpha to pin a version; default is the latest release, else main.
set -eu
need() { command -v "$1" >/dev/null 2>&1 || { echo "verafy: $1 is required" >&2; exit 1; }; }
need curl; need tar; need node
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 22 ] || { echo "verafy: Node 22 or later is required (found $(node -v))" >&2; exit 1; }
repo=Verafyai/verafyHarness
ver=${VERAFY_VERSION:-$(curl -fsS "https://api.github.com/repos/$repo/releases" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=JSON.parse(s);process.stdout.write(r[0]?.tag_name??"")}catch{}})')}
if [ -n "$ver" ]; then url="https://github.com/$repo/releases/download/$ver/verafy-harness-$ver.tar.gz"; else ver=main; url="https://codeload.github.com/$repo/tar.gz/refs/heads/main"; fi
dest="$HOME/.verafy/app"
tmp=$(mktemp -d)
echo "verafy: downloading $ver"
curl -fsSL "$url" -o "$tmp/v.tgz"
mkdir -p "$dest" "$HOME/.local/bin"
rm -rf "$dest.new" && mkdir -p "$dest.new"
tar -xzf "$tmp/v.tgz" -C "$dest.new" --strip-components=1
rm -rf "$dest" && mv "$dest.new" "$dest"
cat > "$HOME/.local/bin/verafy" <<SH
#!/bin/sh
exec node "$dest/bin/verafy.js" "\$@"
SH
chmod +x "$HOME/.local/bin/verafy"
rm -rf "$tmp"
echo "verafy: installed $ver to $dest"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "verafy: add ~/.local/bin to your PATH";; esac
echo "verafy: next, run  verafy up   (or  verafy up --ui  for a page in your browser)"
