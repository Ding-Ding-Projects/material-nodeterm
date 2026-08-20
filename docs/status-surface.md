# The Status surface

The **Status** destination on the nav rail opens the app's own status surface: one Material 3 card
per project gate — does it build, does the typecheck pass, what did the last test run say, what did
the last capture run photograph, what is the newest recorded release — each carrying a stable state
emoji, an honest one-line summary, and the recorded evidence behind the claim.

Files: `src/renderer/components/StatusSurface.tsx` (the screen),
`src/core/project-status.ts` (the pure derivation — see "Two homes" below),
`src/core/project-status.test.ts` (behavior + parity tests),
`src/renderer/components/status/StatusSurface.test.tsx` (interaction tests against the rendered
component). Host CSS follows the `.md3-history-host` pattern (`.md3-status-host` in
`styles.md3.css`): inset behind the app bar and the nav rail at z 27, so the rail stays clickable
as the way out.

## The one rule everything else serves

**A check that has not run is UNRUN, not passed. A verdict that has not arrived is PENDING, not
assumed.** Every card on this surface is derived from evidence the repository actually records,
and a gate whose verdict the repo does not record renders as `❔ Unrun` — naming the command that
would produce a verdict — rather than inventing a green tick. Styling never hides, softens, or
invents evidence: the emoji beside a state is scanability, never authority, and it never upgrades
an unverified state.

## The state model and its stable emoji mapping

| State | Emoji | Meaning |
| --- | --- | --- |
| Running | 🏃 | recorded as in flight (no gate can currently evidence this — reserved) |
| Waiting | ⏳ | recorded work is waiting on something (e.g. changes awaiting the next release) |
| Blocked | 🧱 | recorded as blocked (reserved) |
| Failed | ❌ | the recorded evidence says the gate failed |
| Verified | ✅ | the recorded evidence backs the card's claim |
| Unrun | ❔ | the repository records no verdict — unknown, never assumed green |

Cards sort worst-first (`GATE_STATE_ORDER`), so a failure can never hide below a pile of green.

## What each card reads, exactly

- **Built-app captures** — `docs/assets/shots/capture-manifest.json`, the provenance record
  `scripts/capture-shots.mjs` writes (commit, timestamp, method, every photographed surface with
  its bytes, every skipped surface with its reason, every failure). A recorded failure makes the
  whole card ❌ even beside successful captures; a missing or malformed manifest is ❔ (a broken
  manifest must degrade to "unknown", never to a green card built from half-read evidence); each
  skipped surface stays an ❔ row inside the evidence list.
- **Release** — `src/shared/changelog-data.ts`, the generated changelog. The card names the newest
  *dated* release (picked by date, not array position), reproduces its recorded commit links
  verbatim, and lists every "Unreleased" entry as a ⏳ lane. It deliberately **never claims release
  verification**: the changelog records that a version shipped, and nothing in the tree records a
  packaged install/update verification, so the evidence list says exactly that.
- **Typecheck / Test suite / Build + wired check / App contract scan / Site capture mirror** —
  the repository records **no verdict** for any of these, so their cards are ❔ Unrun by
  construction, each naming its command (`npm run typecheck`, `npm test`,
  `npm run build && npm run check:wired`, `node scripts/check-app-contract.mjs`,
  `node scripts/check-site-shots.mjs`). If one of these ever starts writing a committed verdict,
  teach `src/core/project-status.ts` to read it — never compute a state the repo cannot evidence.

All of it is **committed repository data bundled into the renderer at build time** (the manifest
and `package.json` through Vite `?raw` imports, the changelog through its generated module).
Nothing polls a service and nothing reads the filesystem at runtime, which is what makes the
surface identical everywhere the renderer runs. The header says so, shows the **verified
baseline** (the capture manifest's commit), the version of the tree the build came from, the
freshest recorded evidence, and a live "viewing at" heartbeat — the recorded evidence is frozen at
build time, but the *ages* beside it refresh in place, so the surface is visibly current about how
old its evidence is.

## Interactivity and accessibility

Everything that looks like a control is one (the decorative-UI rule):

- **Evidence toggle** per card — a real `<button>` with `aria-expanded`/`aria-controls`, revealing
  the facts (`<dl>`) and the per-item lanes (captured surfaces, skipped surfaces, pending
  changelog entries) inline.
- **State filter chips** — `aria-pressed` toggles with live counts per state; a zero-count chip is
  disabled and its tooltip names the unmet condition. Filtering and search compose (AND), and an
  expanded card **stays expanded across filtering** — hiding a card never forgets that you opened
  it.
- **Search field with the anchored regex builder** — the same `useRegexSearchField` +
  `AnchoredRegexBuilder` pair every other search surface uses: plain text by default, regex as an
  explicit opt-in, compile errors surfaced inline.
- The empty-filter result is an honest no-match message naming what filtered the cards out.
- Recorded commit SHAs render in full; links exist only where the repository itself recorded a URL
  (the changelog's commit links). External links open through the app's normal
  `setWindowOpenHandler` → system-browser route on desktop, and as ordinary `target="_blank"`
  anchors in a browser.

Colour is never the only signal (every state carries its emoji **and** its text label), tokens are
`var(--md-*)` only, elevation is tonal (no `box-shadow`), and focus is visible on every control.

## Two homes for one pure module (and the guard that keeps them one)

`tsconfig.node.json` and `tsconfig.web.json` are composite projects whose only shared include is
`src/shared`. A renderer import of `src/core` fails `tsc -p tsconfig.web.json` with **TS6307**
(measured on this tree, 2026-08-19), and the reverse fails the node project the same way. The pure
derivation therefore exists byte-for-byte at two paths:

- `src/core/project-status.ts` — canonical, where the tests live
- `src/renderer/components/status/project-status.ts` — the renderer's importable mirror

The parity test in `src/core/project-status.test.ts` reads both files and fails on any difference
(line endings normalized), so the mirror cannot drift silently. **Edit the core copy, then copy it
verbatim over the mirror.** Both copies import only via the `@shared` alias, which resolves
identically from either home.

## Three surfaces

- **Desktop (Electron)** — full. The Status destination on the nav rail, between History and
  Alerts.
- **Server Edition (browser)** — **works identically, by construction.** The server serves the
  same built renderer bundle, and every datum on this surface is bundled at build time; there is
  no main-process read, no `window.nodeTerminal` member, and no CorePlatform handler involved, so
  there is nothing that could silently not exist server-side. (This is why the logic did not need
  a CorePlatform seam: the evidence is committed repo data, not machine state.)
- **Mobile companion** — **not applicable in v1.** _nodeterm mobile_ (separate private repo,
  `nodeterm-ios`) has no nav rail and no canvas; it attaches to tmux sessions over the transport
  protocol, which carries no project-gate concept. Surfacing these cards there would mean
  extending that protocol — a follow-up in the iOS repo, flagged for @eneskirca.

## Failure modes

- Manifest missing/unreadable/malformed → the captures card is ❔ with a null baseline; the header
  says "no capture baseline recorded". Never a partial parse.
- `package.json` unreadable at build → version renders as "unreadable", and a version-ahead check
  simply cannot fire (no invented comparison).
- Changelog with no dated release → the release card is ❔; no published release is claimed.
- A recorded timestamp ahead of the local clock → "timestamped in the future (clock skew?)",
  never rounded to a friendly zero.

## Verification

- `npx vitest run src/core/project-status.test.ts` — 31 tests: manifest parse fail-closed cases
  (including the REAL committed manifest, so schema drift between the file and the parser is red),
  every gate-state decision, the never-verified invariants, and the two-homes parity guard.
- `npx vitest run src/renderer/components/status/StatusSurface.test.tsx` — 4 tests rendering the
  real component through the real Vite pipeline (which also proves the `?raw` imports resolve):
  card inventory, the evidence toggle, filter chips + expansion-survives-filtering, and the search
  field with its regex-builder affordance.
- Both suites were deliberately broken and watched go red before being trusted: inverting the
  captures failure branch turned the behavior test *and* the parity guard red; no-op'ing the
  expand button turned both interaction tests red. Restoring turned everything green.

## Known gaps (deliberate, recorded)

- Copy is English-only, matching the sibling `HistoryScreen`; the language-mode/funny-level pass
  over these newer screens is a shared follow-up, not a per-surface exemption.
- The surface shows what the repository records; it does not (and must not) run checks itself.
  Gates without committed verdicts stay ❔ until something starts recording one.
- `scripts/check-app-contract.mjs` needs a `status-surface` feature row registering this doc and
  the implementation files; that script is owned by a different change lane, so until the row
  lands its docs-inventory sweep reports this file as an orphan doc.
