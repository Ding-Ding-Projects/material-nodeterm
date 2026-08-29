# Non-blocking notifications

## What this is

A corner-anchored toast stack plus a reviewable history panel — the app's one system for
informational, success, progress, and non-decision error messages. It replaces ad-hoc "show a
message" call sites with one store (`src/renderer/state/notifications.ts`) and two surfaces:

- **`NotificationToasts`** (`src/renderer/components/NotificationToasts.tsx`) — the transient,
  auto-dismissing stack, mounted once at the app root (`src/renderer/App.tsx`) so it survives
  project switches, kanban toggles, and every dialog on top of it.
- **`NotificationCenter`** (`src/renderer/components/NotificationCenter.tsx`) — the drawer that
  lists every notification pushed this session, dismissed or not, opened from the bell button in
  the top-right controls cluster (or the command palette's "Open notification centre").

## Why bottom-left

The brief allows bottom-left or bottom-right. Bottom-right already carries the auto-update card
(`.update-card`, fixed at `right: 20px; bottom: 20px`) and would either collide with it or need a
second offset that drifts out of sync as the update card's own height changes with its content.
Bottom-left has nothing else viewport-fixed in it — the dock, the sessions-icon cluster, the
canvas pills, and the controls cluster are all positioned relative to `.flow-wrap` or the top of
the window, not the viewport's bottom-left corner.

## The rule this exists to enforce

Informational, success, progress, and non-decision error messages are **toasts, never modal
dialogs that halt the app**. Reserve `ConfirmDialog` (and the destructive-confirmation gate) for
decisions the user must actually make before continuing. Concretely:

- A message that only *reports* something (a background operation failed, a copy succeeded, a
  session isn't ready yet) is `notify({ kind: 'error' | 'warning' | 'info' | 'success', title,
  titleKind, body?, bodyKind })`. Every producer states whether each supplied field is `authored`
  application copy or an exact `fact`; omitted ownership is rejected at the native boundary.
- A message that *asks* something (confirm, choose an option, provide a value) stays a dialog.

### What was audited and converted

`ConfirmDialog` has always had an `alert: true` mode — "nothing to decide, only to report" — for
exactly the message-only case. Every use of it in `src/renderer/canvas/Canvas.tsx` (branch-failed,
"conversation not ready to transfer yet", handoff-build-failed) was a blocking modal whose only
job was to report an error, so all three now call `notify({ kind: 'error' | 'warning', … })`
instead. `ConfirmDialog`'s `alert` mode still exists for report-only messages an agent-driven flow
raises where a human must explicitly acknowledge before the flow continues (those keep using
`alert: true` deliberately — see `components/confirm-key.ts`); what moved is specifically the
class of message nobody needed to acknowledge to keep working.

The pre-existing `.announce-banner` top-center strip (worktree results, restart outcomes,
sync/copy errors surfaced via `copyError`/`notice`/`syncNote`/`migrationNote` in `Canvas.tsx`) is
**not yet migrated** — it is already non-blocking, just anchored at top-center instead of a
corner, and converting dozens of existing call sites across a 9,000+ line component in the same
pass as the new corner toast system risked destabilizing unrelated work happening in parallel.
Treat it as a known follow-up: new call sites should use `notify()`; the banner strip is legacy.

## Kinds and auto-dismiss

| Kind | Auto-dismiss | Use for |
|---|---|---|
| `info` | ~6s (longer for longer bodies, capped at 12s) | Neutral facts |
| `success` | ~4.5s (same scaling) | An action completed |
| `progress` | never (resolves into `success`/`error` instead) | A long-running operation is in flight |
| `warning` | never — persists until dismissed | Something needs attention but isn't blocking |
| `error` | never — persists until dismissed | Something failed |

Warnings and errors never auto-dismiss, per the brief. Anything else times out on a schedule that
scales gently with body length so a longer message isn't cut off before it can be read.

## Custom alert sounds

Settings → Notifications includes an independent file picker for each agent alert:

- **Finished turn** (`done`) plays when an agent turn completes.
- **Needs you** (`needsYou`) plays when an agent needs permission or a response.

Each picker accepts one local audio file, shows the selected filename, offers a preview, and can be
reset to the built-in synthesized cue. Files are read as bounded bytes and stored in the app's own
settings data, not as a path from the machine that happened to choose them. This keeps a browser
client's sound available to the Server Edition host. The selected file is limited to 8 MB and 30
seconds, and the UI refuses empty, non-audio, undecodable, or overlong input without replacing the
previous valid selection.

Playback remains fail-open to silence at the alert boundary. If a selected file is missing,
malformed, unsupported by the browser, or otherwise cannot be decoded, the corresponding built-in
cue plays instead. The custom data is never sent to a third-party service. Removing a selection
immediately restores the synthesized cue, and the existing app-wide sound switch and volume still
apply to both custom and built-in sounds.

The desktop and Server Edition use the same renderer implementation in `src/renderer/lib/sfx.ts`.
The mobile companion remains a separate surface with its own notification sound behavior.

## API

```ts
import { notify } from '../lib/adhdNotify'

notify({
  kind: 'success',
  title: 'Worktree created',
  titleKind: 'authored',
  body: 'feature/foo — branched from main',
  bodyKind: 'fact',
  actions: [{ label: 'Open', onClick: () => goToNode(node) }]
})
```

The native OS notification route accepts only a payload with both ownership fields set to
`authored` or `fact`. The renderer's `mapNativeNotification` maps authored fields and leaves fact
fields byte-identical, then the main process validates the prepared payload before constructing an
OS notification. This keeps paths, provider errors, identifiers, and other runtime values exact.

`actions` are optional right-aligned buttons (retry, undo, open, view details); clicking one both
runs its handler and dismisses the toast. Every notification — toast or not — is retained in the
store's history until explicitly removed, so the notification centre can show it later even after
it has auto-dismissed from the corner.

## The notification centre

A real list, not a decorative log:

- **Search** — a plain-text field over title + body with an adjacent anchored regex builder for
  deliberate regex matching. Invalid or unsafe patterns stay visible with an inline explanation
  and do not hide the list.
- **Filters** — All / Unread / one per kind, as toggle chips.
- **Multi-select** — a checkbox per row, individually or via the honestly-scoped
  **"Select all (N)"** button (it always names exactly what it selects: everything currently
  matching the search + filter, never a hidden larger set), **Invert selection**, and per-row
  toggling.
- **Bulk dismiss** — hides the selected rows from the toast stack (a no-op for rows already
  dismissed); never destructive.
- **Bulk delete** — permanently removes the selected notifications from history. This is
  irreversible, so it routes through the [destructive-confirmation gate](./destructive-confirmation.md),
  anchored beside the button that requested it. A single row's own "Delete" button routes through
  the same gate with a one-item selection, so there is exactly one deletion code path.
- **Export** — click for Markdown, Shift-click for JSON. Exports the current selection when one
  exists, otherwise the notifications matching the active search + filter — **never** the whole
  unfiltered history, per the "bulk export honours the active filter" requirement.

## Linked-agent inbox notifications

An authenticated agent session may ask another context-linked agent to check its configured
coordination inbox with the canvas-control command `notify --node <id>`. This signal is separate
from ordinary `send` and `reply`: it carries no subject, transcript excerpt, or caller-supplied
text. The application submits one fixed prompt, and the main-process delivery route retains its
existing project consent, ownership, flow-budget, and idle-queue checks.

The route is available only when **Settings → Notifications → Allow linked agents to signal inbox
updates** is enabled. Successful delivery marks the target node unread and adds one actionable
notification to the centre. Duplicate events for the same source-target pair are coalesced for ten
seconds. The record stores only stable project and node identifiers plus fixed local copy, so
**Open agent** can return to the target after reload without serializing callbacks or transcript
content.

Notification history is stored locally under `nodeterm.notifications.v1`, capped at 300 entries.
Malformed records are ignored, runtime action callbacks are excluded from persistence and export,
and clearing the history removes the local records. This remains a local desktop convenience, not
an authentication factor or a replacement for the target agent's own inbox decision.

## Accessibility

Each toast is `role="status"` (`aria-live="polite"`) for info/success/progress, or `role="alert"`
(`aria-live="assertive"`) for warning/error. The dismiss button has an `aria-label` naming the
notification it dismisses and a 22×22px hit target. The notification centre's list is
`role="listbox"` with `aria-multiselectable`, each row `role="option"` with `aria-selected`
tracking its checkbox. Reduced motion drops the entrance/spin animations without changing timing
or behaviour.
