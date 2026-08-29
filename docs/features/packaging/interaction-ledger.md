# Built-artifact interaction evidence

The interaction ledger is the reusable evidence contract for the Windows desktop acceptance
route. It records a real click against a real packaged build, then lets an independent validator
check the claims before any capture is promoted into the repository's evidence directory.

## Behaviour

An acceptance driver writes one JSON ledger for a run. Each `clicks` entry has all of the following:

| Field | Purpose |
| --- | --- |
| `sourceCommit` | The full source commit used by this click. It must match the expected commit and exist in the repository. |
| `executableSha256` | The digest of the packaged executable photographed by this click. The validator recomputes it. |
| `setupSha256` | The digest of the installed Squirrel `Setup.exe`, or `null` when the run did not install it. |
| `stateTuple` | Screen, named state, theme, viewport width and height, and display scale. |
| `target` | The accessible name, semantic role, and stable locator of the clicked control. |
| `input` | Whether the input was pointer, keyboard, or touch, plus the applicable input details. |
| `observedState` | Before state, after state, the observed consequence, and whether the state changed. An input-only claim such as “click dispatched” is rejected. |
| `screenshot` | A PNG path, byte count, dimensions, and SHA-256. The file is opened and hashed during validation. |
| `privacy` | A required `pass` verdict and a note describing the privacy review. |

The top-level `capture` block identifies the only accepted route:

```json
{
  "route": "cheap-lowlevel-headless",
  "tool": "lowlevel-computer-use-cheap",
  "source": "built-artifact",
  "window": "named-headless-desktop"
}
```

The route is deliberately explicit. A CDP-only run, a source preview, a visible desktop capture,
or a receipt that merely repeats metadata cannot satisfy it. The cheap headless launch wrapper
also requires `ok: true`, a positive process id, a named desktop, `focusStealing: false`, and
`terminalWindow: false` before it can issue a launch receipt.

## Clipping matrix

Every ledger includes five independently recorded rows:

| Row | Required condition |
| --- | --- |
| `narrow-320` | A 320-pixel-wide viewport, with an observed no-clipping result. |
| `scale-100` | Display scale `1`. |
| `scale-125` | Display scale `1.25`. |
| `scale-150` | Display scale `1.5`. |
| `scale-200` | Display scale `2`. |

Each row has its own state tuple, no-clipping assertion, and PNG with recomputed dimensions and
digest. The matrix is evidence about the built surface, not a stylesheet or source scan.

## Validation and promotion

Validate a ledger against the exact build that the acceptance driver was asked to exercise:

```text
node scripts/interaction-ledger.mjs validate \
  --evidence <ledger.json> \
  --repo <repository-root> \
  --commit <full-source-sha> \
  --executable <absolute-packaged-executable> \
  --executable-sha256 <sha256>
```

The caller must supply the expected source commit and executable path. This prevents a receipt
from authenticating itself. The validator also verifies the optional installed Setup path and
digest when `--installed` is supplied, rejects stale per-click provenance, and rejects missing or
changed image files.

Promotion validates every field first. Only after validation succeeds does it stage all click and
matrix captures and the normalized manifest in a unique transaction directory. Existing output
destinations are refused rather than overwritten or mixed with a second build. A validation
refusal therefore leaves both the manifest and capture directory absent.

```text
node scripts/interaction-ledger.mjs promote \
  --evidence <ledger.json> \
  --repo <repository-root> \
  --commit <full-source-sha> \
  --executable <absolute-packaged-executable> \
  --out docs/assets/shots/interaction-ledger.json \
  --shots-dir docs/assets/shots/interaction-ledger
```

`--dry-run` performs the complete validation and reports the number of captures without writing
anything. The promoter never fabricates a receipt, a screenshot, or a final acceptance result.
An acceptance run that has not reached the real built artifact remains unverified.

## Failure modes and security

- A missing or stale source commit is refused, even when the image file is present.
- A changed executable, Setup file, or screenshot digest is refused after the bytes are reread.
- Missing click provenance, missing accessible target information, missing observed state, missing
  privacy review, and missing scale rows are all refusals.
- Relative capture paths must remain below the evidence directory. Promoted filenames are derived
  from validated identifiers, so a ledger cannot escape the destination with `..` path segments.
- Existing promoted output is never overwritten. Generate a new run directory or review the
  existing evidence before attempting another promotion.
- The ledger may contain local paths needed by the validator, but it must not contain credentials,
  private vocabulary payloads, session cookies, or unrelated browser targets.

## Verification

The focused suite uses temporary files and a real repository commit. It covers a valid click,
installed and uninstalled Setup provenance, route mutation, stale source and binary digests,
missing clipping rows, privacy refusal, input-only observation refusal, cheap launch receipt
validation, and the no-partial-write promotion transaction:

```text
node node_modules/vitest/vitest.mjs run scripts/interaction-ledger.test.mjs --reporter=verbose
```

The suite's PNG fixtures exist only in temporary directories. They are not final product captures
and are not promoted into the repository. Final receipts and captures require a real run of the
cheap Lowlevel MCP headless route against the exact packaged commit.

## Suggested articles

- [Packaging and auto-update](./packaging-and-auto-update.md)
- [Windows shell profiles](../terminals/windows-shell-profiles.md)
- [The application contract](../../app-contract.md)
- [CI and releases](../../ci-and-releases.md)
