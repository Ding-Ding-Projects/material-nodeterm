# Bulk actions everywhere

Every list, table, grid and collection supports bulk actions. Selecting one item and repeating an
action forty times is the app failing to do its job.

Files:

| Layer | File |
|---|---|
| Pure selection model | `src/renderer/lib/bulkSelection.ts` |
| Reusable toolbar (select-all/invert/clear + action buttons) | `src/renderer/components/BulkActionBar.tsx` |
| Reviewable preview before an action runs | `src/renderer/components/BulkActionPreview.tsx` (built on the app's existing `ConfirmDialog`) |

## The selection model

`src/renderer/lib/bulkSelection.ts` is a small, pure state machine with no React or DOM
dependency, so it is trivially unit-testable on its own:

- **Click** (`toggleOne`) toggles one row and becomes the new shift-click anchor — the same
  convention as Finder/Explorer/GMail: the anchor always follows the last deliberate click.
- **Shift-click** (`selectRange`) selects every row between the anchor and the clicked row,
  **in the caller's current `visibleIds` order** — not an index captured at click time — so it
  tracks a re-sorted or re-filtered list correctly.
- **Select all** (`selectAll`) and **invert** (`invertSelection`) operate over whatever
  `visibleIds` the caller currently has.
- **Prune** (`pruneSelection`) drops ids that no longer exist after a refresh, so a stale id never
  lingers in the "N selected" count once its row is gone.

### "This page" vs "every match"

None of nodeterm's bulk-action-worthy lists in this repository paginate. The session-memory
panel's own header comment states the invariant directly: *"Every row is rendered. A cap would
have to announce itself."* The local-history panel does not paginate either. So there is no
separate "this page" set for "select all" to be ambiguous against — **`selectAll` always means
every row currently matching the active filter**, and every surface using it states that plainly
in its label ("Select all (N matching)") rather than leaving the meaning to be inferred. A future
surface that *does* paginate must decide and document which of the two "select all" means, per the
brief's instruction — do not silently reuse this module's current behaviour without re-reading
this note.

## Say what will happen before it happens

`BulkActionBar` never runs an action directly from its button — every click opens
`BulkActionPreview`, which:

- States the exact count: `"End sessions: 5 items."`, or when some rows are excluded,
  `"End sessions: 3 of 5 selected will change."` — the "42 selected" vs "39 will change"
  distinction the brief calls out by name.
- Lists every affected item (capped at 12 with a "+N more" line so the dialog itself never grows
  unbounded).
- Lists every **excluded** item and *why* it is excluded, separately — an action's `excluded`
  callback computes this before anything runs, so a bulk action never silently skips a row without
  saying so.
- Uses a **blocking** confirmation (`ConfirmDialog`, `danger` styling, no Enter-to-confirm) only
  for actions marked `destructive`. A purely informational action (export) still shows the same
  preview, but may be confirmed with Enter — consistent with this app's existing rule that a
  blocking dialog is reserved for a decision the user must make before continuing.

## Partial results, honestly

`BulkAction.run()` returns `{ succeeded: T[]; failed: { item: T; reason: string }[] }`. The bar
merges the up-front `excluded` list into `failed` before handing the result to
`onActionComplete`, so the caller's summary is always complete: *N succeeded, M excluded, K
failed* — never a bare "Done" that quietly drops the rows that did not actually change. A
long-running action is expected to report through this same shape rather than claiming success
for the whole batch when only part of it went through.

## Where it is wired today

- **Session memory panel** — checkbox per row, `BulkActionBar` with a single action ("Export
  selected") wired through the shared export module (see `docs/exports.md`). See the deliberate
  scope note on bulk **kill** below.
- **Local settings history** — checkbox per revision, the same bulk export action over the
  currently filtered set of history entries.

### Deliberately deferred: bulk "End sessions"

The session-memory panel's single-row "end session" (`onKillSession`) already opens its own
`ConfirmDialog` per call (`Canvas.tsx`'s `killSessionById`/`closeSession`), driven by a **single**
piece of `confirm` state on the canvas. Calling it N times in a bulk loop would not queue N
confirmations — React batches the state updates, so only the *last* call's dialog would ever show,
and every earlier call's confirmation would be silently lost. That is worse than not offering bulk
kill at all: it would look like a working bulk action while actually discarding everything but the
last row.

A correct bulk kill needs either a confirmation queue in `Canvas.tsx` or a new,
confirmation-free "commit" path duplicated out of `closeSession`/`killSessionById` — both are real
surgery in the single most invariant-laden file in this codebase (see `CLAUDE.md`'s own extensive
"gotchas" list for `Canvas.tsx`, and its explicit warning about several agents editing that file
concurrently). Given the size of this lane, that surgery was **not** attempted; bulk export was
implemented instead, since it needed no changes to the existing kill/confirm architecture at all.
A future pass adding a real confirmation queue to `Canvas.tsx` can wire `onKillSessions` as a new
`BulkAction` here with almost no changes to this file.

## Extending to a new list

1. Track selection with `useState<BulkSelectionState>(emptySelection())`, prune it in a `useEffect`
   keyed on the list's current ids.
2. Render a checkbox per row wired to `toggleOne`/`selectRange` (shift-click).
3. Render `<BulkActionBar>` with `visible`, `idOf`, `selectedIds`, the three selection callbacks,
   and an `actions` array. Each action's `run()` must return the honest partial-result shape above
   — never resolve `void` and let the caller assume everything succeeded.
