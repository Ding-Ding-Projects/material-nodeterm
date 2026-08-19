# MD3 render verification

The MD3 rewrite shipped on a green typecheck and a green build, but nobody had run the app's own
built-artifact harnesses (`npm run shots`, `npm run check:wired`) since the rewrite landed, and
nobody had looked at a single rendered pixel of it. This document records what was actually run,
what was actually seen, and what remains unverified — against commit `38280b0b` on this branch.

Everything below was produced by launching the real built `out/` artifact in a real Electron
process, driving it over the Chrome DevTools Protocol (the same method `scripts/check-app-wired.mjs`
and `scripts/capture-shots.mjs` already use), and reading the results back — screenshots, computed
styles, `document.fonts`, and raw sampled pixels. No claim below is inferred from source alone.

## What it looks like

A document about whether pixels render should show the pixels. These are the real captures —
the same files `npm run shots -- --launch` writes, taken from the built `out/` artifact over CDP
at commit `8e37e640`, never a mockup and never a crop of the prototypes in `design/`.

| | |
| --- | --- |
| ![The nodeterm app at launch: a 64px top app bar carrying the brand mark, project switcher and docked search, an 88px left nav rail with its FAB, and the empty canvas with its dot grid](./assets/shots/app-01-launch.png) | ![The canvas with the sessions sidebar open, zoom and lock controls bottom-left and the minimap bottom-right](./assets/shots/app-04-canvas.png) |
| **At launch** — app bar and nav rail are the whole chrome; the project tab strip and bottom dock are gone. | **The canvas** — the FAB owns node creation, and Canvas is a rail destination rather than a default. |
| ![The History screen inset behind the app bar and nav rail, with Session memory, Settings history and Changelog tabs](./assets/shots/app-06-history.png) | ![The Language settings section showing the English/Cantonese/Bilingual segmented button and two funny-level sliders](./assets/shots/app-settings-language.png) |
| **History** — inset at 88px left and 64px top, so the rail stays the way out. | **Language** — the segmented button here is the one that exposed the dead primitive sheet (below). |

The Language capture earned its place: for one build it showed three **white boxes** where the
segmented button should be. That was not a styling slip in the component — it was the entire
`ui/md3/primitives.css` failing to reach the bundle (`mdx-seg` appeared **0** times in every built
CSS file), because `ui/SegmentedPill.tsx` deep-imports `./md3/SegmentedButton` and bypasses the
barrel that imports the stylesheet. A green build, a green typecheck and 8,551 green tests all
missed it. One screenshot did not. Guarded now by
`src/renderer/ui/md3/primitives-wired.test.ts`.

## What was fixed as part of this pass

Two harness defects were found and fixed in the same commit as this document, both against the
repo's own stated rule that a check must assert a real consequence and a required surface must
actually be reachable.

1. **`scripts/check-app-wired.mjs`'s `theme-token` check false-failed.** It moved only `--accent`
   and watched a real `Switch` component's background for a change. Post-MD3, the Switch's ON
   background reads `var(--md-primary)` (`.md3-switch[aria-checked='true']` in
   `styles.md3.css`) — `styles.md3.css` never references `var(--accent)` anywhere (`grep` count:
   0). The two stay in sync only because a genuine accent change runs through
   `lib/accentTokens.ts`'s `applyAccentTokens()`, which republishes the whole derived family
   (`--md-primary` included) in one call — moving `--accent` alone no longer proves anything, since
   nothing in the redesigned CSS reads it directly any more. Fixed by moving both `--accent` and
   `--md-primary` together, mirroring exactly what `applyAccentTokens()` does for a real accent
   change. Verified: `check:wired` went from 5/6 to 6/6, with the fixed case now reporting
   `Switch background followed --accent/--md-primary (#D0BCFF → rgb(1, 2, 3))`.
2. **`scripts/capture-shots.mjs --launch` could never capture the kanban board.** `--launch` boots a
   genuinely fresh, isolated sandbox profile (`createAppSandbox()` — no prior projects), and
   `ProjectSwitcher.tsx`'s board toggle only renders `{activeProject && <button
className="tab__board-toggle">}`. A profile with zero projects can never satisfy that selector, so
   the required `app-05-kanban` capture failed every time with `opener ".tab__board-toggle" is not
   in the DOM` — not a stale selector, a state the harness never reached. (The previously-committed
   `app-05-kanban.png`, dated 2026-08-15, was captured via `--attach` against an already-populated
   dev profile with a real "Project 1" and a "Terminal 1" node on it — a different code path that
   never exercises the fresh-sandbox case.) Fixed by adding one step: after dismissing onboarding,
   click `.md3-welcome__card--primary` ("New project") if present, before proceeding to the rest of
   the capture sequence. Verified: the run went from `captured 5 skipped 2 failed 1` to `captured 6
   skipped 2 failed 0`.

With both fixed, `npm run build && npm run check:wired` is 6/6 and `npm run shots -- --launch` is
6/6 required + 2 legitimately-skipped (needs a real agent CLI session; needs a reachable SSH host).
Fresh captures are committed under `docs/assets/shots/`.

## Real defect found: the shared modal/drawer scrim never got re-themed for light mode

This is the headline finding of the pass, found by literally setting `data-theme="light"` (the same
attribute `App.tsx` writes: `document.documentElement.dataset.theme = appTheme`) and looking.

**Symptom.** With any drawer/dialog open (Explorer, Settings, Source Control, the command palette,
Shortcuts, a confirm dialog, the destructive-action gate) and light theme active, the canvas behind
it renders as a flat, muddy medium-gray band instead of the light theme's near-white surface. Every
drawer's own content correctly re-themes to light; only the dimmed area behind it does not.

**Root cause.** Six selectors across `src/renderer/styles.css` share one hardcoded, theme-blind
scrim colour, `rgba(10, 12, 18, X)` at varying alpha, with no light-theme override anywhere:

| Selector | Line | Alpha | Surface |
| --- | --- | --- | --- |
| `.drawer-overlay` | 4157 | 0.4 | Explorer / Settings / Source Control right-side drawer |
| `.confirm-overlay` | 5034 | 0.55 | Confirm dialog |
| `.sc-overlay` | 5569 | 0.5 | Shortcuts panel |
| `.palette-overlay` | 5646 | 0.45 | Command palette |
| `.destgate-overlay` | 11853 | 0.6 | Destructive-action super-confirmation gate |
| `.destgate-overlay--anchored` | 11859 | 0.35 | Anchored variant of the above |

(`--minimap-mask`, the seventh `rgba(10, 12, 18, …)` literal in the file at line 206, is **not**
broken — it is correctly re-declared with its own light value at line 304, the same pattern the six
above are missing.)

This is not a fresh oversight; `styles.css` already carries a comment at the `.palette-overlay`
declaration (line 5646) explaining that `--md-scrim` (which already has correct per-theme values —
`rgba(0,0,0,0.6)` dark, `rgba(0,0,0,0.32)` light) was deliberately **not** substituted in, because
doing it for one of the ~20-ish shared-scrim call sites without doing the rest would desync it from
its siblings. That reasoning holds for internal consistency across dark-theme-only testing, but the
redesign's light theme was evidently never checked against it: the six sites are visually consistent
with each other and simultaneously wrong together, in the same way, the moment light theme is on.

**Evidence.** Pixel-sampled from a real capture (`.drawer-overlay` behind the Explorer panel, light
theme, six independent points across the dimmed region):

```
expected (the theme's own --md-surface, confirmed via getComputedStyle): rgb(254, 247, 255)
sampled from the rendered screenshot:                                     rgb(156, 153, 160)
```

`rgb(156,153,160)` is almost exactly the 50% blend of `rgb(254,247,255)` with a near-black colour —
consistent with a ~40% opacity near-black scrim sitting on top of the correctly-light canvas
underneath (confirmed separately: `getComputedStyle(document.querySelector('.react-flow'))
.backgroundColor` reports `rgb(254, 247, 255)` even while the drawer is open — the canvas itself is
never wrong, only what's painted over the top of it).

**Why this wasn't fixed in this pass.** The mechanical fix (`color-mix(in srgb, var(--md-scrim) N%,
transparent)`, the pattern already used elsewhere in `styles.md3.css`, e.g. line 2847) needs a
per-site alpha chosen to preserve each surface's existing visual weight relative to its siblings —
different sites were deliberately given different alphas (0.35 through 0.6) for different urgency,
and collapsing them onto `--md-scrim`'s own two fixed alphas would flatten that. That's six
individually-judged values needing individual before/after visual comparison in both themes, which
is a real design pass, not a one-line find-and-replace — outside this lane's "small and unambiguous"
bar. Reported here instead, with the exact selector list and line numbers so the fix is a direct
follow-up rather than a rediscovery.

## Everything else checked

All of the following were driven against the real built app over CDP; screenshots referenced below
were saved to a scratch location during the pass and are not committed (only the harness-produced
`docs/assets/shots/*.png` are committed, per rule — this document's own evidence is described in
text with the exact numbers measured).

- **Window drag region.** `-webkit-app-region: drag` is on `.md3-app-bar` (`styles.md3.css`); every
  button, input, `.md3-switcher-menu`, and `.md3-fab-menu` inside it is explicitly `no-drag`.
  Verified live: `getComputedStyle(document.querySelector('.md3-app-bar'))
.getPropertyValue('-webkit-app-region')` → `"drag"`; the same check on a button inside it →
  `"no-drag"`. **Not independently verified**: actually dragging the OS window requires real mouse
  input against the native window frame, which a CDP-driven emulated-viewport session cannot
  exercise — this is a static-computed-style proof, not a drag-and-observe-the-window-move proof.
- **Windows caption-button alignment with the 64px bar.** `main/index.ts` sets
  `titleBarOverlay.height` from the shared `APP_BAR_HEIGHT` constant (`src/shared/layout.ts`,
  `64`), and `styles.md3.css`'s `--app-bar-h: 64px` matches it (also declared, redundantly but
  consistently, in `styles.css`). Both values agree at 64. **Not independently verified**: CDP's
  `Page.captureScreenshot` against an emulated viewport does not include the OS-composited
  titleBarOverlay caption buttons at all (they're drawn by the platform, not by Chromium's page
  renderer), so no screenshot in this pass can show whether the buttons visually line up with the
  bar. Confirming this needs a real OS-level window capture (e.g. an actual screen/window
  screenshot tool against the live HWND), which this pass did not attempt.
- **Outfit Variable font.** `document.fonts.check('16px "Outfit Variable"')` → `true` once real text
  had rendered (Settings has enough of it); `document.fonts` lists two `Outfit Variable` entries
  (the Latin and Latin-extended subsets from `fonts.css`) with one reporting `loaded`. **Zero** CSP
  violations were observed in the console log across the whole session (`Log.entryAdded` /
  `Runtime.consoleAPICalled` messages matching `content security policy|refused to load|CSP`: 0).
- **Material Symbols Rounded font + FILL axis.** `document.fonts.check('16px "Material Symbols
Rounded"')` → `true`. A live `.msr` element (found inside the opened Explorer panel, one of the
  font's few current consumers alongside Source Control, the file converter, the Ollama manager,
  Git history, `BranchSelect`, `ConflictBar`, and the two-key export gate) reports a real,
  per-instance `font-variation-settings` of `"FILL" 0, "GRAD" 0, "opsz" 20, "wght" 400` — a value
  that differs from `.msr`'s own CSS-default `opsz: 24`, which is only possible if the component is
  genuinely setting the axis inline per instance rather than the variable axis having been
  "instanced away" into one static face. The rendered glyphs (refresh/close icons in the Explorer
  header) show as real shapes in the captured screenshot, not tofu boxes.
- **Roboto Mono.** Reports `unloaded` in every check this pass ran — correctly: nothing in this
  pass ever opened a terminal or a Monaco editor, the font's only two consumers, so
  `font-display: swap` never had a reason to fetch it. This is expected lazy-load behaviour, not a
  defect; it was not re-verified with a terminal actually open.
- **Nav rail.** Visible and clickable at every surface tried (canvas, kanban board, Settings,
  Explorer, command palette, both themes, both widths tested). Confirmed reachable *while the
  kanban board is up* specifically (`app-05-kanban.png`): the rail renders at full width with
  "Board" shown active, not hidden or covered by the board's overlay.
- **`Shift+1` (fit view) vs. the nav rail.** `fit-view.ts`'s own comment states the rail is
  deliberately *not* listed in `CANVAS_CHROME_SELECTOR` because it's "a real flex sibling of
  `.flow-wrap`... adding it as an obstacle too would double-count it." Verified structurally, not
  just by comment: `.md3-canvas-row` is `display: flex` with `.md3-nav-rail { flex: 0 0
var(--nav-rail-w) }` and `.flow-wrap { flex: 1 }` as its only two children. Verified live:
  `getBoundingClientRect()` on both at runtime gives `railRight: 88, wrapLeft: 88, railWidth: 88,
overlap: false` — the flow-wrap's content box starts exactly where the rail's ends, with zero
  overlap, confirming the rail genuinely narrows the canvas area rather than floating over it.
- **Light theme walk.** Canvas, a settings page, the command palette, the kanban board, and (see
  above) every drawer/dialog scrim were all checked with `data-theme="light"` active. Every surface
  correctly re-themed **except** the shared scrim (above). No control was found still painting a
  literal dark-theme colour outside that one shared component.
- **Layout at 1280×800 and at a narrow width (900×700).** Screenshots taken at both sizes with a
  project open, the Explorer drawer open, and the sessions panel open simultaneously (the most
  crowded state this pass produced) show no clipped, overlapping, or off-screen controls at either
  size. `document.documentElement.scrollWidth === window.innerWidth` at both sizes (900 and 1280 —
  no horizontal overflow introduced by the new chrome at either width.

## Not verified in this pass

- Actual OS-level window-frame capture (native Windows caption buttons, real mouse-driven window
  drag) — needs a real screen/window screenshot tool against the live HWND, not CDP's emulated
  viewport. See the two bullets above.
- Any state requiring a real agent CLI session or a reachable SSH host (`capture-shots.mjs`'s own
  two skipped, non-required surfaces: `app-agent-running`, `app-ssh-project`).
- Roboto Mono's actual glyph rendering with a terminal open (only its lazy-load-unloaded state was
  observed, correctly, with no terminal open).
- A full visual sweep of every one of the app's dozens of dialogs/menus in light theme beyond the
  drawer/palette/confirm/destgate set explicitly tested above; the scrim defect is systemic to the
  six selectors named, and it is reasonable to expect any other consumer of the same class names to
  share it, but each was not separately screenshotted.
