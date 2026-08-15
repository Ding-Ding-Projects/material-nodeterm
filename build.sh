#!/bin/sh
# build.sh -- takes a checkout with NOTHING installed to a built, runnable nodeterm.
#
# Full contract: docs/building.md
#
# Flags: -s / --silent, or a SILENT=1 environment variable -- no prompts, no interactive pause,
# no run-it-now prompt (a silent/CI build does not launch a desktop GUI on someone's behalf), and
# exits non-zero on the first real failure.

set -eu

ROOT="$(cd "$(dirname "$0")" && pwd)"

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

say ""
say "=== nodeterm build ==="
say "Repository : $ROOT"
say ""

# ---------------------------------------------------------------------------------------------
# Phase 1: dependencies. Always delegated to download-dependencies.sh, by absolute path, so the
# two scripts can never silently drift apart.
# ---------------------------------------------------------------------------------------------
phase_begin "Dependencies"
if [ "$SILENT_MODE" = "1" ]; then
  "$ROOT/download-dependencies.sh" -s
else
  "$ROOT/download-dependencies.sh"
fi
phase_end "Dependencies"

# ---------------------------------------------------------------------------------------------
# Phase 2: build the real artifact through the project's own supported path.
# ---------------------------------------------------------------------------------------------
phase_begin "Build (npm run build)"
cd "$ROOT"
npm run build || fail "Build" \
  "the project's own build (electron-vite build)" \
  "npm run build must exit 0" \
  "$ROOT/package.json -> scripts.build" \
  "npm exited non-zero - see the build output above for the real cause"

[ -f "$ROOT/out/main/index.js" ] || fail "Build" \
  "the built main-process entry point" \
  "out/main/index.js must exist after a successful build" \
  "$ROOT/out/main/index.js" \
  "npm run build reported success but the expected output file is missing"
phase_end "Build (npm run build)"

say ""
say "=== Build complete. ==="
say "Built output : $ROOT/out"
say ""

# ---------------------------------------------------------------------------------------------
# Phase 3: offer to run it. This prompt is deliberately the LAST thing this script does, so a
# failed build never gets as far as offering to launch nothing. Silent/CI runs never prompt and
# never launch a desktop GUI on somebody's behalf.
# ---------------------------------------------------------------------------------------------
if [ "$SILENT_MODE" = "1" ]; then
  say "Silent mode - not launching nodeterm. Run it yourself with: npm start"
  exit 0
fi

printf 'Run nodeterm now? [y/N]: '
read -r answer || answer=""
case "$answer" in
  [Yy]*)
    say ""
    say "Launching nodeterm (npm start)..."
    cd "$ROOT"
    exec npm start
    ;;
  *)
    say "Not launching. Run it yourself with: npm start"
    exit 0
    ;;
esac
