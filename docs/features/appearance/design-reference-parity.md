# Design-reference parity inventory

The v2 design bundle contains ten checked-in HTML references for the Windows desktop application.
This article defines the source-of-truth inventory and the evidence boundary for comparing each
reference with the real built application.

## What is inventoried

[`design/v2/design-parity-inventory.json`](../../../design/v2/design-parity-inventory.json) is a
hand-written list with exactly one row for each reference. The executable guard is
[`scripts/check-design-parity.mjs`](../../../scripts/check-design-parity.mjs), backed by
[`scripts/design-parity-receipt.mjs`](../../../scripts/design-parity-receipt.mjs). The guard rejects
missing rows, duplicate rows, renamed identifiers, unlisted references, incomplete routes, and
incomplete capture tuples.

| Reference | Design-reference route | Built application route | Deterministic state |
| --- | --- | --- | --- |
| `MD3 Canvas.dc.html` | `npm run design:v2 -- Canvas` | `desktop.canvas` | Empty project canvas |
| `MD3 Board.dc.html` | `npm run design:v2 -- Board` | `desktop.board` | Project board with session cards |
| `MD3 Files.dc.html` | `npm run design:v2 -- Files` | `desktop.files` | Files, source control, and history |
| `MD3 Settings.dc.html` | `npm run design:v2 -- Settings` | `desktop.settings` | Language settings section |
| `MD3 Overlays.dc.html` | `npm run design:v2 -- Overlays` | `desktop.overlays` | Palette, context menu, confirmation, and notifications |
| `MD3 Regex Builder.dc.html` | `npm run design:v2 -- "Regex Builder"` | `desktop.regex-builder` | Anchored builder with a live pattern |
| `MD3 Welcome.dc.html` | `npm run design:v2 -- Welcome` | `desktop.welcome` | First-run empty project |
| `MD3 Kids Mode.dc.html` | `npm run design:v2 -- "Kids Mode"` | `desktop.kids-mode` | Kids home, parent gate, and grown-up screen |
| `MD3 Tools.dc.html` | `npm run design:v2 -- Tools` | `desktop.tools` | Ollama, converter, authenticator, and exports |
| `MD3 History.dc.html` | `npm run design:v2 -- History` | `desktop.history` | Session memory, local history, and changelog |

Every row also records the dark theme, a 1440 x 940 viewport, device scale factor 1, page scale 1,
the exact reference and built capture paths, one labelled side-by-side comparison path, one
machine-readable visual-diff path, the Material Design 3 audit identifiers, and an intentional
deviation approval. The route and tuple are part of the evidence identity, not descriptive notes.

## Runtime evidence boundary

The current receipt manifest at
[`docs/assets/design-parity/receipt-manifest.json`](../../assets/design-parity/receipt-manifest.json)
has ten `pending-runtime` receipts. No image, comparison, or diff is claimed by those records, and
no placeholder capture is checked in. A future runtime pass must use the approved Lowlevel headless
route against both the design-reference Electron app and the real built application. It must retain
both raw captures, create the labelled comparison and machine-readable diff under the row's paths,
and bind every verified receipt to the exact source commit and deterministic tuple.

Pending receipts are allowed so source inventory work can land without inventing runtime evidence.
They are not parity approval. A verified receipt must contain a full source commit SHA, UTC capture
time, four real files, byte counts, SHA-256 digests, and the exact tuple string. The validator reads
each file back and recomputes its digest before accepting the receipt.

## Material audit and intentional deviations

Each screen points to the shared Material Design 3 audit and names exact audit IDs. The guard checks
the IDs as complete backtick-delimited identifiers in that audit, so a child selector or a longer
renamed identifier cannot satisfy the row. The current rows declare no intentional deviations. A
future deviation must replace `status: "none"` with a written reason and an explicit approval record
in the same inventory change.

## Running the checks

```text
npm run check:design-parity
node scripts/check-design-parity.mjs --self-test
npx vitest run scripts/design-parity-receipt.test.mjs
```

The self-test mutates one exact screen ID, route, tuple field, evidence path, audit field, receipt
field, and approval boundary at a time. Each mutation must fail, then the untouched canonical
inventory must pass again. The test never edits the checked-in JSON files.

## Security and privacy

The inventory contains only repository-relative paths and public design metadata. Runtime receipts
must not include user data, credentials, private paths, prompts, or unrelated window content. The
headless capture profile must be isolated and deterministic, and any runtime failure remains
pending or failed rather than being converted into a missing-image record.

## Suggested articles

- [Desktop Material Design 3 audit](./material-3-audit.md)
- [Built-artifact render verification](../../md3-render-verification.md)
- [Material Design 3 migration status](./material-3-migration-status.md)
- [Appearance customization](../appearance.md)
