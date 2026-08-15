#!/bin/sh
# build-installer.sh -- produces the installer a person downloads: the same artifact CI
# publishes, through the same supported packaging path (electron-builder) and the same version
# as package.json. macOS builds "npm run dist" (dmg + zip); Linux builds "npm run dist:linux"
# (AppImage + deb).
#
# Full contract: docs/building.md
#
# Flags: -s / --silent, or a SILENT=1 environment variable -- no prompts, no interactive pause,
# and exits non-zero on the first real failure.
#
# Code signing is PERMANENTLY out of scope. This script never requests, discovers, or invokes a
# signer, and never touches a code-signing certificate or credential. macOS builds run with
# identity=null and notarize=false, so the artifact this script produces is unsigned and will
# trigger Gatekeeper / SmartScreen-equivalent warnings -- this script says so in its own output.
#
# This script NEVER publishes, tags, pushes, or creates a release. It only builds and verifies a
# local artifact.

set -eu

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$ROOT/dist"

SILENT_MODE=0
for arg in "$@"; do
  case "$arg" in
    -s|--silent) SILENT_MODE=1 ;;
  esac
done
if [ "${SILENT:-0}" = "1" ]; then SILENT_MODE=1; fi

say() { printf '%s\n' "$1"; }
fail() {
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

os_name="$(uname -s)"
case "$os_name" in
  Darwin) DIST_SCRIPT="dist"; DIST_LABEL="macOS (dmg + zip)" ;;
  Linux)  DIST_SCRIPT="dist:linux"; DIST_LABEL="Linux (AppImage + deb)" ;;
  *) fail "Package" "a supported operating system" "Darwin or Linux" "uname -s" \
       "unsupported OS: $os_name -- Windows installers are built by build-installer.bat instead" ;;
esac

say ""
say "=== nodeterm installer build ==="
say "Repository : $ROOT"
say "Target     : $DIST_LABEL (unsigned)"
say ""

# Best-effort commit/tree-state report, purely informational: packaging does not need git.
BUILD_COMMIT="unknown (git not available)"
BUILD_TREE_STATE="unknown"
if command -v git >/dev/null 2>&1 && git -C "$ROOT" rev-parse HEAD >/dev/null 2>&1; then
  BUILD_COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
  if [ -z "$(git -C "$ROOT" status --porcelain)" ]; then
    BUILD_TREE_STATE="clean"
  else
    BUILD_TREE_STATE="DIRTY - contains uncommitted changes"
  fi
fi
say "Commit     : $BUILD_COMMIT"
say "Tree state : $BUILD_TREE_STATE"
say ""

# ---------------------------------------------------------------------------------------------
# Phase 1: dependencies. Always delegated to download-dependencies.sh, by absolute path.
# ---------------------------------------------------------------------------------------------
phase_begin "Dependencies"
if [ "$SILENT_MODE" = "1" ]; then
  "$ROOT/download-dependencies.sh" -s
else
  "$ROOT/download-dependencies.sh"
fi
phase_end "Dependencies"

# ---------------------------------------------------------------------------------------------
# Phase 2: package the installer through the project's own supported path.
# ---------------------------------------------------------------------------------------------
phase_begin "Package (npm run $DIST_SCRIPT)"
rm -rf "$DIST_DIR"
cd "$ROOT"
npm run "$DIST_SCRIPT" || fail "Package" \
  "electron-builder ($DIST_LABEL target)" \
  "npm run $DIST_SCRIPT must exit 0" \
  "$ROOT/package.json -> scripts.$DIST_SCRIPT" \
  "npm exited non-zero - see the packaging output above for the real cause"
phase_end "Package (npm run $DIST_SCRIPT)"

# ---------------------------------------------------------------------------------------------
# Phase 3: verify what was actually built, rather than trusting electron-builder's exit code
# alone.
# ---------------------------------------------------------------------------------------------
phase_begin "Verify installer"

[ -d "$DIST_DIR" ] || fail "Verify installer" \
  "the electron-builder output directory" \
  "dist/ must exist after a successful package step" \
  "$DIST_DIR" \
  "directory not found - packaging reported success but produced nothing there"

case "$os_name" in
  Darwin) pattern='*.dmg' ;;
  Linux)  pattern='*.AppImage' ;;
esac

ARTIFACT="$(find "$DIST_DIR" -maxdepth 1 -type f -name "$pattern" | sort | head -n1)"
[ -n "$ARTIFACT" ] || fail "Verify installer" \
  "the packaged installer ($pattern)" \
  "at least one $pattern must exist in dist/" \
  "$DIST_DIR" \
  "no matching file found - packaging reported success but the installer is missing"

ARTIFACT_SIZE="$(wc -c < "$ARTIFACT" | tr -d ' ')"
# 5 MiB is a floor, not a target -- it only exists to catch an obviously truncated or empty file.
MIN_BYTES=5242880
if [ "$ARTIFACT_SIZE" -lt "$MIN_BYTES" ]; then
  fail "Verify installer" \
    "the packaged installer" \
    "file size must be at least 5 MiB (a plausible-size floor, not a target)" \
    "$ARTIFACT" \
    "file is only $ARTIFACT_SIZE bytes - this looks truncated or empty, not a real installer"
fi

if command -v sha256sum >/dev/null 2>&1; then
  ARTIFACT_SHA256="$(sha256sum "$ARTIFACT" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  ARTIFACT_SHA256="$(shasum -a 256 "$ARTIFACT" | awk '{print $1}')"
else
  ARTIFACT_SHA256="(sha256sum/shasum not available - could not hash the artifact)"
fi

phase_end "Verify installer"

say "=== Installer built and verified. ==="
say ""
say "Artifact         : $ARTIFACT"
say "Size              : $ARTIFACT_SIZE bytes"
say "SHA-256           : $ARTIFACT_SHA256"
say "Built from        : commit $BUILD_COMMIT (working tree: $BUILD_TREE_STATE)"
say ""
say "*** This installer is UNSIGNED. *** Code signing is permanently out of scope for this"
say "project. Installing/opening it will trigger Gatekeeper or an unknown-publisher warning --"
say "that is expected, not a build defect. This script only builds and verifies the artifact"
say "locally: it does not publish, tag, push, or create a release."
say ""
exit 0
