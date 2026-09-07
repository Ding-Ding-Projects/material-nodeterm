# Capture refresh publication inventory

The broader desktop evidence obligation is tracked in
[`completeness-audit.md`](./completeness-audit.md). This inventory records the promotion boundary
and current capture refresh state, while the audit names every required interaction family.

This is the bounded public publication roster for the capture refresh. It separates a picture being present on disk from a picture being shown to a reader. The roster is hand-written so a deleted capture cannot silently leave the set being checked.

## Required desktop capture groups

| Group | Public surfaces |
| --- | --- |
| First use | launch, canvas, board, command palette, and history |
| Daily work | status, terminal-profile picker, and terminal-profile availability explanation |
| Settings | general settings, language, narrator, appearance editor, app identity, schedule, and attention accommodations |
| Child-facing flow | Kids home, grown-up gate, grown-up controls, and the Kids settings switch |
| Safety and recovery | projectless Add-node refusal, unavailable credential recovery, and targeted reset confirmation |

The README embeds the first four groups and the public-safe safety states. The site screenshot room carries the broader desktop gallery. The checks inspect Markdown image syntax and the rendered gallery data plus image-template path, so a filename mentioned in prose cannot satisfy publication coverage.

## Evidence labels

Each public caption must state whether it is recorded historical evidence or evidence for the current build. A capture is current only when its semantic evidence record binds its image hash, capture route, source commit, version, viewport, scale, theme, language, and build kind. A historical image may remain published when it documents a release or past state, but its caption must name that relationship plainly.

The capture refresh does not infer freshness from filesystem timestamps. Checkout materialization can make an old file look new. The evidence record and image hash decide what the image proves.

## Follow-up capture inputs

The full refresh needs semantic evidence records for every roster entry. The capture owner must supply the image hash, source commit, running version, route, viewport, scale, theme, language, and built, packaged, or installed classification. The documentation publisher then changes an image label to current only after that record validates.

## Frozen-build two-pass ledger

[`docs/assets/shots/interaction-ledger.json`](../assets/shots/interaction-ledger.json) is the
bounded pending-provenance roster for the desktop interaction refresh. It is intentionally not a
completed interaction receipt. Its `null` provenance fields, empty click list, empty clipping
matrix, and `capturesRecorded: false` mean exactly that no one has yet driven or photographed the
listed states.

Pass one freezes one complete source commit and one packaged executable. It records the executable
SHA-256, the optional installed `Setup.exe` SHA-256, and a successful receipt from the approved
headless desktop route. Pass two uses that same frozen build to collect only observed before/after
states, privacy verdicts, PNG bytes, dimensions, and hashes. A later operator transcribes those
observations into the strict `status: "verified"` ledger accepted by
`scripts/interaction-ledger.mjs`, validates it against the independently supplied commit and
executable, and promotes it atomically.

The pending roster fixes the scope without pretending to have proof: 108 representative language,
theme, viewport, and display-scale tuples (3 × 3 × 3 × 4), the five required no-clipping rows, and
all ten design-reference tuples. It must remain pending until every claim has real, frozen-build
provenance. A failed or incomplete runtime pass remains pending or failed, never "current".
