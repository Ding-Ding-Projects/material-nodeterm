# Desktop release completeness audit

This is the handwritten Windows desktop evidence inventory for the current release pass. It is
deliberately independent from source discovery. A row stays pending until its own built-artifact
route, interaction receipt, capture, and privacy review have been supplied. The empty evidence
set at the time this document was created is not a passing result.

## Frozen candidate boundary

The candidate must provide one full source commit, one packaged executable SHA-256, optional
installed `Setup.exe` SHA-256, and a successful cheap-headless launch receipt before any runtime
row becomes recordable. The first evidence pass may bind to its original candidate commit. A
later evidence-only commit must rebuild and recapture against its final source commit, retaining
the original candidate receipts as release evidence rather than rewriting their identity.

## Cross-cutting matrix

| Contract | Required proof | Current state |
| --- | --- | --- |
| Language modes | English, Cantonese, and bilingual interactions | Pending frozen candidate |
| Themes | Light, dark, and high-contrast interactions | Pending frozen candidate |
| Responsive sizes | 320 × 720 minimum, 1280 × 720 desktop, and 1440 × 940 parity tuple | Pending frozen candidate |
| Display scales | 100%, 125%, 150%, and 200% | Pending frozen candidate |
| Clipping | Five exact no-clipping rows: narrow 320, then 100%, 125%, 150%, and 200% scale | Pending frozen candidate |
| Input routes | Keyboard and pointer or touch as each control supports | Pending frozen candidate |
| Privacy | One reviewed verdict per capture, with no credentials, private paths, personal data, or vocabulary payload | Pending frozen candidate |
| Provenance | Commit, executable hash, installed setup hash where applicable, PNG byte hash, dimensions, and launch receipt | Pending frozen candidate |

The required representative matrix is 3 language modes × 3 themes × 3 viewports × 4 display
scales, or 108 tuple-specific captures. It does not permit reusing a comfortable English dark
desktop capture to cover a different tuple.

## Full interaction routes

| Inventory ID | Surface and state | Required built route and interaction | Supporting focused checks | Evidence state |
| --- | --- | --- | --- | --- |
| `md3-welcome` | First-run onboarding and empty project | Fresh profile, invoke the project-creation action | Onboarding and workspace tests | Pending frozen candidate |
| `md3-canvas` | Canvas shell and node kinds | Launch empty project, navigate to Canvas, inspect terminal, agent, sticky, group, editor, and diff node chrome | Canvas and node registration checks | Pending frozen candidate |
| `md3-board` | Board columns, session cards, and board log | Navigate to Board and invoke a card or column action | Destination and board-log checks | Pending frozen candidate |
| `md3-files` | Explorer, source control, and history | Navigate to Files and open its visible state | File, source-control, and history checks | Pending frozen candidate |
| `md3-settings` | Language, funny levels, emoji, appearance, accessibility, personal vocabulary, and scheduled settings | Navigate to Settings, change then observe persisted state through reload where applicable | Settings persistence and language checks | Pending frozen candidate |
| `md3-overlays` | Command palette, contextual actions, notifications, and destructive confirmation | Open each overlay from a reachable control and observe its result | Overlay, notification, and confirmation checks | Pending frozen candidate |
| `md3-regex-builder` | Anchored regex builder | Focus a search control, open the builder, apply a live pattern, and observe filtering | Regex-builder checks | Pending frozen candidate |
| `md3-kids-mode` | Kids entry, parent gate, and locked state | Enter the mode through the app control and traverse the authorized local parent path | Kids-mode checks | Pending frozen candidate |
| `md3-tools` | Conversion, model manager, authenticator, export, and locking paths | Navigate to Tools and invoke each non-destructive representative flow | Tool, export, converter, and model-manager checks | Pending frozen candidate |
| `md3-history` | Local history, session memory, and changelog | Navigate to History and observe stored and empty-state recovery paths | Local-history and session-memory checks | Pending frozen candidate |

## Mandatory feature families

Each family below must be linked to one or more interaction IDs above plus its own focused source
check. A source check, build, or static design alone does not replace the required packaged
interaction and capture.

| Family | Required behavior evidence | Current state |
| --- | --- | --- |
| Language and tone | Language selection, two independent funny-level controls, decorative emoji preference, and School Mode suppression and restoration | Pending frozen candidate |
| Accessibility and focus | Keyboard routes, visible focus, reduced motion, responsive sizing, readable contrast, narration, time awareness, low-stimulation and momentum accommodations | Pending frozen candidate |
| Appearance | Theme, density, color, font, element editor, reset, undo, import and export | Pending frozen candidate |
| Navigation | Title bar, tabs, groups, searches, command palette, context menus, and dock destinations | Pending frozen candidate |
| Privacy and local data | Personal vocabulary upload, invalid and clear states, local history, export, and no sensitive payload in captures | Pending frozen candidate |
| Notifications and recovery | Non-blocking notifications, history, failures, cancellation, close, restart, and update-ready surfaces | Pending frozen candidate |
| Tools and integrations | Converter, model manager, authenticator, file and browser flows, account states, and unsupported-state clarity | Pending frozen candidate |
| Safety actions | Confirmation, cancellation, emergency exit, toy locks, and recovery from a refused action | Pending frozen candidate |
| Packaging | Packaged launch, installed launch where applicable, exact application identity, update feed, and shutdown cleanup | Pending frozen candidate |
| Design parity | Ten reference-app and built-app pairs at their exact dark 1440 × 940 scale-1 English tuples | Pending runtime evidence |

## Evidence locations and acceptance

- Pending plan: `docs/assets/shots/interaction-ledger.json`
- Verified packaged ledger target: `docs/assets/shots/interaction-ledger.json`, after promotion
- Per-click raw evidence root: an owned external run root, never a repository placeholder
- Design parity receipts: `docs/assets/design-parity/receipt-manifest.json`
- Design inventory: `design/v2/design-parity-inventory.json`

Run `node scripts/interaction-ledger.mjs plan --plan docs/assets/shots/interaction-ledger.json`
before capture to prove the plan remains exact and pending. Use
`node scripts/interaction-ledger.mjs validate` or `promote` only after the frozen candidate and
real evidence exist. Run `node scripts/check-design-parity.mjs --self-test` to exercise the
parity inventory's exact negative boundaries before accepting any pair.

## Known open evidence gaps

- All ten design-parity receipts are `pending-runtime`; no reference PNG, built PNG,
  side-by-side image, or visual-diff record exists yet.
- The packaged interaction ledger is a pending plan, not a verified capture ledger.
- The older general and packaged captures predate the frozen-candidate requirement and are not
  accepted as current proof for this audit.
- No frozen packaged candidate, executable digest, installer digest, or cheap-headless launch
  receipt has been supplied to this evidence lane.
