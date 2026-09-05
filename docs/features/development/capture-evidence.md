# Capture evidence

`scripts/capture-shots.mjs` records the desktop capture set. It photographs an already-built renderer, checks that each requested screen reaches its exact section state, decodes the PNG bytes, and records the capture's dimensions and SHA-256.

## Per-entry provenance

`docs/assets/shots/capture-manifest.json` is schema version 2. The `entries` map is authoritative: each capture id owns its file name, byte count, dimensions, hash, timestamp, tuple, commit, artifact version, method, and optional launch receipt. The root `captured` array remains for older status readers.

A filtered run such as `npm run shots -- --attach 9222 --only app-settings-language` updates only the named entries. It does not remove entries that the run did not request. A row is current only when its own recorded commit and tuple match the claim being checked. The manifest is not a single global statement about a mixed set of capture routes.

## External hidden-desktop target

The normal `--launch` mode is for local developer capture. A target launched through the approved hidden-desktop route is attached without launching another application: `npm run shots -- --attach 9222 --receipt C:\path\to\capture-receipt.json --only app-settings-language`.

The receipt must be JSON with a route naming `cheap Lowlevel MCP headless`, a source commit equal to the checkout being captured, and a successful launch block with a named hidden desktop, `focusStealing: false`, and `terminalWindow: false`. The harness refuses a missing, visible, or commit-mismatched receipt. It never starts a visible target.

## Extending the inventory

Add a surface to the hand-written `SURFACES` list with a unique id, a reachable opener, and an exact state selector. Settings surfaces use their `data-settings-section` id, for example `#language[data-settings-section="language"]`; a generic settings shell proves only that settings opened, not that the requested section opened. Do not add an inventory row with a placeholder image or a fabricated manifest entry. A required screen that cannot be reached must fail the run.

## Verification

`scripts/lib/capture-evidence.test.mjs` covers PNG decoding, hash and dimensions, legacy manifest migration, filtered-run preservation, tuple and commit currentness, and hidden-desktop receipt validation.
