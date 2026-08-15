#!/bin/sh
# download-dependencies.sh -- obtains every dependency nodeterm needs to build, run and test,
# from canonical upstreams, into per-project or user-scoped locations. Never machine-wide, never
# requiring sudo when a user-scoped path exists.
#
# Full contract: docs/building.md
#
# Flags: -s / --silent, or a SILENT=1 environment variable -- no prompts, no interactive pause,
# exits non-zero on the first real failure so a caller can branch on it.
#
# Never installs a secret, a credential, or a code-signing certificate.

set -eu

ROOT="$(cd "$(dirname "$0")" && pwd)"
MANIFEST="$ROOT/dependencies.manifest.json"
TOOLCHAIN_DIR="${HOME:-/tmp}/.nodeterm/toolchain"

SILENT_MODE=0
for arg in "$@"; do
  case "$arg" in
    -s|--silent) SILENT_MODE=1 ;;
  esac
done
if [ "${SILENT:-0}" = "1" ]; then SILENT_MODE=1; fi

say() { printf '%s\n' "$1"; }
fail() {
  # $1=phase $2=dependency $3=constraint $4=source $5=error -- never a bare "failed".
  say ""
  say "[FAILED] $1"
  say "  Dependency : $2"
  say "  Constraint : $3"
  say "  Source     : $4"
  say "  Error      : $5"
  exit 1
}

PHASE_T0=0
phase_begin() {
  say "--- $1 ---"
  PHASE_T0="$(date +%s)"
}
phase_end() {
  t1="$(date +%s)"
  say "--- $1 done ($((t1 - PHASE_T0))s) ---"
  say ""
}

say ""
say "=== nodeterm dependency bootstrap ==="
say "Repository : $ROOT"
say "Manifest   : $MANIFEST"
say ""

[ -f "$MANIFEST" ] || fail "dependencies.manifest.json" \
  "dependencies.manifest.json itself" \
  "must sit next to this script at the repository root" \
  "$MANIFEST" \
  "file not found"

read_manifest() {
  # $1 = jq-style dotted path under .node.portable.<key>.<field>
  node -e "
    const fs = require('fs');
    const j = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    const parts = process.argv[2].split('.');
    let v = j;
    for (const p of parts) { v = v && v[p]; }
    if (v !== undefined && v !== null) process.stdout.write(String(v));
  " "$MANIFEST" "$1" 2>/dev/null || true
}

os_name="$(uname -s)"
arch_name="$(uname -m)"

# ------------------------------------------------------------------------------------------------
# Phase 1: Node.js runtime
# ------------------------------------------------------------------------------------------------
phase_begin "Node.js runtime"

if command -v node >/dev/null 2>&1; then
  say "  Found node $(node --version) already on PATH - nothing to install."
else
  say "  node not found on PATH. Installing..."
  installed=0

  case "$os_name" in
    Darwin)
      if command -v brew >/dev/null 2>&1; then
        say "  Trying Homebrew (brew install node)..."
        if brew install node >"${TMPDIR:-/tmp}/nodeterm-brew-node.log" 2>&1; then
          installed=1
        else
          say "  brew install failed - see ${TMPDIR:-/tmp}/nodeterm-brew-node.log - falling back to a portable extract."
        fi
      else
        say "  Homebrew is not available on this machine - using a portable extract instead."
      fi
      portable_key="darwin-$([ "$arch_name" = "arm64" ] && echo arm64 || echo x64)"
      ;;
    Linux)
      if command -v apt-get >/dev/null 2>&1; then
        say "  Trying apt-get (nodejs, user-visible system package manager -- requires sudo)..."
        if command -v sudo >/dev/null 2>&1; then
          if sudo -n apt-get install -y nodejs npm >"${TMPDIR:-/tmp}/nodeterm-apt-node.log" 2>&1; then
            installed=1
          else
            say "  apt-get needs an interactive sudo prompt or failed - see ${TMPDIR:-/tmp}/nodeterm-apt-node.log - falling back to a portable, user-scoped extract instead (no sudo needed)."
          fi
        fi
      fi
      portable_key="linux-x64"
      ;;
    *)
      portable_key=""
      ;;
  esac

  if [ "$installed" != "1" ]; then
    [ -n "${portable_key:-}" ] || fail "Node.js runtime" \
      "node.js (portable)" \
      "dependencies.manifest.json -> node.portable" \
      "$os_name/$arch_name" \
      "no portable entry for this OS/architecture and no package manager succeeded"

    url="$(read_manifest "node.portable.$portable_key.url")"
    sha256="$(read_manifest "node.portable.$portable_key.sha256")"
    [ -n "$url" ] || fail "Node.js runtime" \
      "node.js (portable, $portable_key)" \
      "dependencies.manifest.json -> node.portable.$portable_key" \
      "$MANIFEST" \
      "manifest has no portable entry for $portable_key"

    mkdir -p "$TOOLCHAIN_DIR"
    archive="$TOOLCHAIN_DIR/node-$portable_key.tar"
    case "$url" in
      *.tar.gz) archive="$archive.gz" ;;
      *.tar.xz) archive="$archive.xz" ;;
    esac

    say "  Downloading $url"
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL "$url" -o "$archive" || fail "Node.js runtime" \
        "node.js (portable, $portable_key)" "pinned in dependencies.manifest.json" "$url" \
        "curl download failed"
    elif command -v wget >/dev/null 2>&1; then
      wget -q "$url" -O "$archive" || fail "Node.js runtime" \
        "node.js (portable, $portable_key)" "pinned in dependencies.manifest.json" "$url" \
        "wget download failed"
    else
      fail "Node.js runtime" "curl or wget" "either must be present to download Node.js" \
        "n/a" "neither curl nor wget was found on PATH"
    fi

    if command -v sha256sum >/dev/null 2>&1; then
      actual="$(sha256sum "$archive" | awk '{print $1}')"
    elif command -v shasum >/dev/null 2>&1; then
      actual="$(shasum -a 256 "$archive" | awk '{print $1}')"
    else
      fail "Node.js runtime" "sha256sum or shasum" "either must be present to verify the download" \
        "n/a" "neither sha256sum nor shasum was found on PATH"
    fi
    if [ "$actual" != "$sha256" ]; then
      rm -f "$archive"
      fail "Node.js runtime" "node.js (portable, $portable_key)" \
        "sha256 $sha256 recorded in dependencies.manifest.json" "$url" \
        "downloaded file hashed to $actual instead - refusing to use an unverified binary"
    fi
    say "  SHA-256 verified: $actual"

    say "  Extracting to $TOOLCHAIN_DIR"
    mkdir -p "$TOOLCHAIN_DIR"
    tar -xf "$archive" -C "$TOOLCHAIN_DIR" || fail "Node.js runtime" \
      "node.js (portable, $portable_key)" "n/a" "$archive" "tar extract failed"
    rm -f "$archive"

    extract_dir="$(find "$TOOLCHAIN_DIR" -maxdepth 1 -type d -name "node-v*-$portable_key" | head -n1)"
    [ -n "$extract_dir" ] || fail "Node.js runtime" "node.js (portable, $portable_key)" "n/a" \
      "$TOOLCHAIN_DIR" "extracted archive did not contain the expected node-v*-$portable_key folder"

    export PATH="$extract_dir/bin:$PATH"
    NODETERM_NODE_HOME="$extract_dir/bin"
    export NODETERM_NODE_HOME
    marker="${HOME:-/tmp}/.nodeterm/node-home"
    mkdir -p "$(dirname "$marker")"
    printf '%s\n' "$extract_dir/bin" > "$marker"
    say "  Installed node $("$extract_dir/bin/node" --version) (portable, $portable_key) at $extract_dir"
    say "  Remembered for next time in $marker -- source it or add it to your shell's PATH to use"
    say "  this Node without re-running this script, e.g.: export PATH=\"\$(cat $marker):\$PATH\""
  else
    hash -r 2>/dev/null || true
    command -v node >/dev/null 2>&1 || fail "Node.js runtime" "node.js" \
      "must be resolvable on PATH after a successful package-manager install" "n/a" \
      "the package manager reported success but node is still not on PATH"
    say "  Installed node $(node --version)."
  fi
fi

phase_end "Node.js runtime"

# ------------------------------------------------------------------------------------------------
# Phase 2: npm project dependencies
# ------------------------------------------------------------------------------------------------
phase_begin "npm project dependencies"

command -v npm >/dev/null 2>&1 || fail "npm project dependencies" \
  "npm (ships bundled with Node.js)" \
  "must be resolvable on PATH once the Node.js phase above finishes" \
  "n/a - the Node.js install did not put npm on PATH" \
  "\`command -v npm\` found nothing"

cd "$ROOT"
if [ -f package-lock.json ]; then
  say "  package-lock.json found - running: npm ci"
  if ! npm ci; then
    fail "npm project dependencies" "the packages listed in package.json" \
      "package-lock.json" "the npm registry (https://registry.npmjs.org/)" \
      "npm ci exited non-zero - see the npm output above for the real cause"
  fi
else
  say "  No package-lock.json found - running: npm install"
  if ! npm install; then
    fail "npm project dependencies" "the packages listed in package.json" \
      "package.json (no lockfile present)" "the npm registry (https://registry.npmjs.org/)" \
      "npm install exited non-zero - see the npm output above for the real cause"
  fi
fi

phase_end "npm project dependencies"

say ""
say "=== All dependencies are ready. ==="
exit 0
