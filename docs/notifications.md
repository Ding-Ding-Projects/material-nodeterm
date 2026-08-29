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
  body? })`.
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

## API

```ts
import { notify } from '../lib/adhdNotify'

notify({
  kind: 'success',
  title: 'Worktree created',
  body: 'feature/foo — branched from main',
  actions: [{ label: 'Open', onClick: () => goToNode(node) }]
})
```

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
coordination inbox with the canvas-control command `notify --node <id>`. This is deliberately a
separate signal from the persistent `send` mailbox: it carries no subject, body, transcript excerpt,
or caller-supplied text. The application submits one fixed prompt:

```text
[nodeterm] A linked agent updated shared coordination context. Check your configured inbox before continuing.
```

The route is available only when **Settings → Notifications → Allow linked agents to signal inbox
updates** is enabled. The source must be an authenticated, context-link-capable agent, the target
must be another context-link-capable agent, and the pair must have a persisted context-link edge.
Display-only lineage ropes do not authorize delivery. A target that is working, waiting, or blocked
is left untouched so the signal cannot interrupt an active turn.

Each source-target pair has a ten-second minimum interval and one in-flight delivery at a time.
Successful delivery marks the target node unread and adds one actionable notification to the
centre. The notification stores only the project and node identifiers plus fixed local copy, so it
can survive a reload without retaining transcript text. **Open agent** returns to the target node,
including when its project is currently closed. Duplicate events in the same ten-second window are
coalesced into the existing notification instead of producing a second toast or unread item.

The notification is informational and non-blocking. It never approves a terminal action, creates a
mailbox message, reads linked context, or exposes the target's transcript. The target agent still
chooses when to run its configured inbox command, and the fixed prompt is the only text submitted
by this route.

### Persistence and security

Notification history is kept in the renderer's bounded local store under
`nodeterm.notifications.v1`. Runtime action callbacks are not serialized. Reloaded actionable
items retain a safe node destination and use the same focus route as other notification links.
Malformed or oversized records are discarded without applying partial state, and the bounded history
keeps the newest 300 entries. Notification exports omit runtime callbacks and contain no transcript
content from this feature.

The existing hook-server identity check authenticates the source before the renderer receives the
request. The renderer then checks the live persisted bridge map and target capability again before
writing. This two-sided check prevents a source from treating a control rope, a stale title, or an
unrelated node as a context link.

### Surfaces

- **Desktop:** full delivery, persistence, target focus, and notification-centre action.
- **Server Edition:** canvas control remains unavailable on this edition, so the page does not
  pretend that this desktop-only command works there. Its notification centre still renders local
  history records that exist in the browser.
- **Mobile companion:** no new client protocol is introduced in this lane; phone push remains
  governed by the existing agent-status mirror.

## Accessibility

Each toast is `role="status"` (`aria-live="polite"`) for info/success/progress, or `role="alert"`
(`aria-live="assertive"`) for warning/error. The dismiss button has an `aria-label` naming the
notification it dismisses and a 22×22px hit target. The notification centre's list is
`role="listbox"` with `aria-multiselectable`, each row `role="option"` with `aria-selected`
tracking its checkbox. Reduced motion drops the entrance/spin animations without changing timing
or behaviour.
