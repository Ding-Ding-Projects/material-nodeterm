# Regex builder

nodeterm ships a real, in-app regex builder — not a link to an external site — and a shared
"plain text by default, regex as an explicit opt-in" contract that every search field in the app
is meant to carry. This document is the reference for the engine it speaks, how the anchored
presentation works, its safety bounds, and the exact steps for wiring a new search field into it.

## The engine and dialect

Every pattern compiles with native **JavaScript `RegExp`** (ECMAScript syntax) — exactly
`new RegExp(pattern, flags)`, in the renderer. Nothing is translated to PCRE, RE2, POSIX, or any
other dialect; the builder says so in its own UI (`REGEX_ENGINE_NAME` / `REGEX_ENGINE_NOTE` in
`src/renderer/lib/regex/engine.ts`), so that claim can't silently drift out of sync with reality.

Supported flags (`src/renderer/lib/regex/engine.ts`): `g` (global), `i` (ignore case), `m`
(multiline), `s` (dot-all), `u` (unicode), `y` (sticky) — the builder's flag row toggles all six,
each with a plain-English description on hover.

## Where the code lives

```
src/renderer/lib/regex/
  engine.ts               — engine identity, bounds, flag metadata, escapeForRegex
  safety.ts                — compilePattern, looksCatastrophic heuristic, compileForInlineFilter
  matcher.ts                — runMatches: pure match+capture-group extraction, zero-width-safe
  highlight.ts               — splits sample text into plain/match segments for rendering
  regexEvalWorker.ts          — the Worker script the builder's live preview runs inside
  useSafeEval.ts               — Worker lifecycle + hard time budget for the live preview
  useRegexSearchField.ts        — the shared {mode, query, pattern, flags} state machine

src/renderer/components/regex/
  RegexBuilder.tsx           — the builder UI itself (guided insert, raw editor, samples, matches)
  AnchoredRegexBuilder.tsx     — the `.*` trigger + AnchoredPopover wrapper a search field embeds
  insertTokens.ts               — the guided-construction token palette (literals, classes, …)

src/renderer/components/menu/
  useMenuFilter.ts             — the same contract, scoped to filtering a list of menu items
  FilterableMenu.tsx             — <FilterableMenuHeader>, the filter-field-in-a-menu component

src/renderer/ui/AnchoredPopover.tsx — the generic "attached to a field, not a modal" overlay
```

## The anchored presentation is the default, not a modal

`<AnchoredRegexBuilder search={...} fieldRef={inputRef} />` renders a small `.*` button. Clicking
it switches the field to regex mode and opens the **full builder** in an `AnchoredPopover` — a
non-modal overlay that stays visually attached to the field it belongs to:

- It never sends the user to a separate page or a detached global dialog. A cramped width still
  gets the same anchored popover; there is no separate "modal fallback" path in this codebase
  today because every search surface this lane touched had room for it. If a future surface
  genuinely cannot host an anchored popover, fall back to a modal there and return focus to the
  field on close — the same rule `AnchoredPopover` already follows.
- Each field gets **its own** builder instance bound to that field's own `useRegexSearchField()`
  state. There is no global/shared regex state anywhere in this lane — two fields on one screen
  can be in different modes with different patterns at once, and closing one never touches the
  other.
- Escape closes the popover (not the surface underneath it — see the overlay rules below) and
  returns focus to the field/button that opened it (`AnchoredPopover`'s `wasOpen` ref).

### Overlay rules this codebase has hit before

`AnchoredPopover` (and `FilterableMenuHeader`, which sits inside a menu) exist specifically to not
repeat two bugs this project has already shipped and fixed elsewhere:

1. **Paint your own surface.** An overlay left transparent lets whatever's behind it (the canvas,
   a drawer's content) read straight through the text on top. `.anchored-pop` always has a solid
   `background: rgba(var(--menu-rgb), 0.98)`, a border, and a shadow — never inherited/transparent.
2. **Bound by the viewport, and scroll, don't clip.** Capping a popover's height and then hiding
   overflow silently deletes content past the cap with no scrollbar to say anything is missing.
   `AnchoredPopover` measures the anchor and available space on open (and on resize), flips above
   the anchor when there's more room there, and sets an explicit `maxHeight` on its own
   `.anchored-pop__scroll` container — the content scrolls, it never gets silently cut off.
3. **Never cover the control it's anchored to.** The popover opens beside/below (or above, when
   flipped) the field — never on top of it.
4. **Stacking order matters when the field itself lives inside another elevated overlay.** Two of
   this project's own branch-picker context menus render at `z-index: 80`
   (`SourceControlPanel.tsx`). `AnchoredPopover`'s own default z-index (62) would render the regex
   builder **behind** that menu — invisible, not merely clipped. `AnchoredRegexBuilder` and
   `FilterableMenuHeader` both take an optional `zIndex` prop for exactly this; `ContextMenu`
   passes its own `zIndex + 2` through automatically so a caller never has to remember.

## Safety: two different budgets for two different jobs

Patterns are evaluated **locally only** — nothing is ever transmitted, and nothing outlives the
component's own in-memory state (no localStorage, no IPC, no network). Sample/pattern sizes are
capped (`MAX_PATTERN_LENGTH` 500, `MAX_SAMPLE_LENGTH` 20 000, `MAX_FILTER_CANDIDATE_LENGTH` 300 for
inline filters), and the builder's match list stops at `MAX_MATCHES` (500) rather than rendering an
unbounded number of `<mark>` spans.

Catastrophic backtracking — a pattern like `(a+)+$` against a long non-matching string — can spin a
single synchronous regex call for an unbounded amount of time. JavaScript has no way to interrupt a
running synchronous call from the same thread, so this app uses **two different, honestly-scoped**
mitigations depending on where the pattern is about to run:

- **The builder's own live-match preview** (the sample-text matcher inside `RegexBuilder.tsx`) is
  the one place a user is expected to paste an arbitrary, possibly-adversarial pattern and press
  go. It runs inside a dedicated **Web Worker** (`regexEvalWorker.ts`) with a hard wall-clock
  budget (`MATCH_TIME_BUDGET_MS`, 800 ms — `useSafeEval.ts`). If the worker hasn't answered in
  time, it is terminated and a fresh one is created for the next request. A pathological pattern
  here can only ever hang its own Worker thread and, from the user's point of view, its own
  preview panel — the renderer's main thread, and the rest of the app, stay responsive throughout.
  This is real protection, not a heuristic.
- **Every inline/synchronous filter surface** (menus, the Explorer tree, the command palette,
  settings rows) has no time to spare for a message round-trip on every keystroke against every
  row. These run `compileForInlineFilter` (`safety.ts`), which refuses to compile a pattern the
  static heuristic `looksCatastrophic` flags as shaped like a classic blowup — nested quantifiers
  (`(a+)+`, `(a*)+`, `(a|ab)+`) or a chain of unbounded wildcards (`.*.*`). **This is a heuristic,
  not a proof**: it can flag a safe pattern, and it can miss a pathological one it doesn't
  recognize. Every one of these surfaces **fails open** on a refused or invalid pattern — it shows
  everything rather than hiding results behind a silent parse error, and the field's `.error`
  carries the reason. Combined with the short, already-bounded candidate strings these surfaces
  filter against (a menu label, a filename, a setting title — all naturally well under
  `MAX_FILTER_CANDIDATE_LENGTH`), the practical risk is low; it is not the same guarantee the
  Worker gives the builder, and this file says so rather than pretending otherwise.

Zero-width matches (a pattern like `a*` matching an empty string at every position) are handled by
manually advancing `lastIndex` by one after an empty match in `runMatches` — without this, a
`g`-flagged regex that matches empty strings never advances and spins forever even on a
correctly-terminating pattern.

## Adding the builder to a new search field

Most fields need three pieces:

1. **State**: `const search = useRegexSearchField()` (or, if the surface already manages its own
   mode/pattern/flags — like `useTerminalSearch` does — expose a structurally-compatible
   `RegexBuilderBinding: {mode, pattern, flags, setMode, setValue, setFlags}`).
2. **The input**, bound to `search.value` / `search.setValue`, with a `ref` you also hand to...
3. **`<AnchoredRegexBuilder search={search} fieldRef={inputRef} label="Regex — <where this is>" />`**
   rendered right beside the input.

Then filter/match your candidates with `search.test(candidate)` — it does a substring test in text
mode and a real (fail-open, heuristic-guarded) regex test in regex mode, so callers never need to
branch on `search.mode` themselves. Show `search.error` somewhere near the field when it's set.

If several regex-capable fields can be open on one screen at once, give each `AnchoredRegexBuilder`
a distinct `label` (its accessible name) — see `SettingsSidebar.tsx`, `ExplorerPanel.tsx`,
`CommandPalette.tsx`, and `FindBar.tsx` for four different real examples of this wiring.

## Wired-up search surfaces (this pass)

- **Terminal find bar** (`FindBar.tsx`, both the canvas node and the kanban card modal) — the
  active term also drives xterm's own `SearchAddon` on-screen highlight via its `regex` option, so
  the two search mechanisms (the hook's scrollback+transcript index, and xterm's live-buffer
  highlight) stay in the same mode at all times.
- **Command palette** (`CommandPalette.tsx`) — plain text keeps its existing fuzzy subsequence
  match (`"ntr"` finds `"New TeRminal"`); the `.*` toggle switches to a real pattern test against
  the same label+hint (and output-content) corpus.
- **Explorer file tree filter** (`ExplorerPanel.tsx`, new in this pass) — hides non-matching
  **file** rows only. The tree is lazy-loaded (children fetch only once a folder is expanded), so a
  directory holding an unfetched match can't be judged as "no matches inside" — hiding it would
  make a real match unreachable. Directories therefore never disappear while filtering; a one-line
  note under the filter field says so.
- **Settings search** (`SettingsSidebar.tsx` + `SearchableRow.tsx`) — the existing "search every
  section's rows by title/description/keyword" contract, now mode-aware end to end via
  `SettingsSearchContext` carrying the full `{mode, query, pattern, flags}` state instead of a bare
  string. A regex match spans title + description + keywords, same as the plain-text path.
- **`useMenuFilter` / `<FilterableMenuHeader>`** (`components/menu/`) — the reusable primitive for
  any menu/dropdown: a keyboard-focusable filter field, arrow keys to move through what survives,
  Enter to activate, Escape to clear-then-close, and a screen-reader-only live match count.
  `ContextMenu.tsx` uses it for **flat menus past 6 items** (every entry a plain clickable item —
  no separators/labels/submenu/colors mixed in): the branch/repo pickers this project already built
  a `scroll` mode for are exactly that shape. A menu with sections (separators, group labels,
  submenus) keeps rendering exactly as it did before this change — deciding what happens to a
  group's label once every row under it is filtered out is real UI work this pass didn't attempt,
  and this is stated here rather than left as a silent, undocumented gap.

## What this pass did not do

- Every dropdown/right-click menu in the app does **not** carry the filter head yet — only
  `ContextMenu.tsx`'s flat-list path does. A sectioned menu (separators/labels/submenus) needs a
  real decision about what happens to a group heading once its rows are filtered out; that's future
  work, named here rather than silently skipped.
- There is no modal fallback path for `AnchoredPopover` today (every surface wired up had room for
  the anchored presentation). If a future surface genuinely can't host it at a narrow width, add
  one there — and keep the same "paint your own surface, scroll don't clip, return focus on close"
  rules.
