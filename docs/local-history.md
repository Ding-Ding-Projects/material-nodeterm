# Local version history for user-managed records

Every app-owned, user-managed record gets a local, git-backed, append-only version history: any
creation, edit or deletion can be undone, and every restore is itself a new, undoable revision.
This extends the principle CLAUDE.md already states for documents to **settings** — accounts
(managed Claude identities), custom agents, and every other field in `settings.json`.

Files:

| Layer | File |
|---|---|
| The git-backed store (record/list/restoreContent) | `src/core/local-history.ts` |
| Shared types (`HistoryEntry`, `HistoryAction`, `HistoryFilters`, …) | `src/shared/local-history.ts` |
| IPC registration (both shells) | `src/core/local-history-handlers.ts` |
| Settings-specific diff → label | `src/shared/settings-diff.ts` |
| Settings-store wiring (record on save, apply a restore) | `src/core/settings-store.ts` |
| Desktop boot wiring | `src/main/index.ts` |
| Server Edition boot wiring | `src/server/handlers/index.ts`, `src/server/index.ts` |
| Filterable panel (date range, action filter, restore, bulk export) | `src/renderer/components/LocalHistoryPanel.tsx` |
| Settings surface | Settings → **History** (`src/renderer/components/settings/sections/LocalHistorySection.tsx`) |

## One isolated repository per domain

`LocalHistoryStore` keeps one plain (non-bare) git working repository per **domain**, at
`<userDataDir>/local-history/<domain>/` — beside the app's own data directory, **never** inside a
project the user owns, and never the project's own `.git`. Today there is exactly one domain,
`'settings'`, holding `settings.json`.

The repo's commit identity (`user.name`/`user.email`) is set **locally**, inside that repo only —
never the user's global git config. `git init` runs once, lazily, on first use.

## Append-only, always

Every save that actually changed something writes **one new commit**. Restoring an old revision
(`SettingsStore.applyRestoredSettings`) runs the restored content back through the **normal save
path** — it is recorded as a brand-new commit, labelled `"Restored settings to <shortsha>"` with
action `'restored'`, never a `git reset`/`git checkout` that would rewrite or lose history. That is
the whole point: a restore can itself be restored away from later, and the one thing this history
can never do is destroy a revision that already landed.

## A write must never break the operation it is recording

`LocalHistoryStore.record()` **never throws**. A failed git call (git not installed, a locked
repo, a full disk) is logged to the console and swallowed — `SettingsStore.saveNow` wraps the
recorder call in its own `try`/`catch` too, belt and braces, so a history-layer failure can never
turn a real settings save into a failed one. `restoreContent()` (reading an old revision back) is
the one method that *does* throw: it is a read the caller is actively waiting on to complete a
restore the user just asked for, so a failure there has to reach the user rather than vanish the
way a background `record()` failure does.

An **unchanged save records nothing.** `describeSettingsChange` (see below) returns `null` when
nothing actually differs, and `SettingsStore` never calls `record()` in that case — "an unchanged
state records nothing" starts before `local-history.ts` is even reached.

## Labels say what changed, not that something did

`src/shared/settings-diff.ts`'s `describeSettingsChange(before, after)` is pure and
Electron-free. It diffs the two special array fields **by id** so an add/remove reads as exactly
that:

- `claudeAccounts` → `Added Claude account "acme@example.com"` / `Removed Claude account "…"` /
  `Updated Claude account "…"` (a field changed on an existing id, e.g. its label).
- `customAgents` → the same three phrasings for `"agent"`.

Everything else falls back to a generic `Changed 3 settings (fontSize, accent, theme)` rather than
a bare `"Updated"` — the brief's own example (`"Deleted the GitHub account", not "Updated"`) is
exactly what the id-diffed fields produce; the generic fallback is honest about being less
specific for the rest of `settings.json`, rather than inventing per-field labels for every one of
its ~80 fields.

When several kinds of change land in one save, the label lists all of them (joined with `; `), and
the **action** used for filtering is prioritized created → deleted → updated, so a save that both
adds and removes an account still shows up under both filter checkboxes' underlying data while
carrying one clear label.

## The filter derives from what actually happened

The history panel's action checkboxes are **not** a hard-coded list. `LocalHistoryPanel` builds
them from the distinct `action` values actually present in the loaded entries, with a live count
next to each — so the checkboxes can never drift from what `local-history.ts` actually records,
and a domain that has never recorded a `'deleted'` action simply has no "deleted" checkbox to
show. `HistoryAction` (`src/shared/local-history.ts`) documents this directly: it is a union of
the values this codebase's callers currently use (`created` | `updated` | `deleted` | `restored`),
not a closed enum the UI is required to fully cover.

The date range, the action checkboxes and the text search **compose** — narrowing the same list
together, never overriding one another. Date parsing (`parseBoundary` in `LocalHistoryPanel.tsx`)
accepts both the browser's native `yyyy-mm-dd` and a hand-typed plain ISO timestamp, and reports
an invalid entry inline **without discarding what was typed** (the input's own value is never
reset by a parse failure).

### A scoped simplification: native date inputs, not a bespoke calendar

The filter's date range uses the platform's native `<input type="date">` plus four named presets
(Today / Last 7 days / Last 30 days / All time) rather than a fully custom anchored calendar
widget with month/year jump and range-drag selection. This is a real, deliberate simplification
for this pass — recorded here rather than left silent. It is a genuine date picker (keyboard- and
screen-reader-operable, accepts typed input, has named presets), just not the bespoke calendar
component the fuller specification describes. A later pass building a shared calendar-popover
component for the whole app (the SCM commit history could use the same one) should retrofit it
here rather than building a second one from scratch.

Likewise, the text search here is a plain substring filter, not the full anchored regex builder
the project's universal search-bar convention calls for elsewhere — a real, separate, sizeable
feature area of its own that was out of scope for this lane. Wiring the shared regex builder in
here is a natural next step and does not require changing the filtering `useMemo` itself, only the
predicate it calls.

## Credentials never enter a snapshot

This module has no opinion on the byte content it is handed — the guarantee comes from what
`settings.json` actually contains. Every place a credential is involved in this codebase already
avoids putting it in `Settings`: `ClaudeAccount`'s own doc comment states directly that "the claude
CLI owns login, credential storage, and token refresh… we never write credentials", and the same
holds for every other credential this app manages (SSH keys, GitHub tokens, node-auth secrets) —
none of them live in the object this module snapshots. Any **future** domain added to
`local-history.ts` must keep the same discipline; this file is the place to say so before one
doesn't.

## Registered on both shells

`registerLocalHistoryHandlers` (and `registerVsCodeHandlers` — see `docs/exports.md`) are wired
identically in `src/main/index.ts` (Desktop) and `src/server/handlers/index.ts` (Server Edition),
over the same `platform.handle` seam every other core service in this codebase uses — so the
Server Edition's browser gets the exact same settings history, acting on the **server's own**
`userDataDir`, not the desktop's. A relay tab (`src/renderer/bridge/relay-api.ts`) is not
special-cased: `history`/`vscode`/`export` all stay on `...local` there, the same as `settings`
already does — a relay guest's settings history is the guest's own machine's history, never the
remote host's.
