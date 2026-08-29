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

The fixed commit identity is supplied to each internal Git subprocess through that subprocess's
environment — never the user's global Git config and never a shared config write another process
can race. `git init` runs lazily and is idempotent. Only a successful bootstrap is cached; a
transient failure is retried by the next operation. The Git runner removes inherited repository
redirects such as `GIT_DIR`, `GIT_WORK_TREE`, object-directory and namespace variables; an app
started from a hook or unusual shell therefore cannot send internal history into a user project.
The owner-unique `GIT_INDEX_FILE` supplied by this module is the only intentional routing override.

A repository that has been initialized but has no commits yet is a successful **empty history**:
`list()` probes `HEAD` with quiet `rev-parse` and returns `[]`. Letting `git log` fail on that
ordinary unborn state collapses "we looked and there is nothing" into the same `null` used for a
real read failure, and makes a first-run History panel report that Git is broken.

## Append-only, always

Every save that actually changed something writes **one new commit**. Restoring an old revision
(`SettingsStore.applyRestoredSettings`) runs the restored content back through the **normal save
path** — it is recorded as a brand-new commit, labelled `"Restored settings to <shortsha>"` with
action `'restored'`, never a `git reset`/`git checkout` that would rewrite or lose history. That is
the whole point: a restore can itself be restored away from later, and the one thing this history
can never do is destroy a revision that already landed.

The record request is durable before Git is touched: an owner-unique, mode-`0600` journal under
`.nodeterm-history-pending/` carries its id, content, filename, action and label. Every process can
replay a complete journal, but only the invocation that created a journal may remove it. A helper
that sees a foreign live or crash-left journal may publish it, but never deletes, resets, cleans or
rewrites that process's files.

Each publication uses an owner-unique `GIT_INDEX_FILE`; there is no shared working-file or index
sequence to lock. The process hashes the bytes, builds an immutable tree and commit, then publishes
with `git update-ref <branch> <new> <observed>`. That final old-OID compare-and-swap is the fence. If
another process advanced the ref, the loser rebuilds on the winner and retries within a fixed bound.
A suspended old process therefore cannot wake and overwrite a newer history: its stale CAS fails.
The transaction id in every commit makes journal replay idempotent. Concurrent identical states are
resolved through a private processed ref rather than manufacturing an empty user-visible commit.

This is also crash recovery. A process killed after its private index/commit construction but before
the ref CAS leaves immutable Git objects, an owner-unique index and the complete journal. The next
recorder replays the journal and preserves the requested revision. It does **not** remove the killed
process's index or journal, because PID visibility and age are not authority to destroy possibly-live
foreign work. The two-process Chuts bundle the real store into ordinary Node workers, suspend one at
the CAS, kill one at that boundary, and prove correct labels/bytes, replay, fencing, and byte-for-byte
preservation of foreign files.

`list()` and `restoreContent()` still join this process's Promise tail for direct read-after-write,
but cross-process consistency comes from immutable OIDs: `list()` snapshots the history ref once and
runs every log/show against that exact OID. A concurrent writer therefore produces a coherent before
or after view, never a `HEAD` probe from one generation and rows from another. Restore accepts only a
full object id reachable from the snapshotted history head and reads that immutable commit. A failed
per-commit filename read fails the whole list instead of being laundered into `filename: ''`.

## A restore is also a renderer transaction

Applying `settings.json` in core is only half of a live restore. The renderer's Zustand store still
holds the pre-restore object, and `renderer/state/settings.ts` may have a coalesced save waiting for
its 300 ms timer. If that callback lands afterward, the UI both renders and republishes the state
the user explicitly replaced.

`restoreSettingsRevision()` therefore suspends settings persistence, epochs and cancels every
not-yet-dispatched snapshot, joins the already-dispatched save tail, invokes the core restore, then
loads the authoritative settings straight back into both `base` and the override-resolved live
`settings`. A failed restore re-schedules the canceled user edit. Edits queued while a successful
restore is in flight are superseded by the chosen revision and discarded. The barrier/timer tests
in `renderer/state/settings.test.ts` pin all three orderings. `SettingsStore` also awaits its history
recorder: the restore handler's `{ ok: true }` is not returned until the new append-only restore
revision has passed the ref CAS (or the non-throwing recorder has truthfully exhausted its bounded
attempt). Ordinary successful settings saves use the same durable barrier.

## A write must never break the operation it is recording

`LocalHistoryStore.record()` **never throws**. Every Git subprocess has a wall-clock timeout,
bounded output, and an explicitly disabled hooks path; CAS retries are finite. A failed Git call
(Git not installed, a locked repo, a full disk, a timeout or exhausted contention) is logged and
swallowed — `SettingsStore.saveNow` wraps the awaited recorder in its own `try`/`catch` too, belt and
braces, so a history-layer failure can never turn the real settings save into a failed one. A
complete journal remains available for a later process. `restoreContent()` is the method that
*does* throw: it is a read the caller is actively waiting on to apply, so unavailable, malformed,
foreign or unreadable revisions must reach the user.

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

**Mobile companion:** N/A today. *nodeterm mobile* does not render or mutate the desktop/server
settings store, and the terminal transport has no local-history protocol. If settings management is
added to the private iOS app, it must add the same restore/rehydrate ordering there; mention
@eneskirca in that follow-up rather than silently treating the desktop IPC as mobile coverage.

## The Pages playground is a separate browser-only time machine

The public `site/` does not use Git or this IPC. Its `save()` helper stores the prior values of the
durable keys changed by that operation in the history row, and `undoEntry()` applies those values as
one persisted state transition while recording a reversible inverse. Appearance restores also
reapply the live document theme and text-size side effects. The real row payload carries `canUndo`
through HTML escaping into the context menu, so per-row Put back is reachable rather than merely
rendered as dead metadata.

Authenticator records, toy-lock hashes, School PINs and history itself are deliberately excluded
from undo snapshots. Active authenticator records remain in their canonical localStorage field, but
TOTP secrets are never duplicated into a hidden undo row or any settings/history export. Legacy
secret-bearing undo rows are sanitized and re-persisted at load. Authenticator deletion is an honest
record-only event and its confirmation says it cannot be restored; deleting Time machine rows is
also explicitly permanent because the log cannot safely contain a recursive copy of itself.
Notification deletion is reversible through its prior-value row. Nickname and narrator-rate controls
commit named history changes on their `change` event rather than creating one row per keystroke or
slider tick. Pure events such as an export or conversion remain record-only. An explicit empty
history list is never mistaken for first-run data and repopulated after reload.
