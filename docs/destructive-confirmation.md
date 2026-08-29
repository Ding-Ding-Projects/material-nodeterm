# Destructive-action super confirmation

## What this is

`DestructiveConfirmGate` (`src/renderer/components/DestructiveConfirmGate.tsx`) is a
two-independent-keys-plus-full-range-slider confirmation gate for actions that cannot be undone.
Built entirely in this app's own UI layer — no separate helper app, hosted page, or external
CAPTCHA service. It replaces a plain `ConfirmDialog` wherever the action it guards is genuinely
irreversible.

## Where it's wired in

| Action | Trigger | Anchor |
|---|---|---|
| Delete selected node(s) | `Delete`/`Backspace` | none — centered modal (no single obvious anchor point for a keyboard shortcut) |
| Delete selected node(s) | Right-click → **Delete** | the click point |
| End/delete a node or session (Kids/unknown policy) | Kanban, window shortcut, sessions sidebar, session-memory panel, or agent-control **close** | caller-specific or centered |
| Permanently delete a closed project | Welcome screen → "Recently closed" → **×** | the **×** button |
| Permanently delete notification(s) | Notification centre → **Delete** (single row or bulk) | the **Delete** button |
| Remove a stored authenticator seed (Kids mode or unknown policy) | Settings → Authenticator → **Remove** | centered |
| Delete a worktree directory (Kids mode or unknown policy) | Worktree remove dialog → opt into **Delete from disk** | centered |
| Remove a managed account (Kids mode or unknown policy) | Settings → Accounts → **×** | the **×** button |
| Discard uncommitted file changes (Kids mode or unknown policy) | Source Control → **Discard** | centered |
| Revoke a paired device (Kids mode or unknown policy) | Settings → Phone → **Revoke** | the **Revoke** button |

Every caller reaches the shared `openDestructiveGate(request)` store. `DestructiveGateHost` is
mounted once at the app root, so a project/view switch cannot tear an authorization down midway;
only one request can exist at a time, and a second open is refused instead of stacked or substituted.

Right-click **Delete** previously deleted a whole selection with **no confirmation at all** — the
`Delete`/`Backspace` keyboard path already asked (via a plain `ConfirmDialog`), but the
context-menu row called `deleteNodes(ids)` directly. Both paths now go through the same gate, so
they can no longer disagree about how carefully deletion is asked for.

## The mechanism

1. **Identify the action and what it affects**, in plain, unambiguous language — no euphemism, no
   funny-level styling on this sentence. `title` names the exact action ("Delete 3 nodes", "Delete
   "my-project" permanently"); `description` states what will be affected and that it cannot be
   undone; an optional `affected` list names the exact items (node titles, a project name) so the
   user approves what they were actually shown.
2. **Two independently operated keys** (`Key 1` / `Key 2` buttons, each toggled with its own click
   or `Enter`/`Space`, `aria-pressed` reflecting state). Both must be armed before anything else
   can happen.
3. **A full-range slider**, disabled (`aria-valuetext` says why) until both keys are armed. Only
   reaching **100%** while both keys are armed authorizes the action — dragging partway and letting
   go does nothing, and there is no partial trigger. A dramatic-but-non-blocking pulse animates the
   filled track while dragging (skipped under `prefers-reduced-motion`).
4. **A completion animation** (a green checkmark state) plays for ~480ms (~120ms under reduced
   motion) before the action actually fires — long enough to see confirmation land, short enough
   to not feel like a second wait.
5. **Emergency exit** — a button, always visible and never grayed out, that cancels immediately.
   `Escape` does the same (routed through the same dialog-stack ownership every other modal in this
   app uses — see `components/dialog-stack.ts` — so only the topmost dialog answers a key, exactly
   as `ConfirmDialog` already guarantees). Neither works anymore once the completion animation has
   started: authorization is already in flight at that point.
6. **Revalidate the authorization** at commit. The dialog approves the exact non-secret target
   identity it displayed, not whichever object later occupies that id. Node, account,
   authenticator-seed, and worktree removal re-read their authoritative current source immediately before the
   irreversible call; a changed/missing/unreadable target performs nothing. A plain dialog that
   outlives a Kids OFF→ON or ready→unavailable transition performs nothing and reopens as a fresh
   two-key request.
7. **Focus returns** to the control that opened the gate (`restoreFocusEl`), on cancel or
   confirm alike.

The action itself never fires from anywhere except step 4 completing. There is no code path that
calls `onConfirm` without both keys and a full slider drag having happened first.

## Anchored vs. centered

Pass `anchor: { x, y }` (screen coordinates — typically `e.clientX/e.clientY` from the triggering
click, or a button's `getBoundingClientRect()`) to render the gate as a card positioned beside that
point (`useMenuFlip`, the same viewport-edge-flip hook every context menu and dropdown in this app
uses, so it never renders off-screen). Omit it for a centered modal — used only when there is no
single obvious anchor (the keyboard-triggered delete path).

## Accessibility

`role="alertdialog"`, `aria-modal="true"`, `aria-labelledby`/`aria-describedby` pointing at the
title and description. The slider is a native `<input type="range">`, so it carries the platform's
own keyboard support (arrow keys, Home/End) for free; `End` is the documented way to jump straight
to 100% by keyboard. Both keys are real `<button>`s with `aria-pressed`. Focus starts on the first
key on open. Everything scales and reflows at narrow widths and high display scales (the card caps
at `92vw`/`88vh` and its own body scrolls).

## What styling may never do

Animation and copy may style the *experience* — how dramatic the slider pulse looks, how the
completion state reads — but never obscure **what** will be deleted, changed, or made irreversible.
`title`/`description`/`affected` are set once, in plain prose, by the caller; nothing in the gate
component itself rewords them for a funny level or a language mode. If a call site wants localized
or funny-level-styled copy, it composes that copy *before* handing it to the gate — the gate's job
is presenting whatever plain sentence it's given clearly, not editorializing it.
