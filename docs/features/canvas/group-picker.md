# Group picker ("Add to existing group…")

The searchable dialog that opens when a node/selection context menu offers "move this into a
group frame" — replacing what used to be one context-menu row per eligible group. Source:
`src/renderer/components/canvas/GroupPickerDialog.tsx`, wired from `src/renderer/canvas/Canvas.tsx`.

## Why a picker instead of an inlined menu list

The context menu previously listed one menu item per eligible group frame directly inline — a
"move into group" submenu that grew by one row per group frame on the canvas. That doesn't scale:
a canvas with a dozen frames turns "move node into a group" into scrolling a long, un-searchable
menu, and it repeats the same clutter-that-grows-without-bound problem the
[appearance contract](../appearance/README.md)'s move-into-group rule specifically calls out —
"a context menu never inlines a dynamic list of move-targets."

The fix is the same pattern this codebase already uses everywhere a menu could otherwise grow
unbounded: the menu carries a single **"Move… into group…"** entry (the ellipsis signaling it
opens a further surface), and that entry opens `GroupPickerDialog` — a real searchable listbox
with its own anchored full regex builder, matching the same contract every other search surface in
this app follows.

## What it is

`GroupPickerDialog` is a standalone top-level modal (portal-rendered), not something anchored to a
DOM node — the context menu that spawned it has already closed and unmounted its own portal by
the time the picker renders, so there's nothing left on screen to anchor beside. It still paints
its own opaque surface, stays inside the viewport, and is fully keyboard-operable end to end:

- **Filter field** — plain-text default, with `AnchoredRegexBuilder` available beside it exactly
  like every other search field in this app. `useRegexSearchField({ mode: 'text' })` owns the
  query/pattern/flags/mode state.
- **Arrow keys** move the highlighted row; **Enter** picks the highlighted group; **Escape**
  cancels. All three are gated on `isTop()` (`useDialogStack`) so a picker sitting behind another
  modal doesn't steal its keystrokes.
- Each `GroupPickerOption` shows the frame's title plus its **member count** ("Feature work (4)"
  vs "Feature work (empty)") — so the picker isn't just a bare name list; the count is what lets
  someone tell two similarly-named frames apart, or avoid dropping a node into an empty
  placeholder frame by mistake.
- The highlighted-row index is re-clamped whenever the filtered set shrinks (`useEffect` on
  `filtered.length`), so a query that narrows the list can never leave the highlight pointing past
  its end, or at a row `Enter` can no longer reach.

## Wiring

`Canvas.tsx` drives the dialog: it computes the eligible target groups for the current selection
(a mixed-container selection, or a selection containing an ancestor together with its own
descendant frame, is refused before the picker even opens — see the group-nesting rules in
`CLAUDE.md`'s node-kinds section), opens `GroupPickerDialog` with that list, and on `onPick` calls
the same `reparentNode`-based move logic every other "move into frame" action already uses
(`move --nodes <id> --group <id>` from canvas control, the context menu's move action, and this
picker all converge on one function). `onCancel` simply closes the dialog with no side effect.

## Suggested articles

- [Canvas and lifecycle](canvas-and-lifecycle.md) — group frame nesting, `reparentNode`, and the
  mixed-container/ancestor-descendant refusal rules this picker's target list respects.
- [Node kinds](node-kinds.md) — the `group` node kind this picker's targets are drawn from.
