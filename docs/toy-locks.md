# Toy locks

A **toy lock** is a purely-for-fun, opt-in password/TOTP gate you can put on a project tab, a
canvas node, or an appearance setting. Right-click the thing you want to lock and choose
**"Lock this…"**.

## This is not security

Say it as plainly as possible: a toy lock is a self-imposed speed bump, not encryption, not
access control, and not protection from anyone who actually has this computer. It exists for the
same reason a phone lets you require Face ID before opening one app but not another — a small
"give me a second before I look at this" — never for the reason a disk-encryption password exists.

Concretely:

- Nothing a toy lock guards is stored any more securely *because* it is locked. Locking a
  terminal node doesn't encrypt its scrollback; locking a tab doesn't hide the project from
  anyone who opens `workspace.json`.
- The credential itself (a password hash, or a TOTP secret) is stored sensibly — see
  [Credential storage](#credential-storage) below — but that is basic hygiene, not a claim that
  the lock withstands anyone.
- **Recovery is deleting nodeterm's own local application-data folder.** Every lock lives in that
  folder; delete it and every lock resets, along with the rest of nodeterm's local state (managed
  Claude accounts, cached scrollback, etc. — see the app's own docs for what else lives there).
  The unlock prompt and the lock-creation wizard both say this and both show the exact folder
  path, copyable. **Support Tickets** (Settings → Just for fun → Support Tickets, or the unlock
  prompt's "Forgotten your password?" link) walks through this with a straight face and ends by
  opening the folder in your file manager — see [the Support Tickets section below](#support-tickets).

If you came here looking for a way to protect a nodeterm session from someone else who has your
laptop unlocked, this isn't it. There is no such feature in nodeterm today.

## What can be locked

The engine (`src/shared/toylock.ts`, `src/core/toylocks/toylock-service.ts`) is generic — a lock
targets a `{kind, id, label}` triple — and today three kinds are wired up:

| Target kind | Where to lock it | What locking does |
| --- | --- | --- |
| `tab` | A project tab's caret (`⌄`) menu → **Lock this tab…** | Clicking that tab (when it isn't already the active one) opens the unlock prompt instead of switching to it. |
| `node` | Right-click a single canvas node → **Lock this node…** | The terminal's xterm view is torn down and covered by an opaque "🔒 Locked — click to unlock" plate: no output paints, no keystroke/paste/drop reaches the pty. See [Node-lock enforcement](#node-lock-enforcement) for exactly what "locked" means for a live terminal. |
| `appearance` | Settings → Appearance → Accent → **Lock this…** | The colour swatches are replaced with a "🔒 Locked — click to unlock" button until you unlock it. |

Adding a new target kind means: pick a stable `id` for it, capture a human-readable `label` at
lock-creation time, and reuse the existing `LockWizard` / `UnlockPrompt` components
(`src/renderer/components/toylocks/`) plus the `useToyLocks` store (`src/renderer/state/toylocks.ts`)
the way `TabBar.tsx` and `AppearanceSection.tsx` already do — see those two files for the pattern.

## Node-lock enforcement

Locking a canvas node actually disables it — output, input, and the reattach-after-unlock all
matter here, because unlike a tab or a setting a terminal node has a LIVE process behind it.
`TerminalNode.tsx` is the only consumer of a `node` lock's on/off state; it reads the
`useToyLocks` store directly and never routes the decision through `Canvas.tsx`.

- **No output visible.** The xterm view is fully disposed (not merely hidden behind CSS) the
  moment the lock engages, and an opaque plate covers the body. This deliberately REUSES the
  offscreen-viewer release machinery (`offscreenDown`/`offscreenEpoch` in TerminalNode.tsx, backed
  by `terminal/offscreen-policy.ts`) rather than inventing a parallel teardown path — a lock is,
  mechanically, "tear the view down right now, for a different reason".
- **No input accepted.** With the xterm disposed there is nothing to focus, type into, paste onto,
  or drop a file onto — the paste/drop handlers also refuse explicitly while locked, and stdin is
  disabled on the outgoing xterm instance synchronously (before the teardown effect even runs) so a
  keystroke in flight at the exact moment of locking cannot slip through. One gap remains, and it
  is deliberate to document rather than hide: a few features write into a session by **name**
  through core (`sendText` — dictation, the header's "push rename to session", context-link/note
  pushes), bypassing the renderer's client entirely. Those are not gated by this pass; closing that
  gap needs a guard inside `src/core/pty-manager.ts`'s `sendText` (or the IPC layer above it), which
  was outside this change's editable surface. The in-component rename push (`pushSessionRename`) IS
  gated, since it lives in the same file as the rest of this enforcement.
- **No stale scrollback on unlock.** Reattaching redraws from the LIVE session, never from a
  buffer that merely sat in memory behind the plate — which is why this does not reuse the ordinary
  PARK path (project-switch parking deliberately keeps the exact xterm buffer for instant, exact
  re-adoption; that is precisely the behavior a lock must not have).
- **Persistent vs. non-persistent sessions are NOT treated the same**, and getting this backwards
  is the one mistake that would turn "lock a terminal" into "kill it":
  - A **persistent** session (tmux / the Windows session host) is released exactly like an
    offscreen dispose: the client detaches, the session keeps running, unlocking is a warm
    reattach. Nothing is at risk.
  - A **non-persistent** session (the plain-shell fallback) is different because there the pty
    client IS the process — the same #126 live-work lesson `terminal/live-work.ts` already
    documents for the offscreen release. Locking such a node must NOT kill the client: it detaches
    the VIEW only (dispose the xterm, stop consuming pty data, refuse input) and leaves the
    session's client attached so the process keeps running, unattended but alive, until unlock.
  - `nodeLockTeardownMode()` in `src/shared/toylock.ts` is the pure decision behind this split;
    `TerminalNode.tsx`'s `engageNodeLockDown` is the only caller.
- **A `session`-duration node lock relocks itself** the moment the node leaves the viewport —
  the same "leaving the surface" idea `TabBar` already applies on a tab switch, expressed with the
  signal a canvas node actually has (its own visibility observer).
- **Unknown lock state fails LOCKED, not unlocked.** Before the toy-lock store has answered even
  once (app just launched, one local IPC round trip still in flight), every node with an unresolved
  lock state renders as locked rather than assuming "no lock exists" — a failed or still-pending
  read is never evidence of absence. This applies for a very small window and to every node, not
  only ones that actually carry a lock.

Three surfaces: **Desktop** is the primary target and everything above describes it directly.
**Server Edition** gets the same enforcement for free — `TerminalNode.tsx` and the offscreen-release
machinery it reuses are shared between the Electron renderer and the browser build, and
`window.nodeTerminal.toylock.*` resolves through the WS bridge exactly like every other core call
(see "Server Edition and the desktop relay" below); the persistent-vs-non-persistent split is
decided by the SAME `session.persistent` flag either shell already reports. **Mobile** (the private
`nodeterm-ios` companion) has no canvas node UI at all today, so a `node` lock is not reachable from
it — not applicable, not a gap.

## Every lock has its own credential

There is no master password and no implicit inheritance. Locking three tabs makes three
independent locks with three independent credentials; unlocking one never unlocks another. If you
want one password everywhere, you type the same password three times on purpose — the app never
assumes that for you.

Four credential kinds:

- **Password** — typed twice to confirm, hashed with `scrypt` (N=16384, r=8, p=1, 64-byte key),
  never stored in plaintext.
- **Authenticator code (TOTP)** — the wizard generates a fresh random 160-bit secret, shows it as
  a QR code (drawn entirely in-process — see [`docs/authenticator.md`](./authenticator.md) for how
  that QR is built with no network call) plus the manual base32 key, and requires you to type back
  one current code before the lock actually activates. You can optionally also save that same
  secret into the built-in authenticator — the wizard says plainly that doing so makes the lock
  **ornamental**, because the key then sits right next to the door it opens.
- **Password + code (both required)** — the combo kind. Both factors must pass; a correct password
  alone does not unlock, and neither does a correct code alone. The failure reason shown for a
  wrong attempt is deliberately the SAME string regardless of whether the password, the code, or
  both were wrong — `toylock-service.ts`'s `verify()` computes both checks before ever returning,
  so which factor failed cannot leak through timing or copy either. Setting one up is two steps
  chained: a password step, then TOTP enrollment (QR + confirm code) — nothing is written to disk
  until BOTH are proven; an abandoned enrollment leaves no half-armed lock behind.
- **Windows PIN** (Windows only) — a numeric PIN, hashed exactly like a password (same `scrypt`
  call). **This is not Windows Hello.** Electron has no Windows Hello prompt to call into —
  `systemPreferences.promptTouchID`-equivalent biometric prompting is macOS-only in Electron's
  public API surface, and there is no documented Electron path to Windows' own Hello/PIN UI short
  of writing a bespoke native (WinRT `UserConsentVerifier`) addon, which this app does not carry.
  Rather than fake a prompt or quietly store a PIN while calling it "Hello", this kind is exactly
  what it says: a numeric password, Windows-only, never presented as biometric or as more secure
  than any other kind here. The wizard hides/disables the option on other platforms
  (`navigator.platform`-based, for copy only); the core independently refuses it on any process
  where `process.platform !== 'win32'`, so a wrong client guess only costs a hidden option, never a
  false accept.

When an authenticator entry records a link to a toy lock, the authenticator copy and the toy-lock
credential are still separate sealed records. Removing the authenticator entry removes its
live-code convenience but does not remove or weaken the toy lock; under Kids mode that
authenticator-seed deletion goes through the two-key destructive gate.

## Choosing how long an unlock lasts

Every lock also picks an **unlock duration**:

- **Just while you're on this surface** (`session`) — re-locks the moment you leave: switch away
  from the tab, or navigate off the Settings section that holds the appearance control.
- **For a number of minutes** (`minutes`) — a real expiry timestamp; the surface re-locks itself
  the next time anything checks (no background timer needed — `isUnlocked()` just compares against
  `Date.now()`).
- **Until nodeterm quits** (`until-close`) — stays unlocked for the rest of this run of the app.

Independently, **"Locked again the next time nodeterm starts"** (`lockedOnLaunch`, on by default)
decides whether the lock is armed again on the next launch. Unlock state is deliberately **never
persisted to disk** — it lives only in the renderer's in-memory `useToyLocks` store
(`src/renderer/state/toylocks.ts`) for the lifetime of the running app, which is what makes
"locked on launch" true by construction rather than by a setting that has to remember to reset.

## Wrong attempts and rate limiting

A wrong password or code doesn't wipe anything and doesn't pretend to be a real lockout. After
three consecutive failed attempts on one lock, the service starts making you wait — the wait
doubles each additional failure, capped at 30 seconds — and **during that wait it does not even
look at the credential you type**: that's the whole rate limit, not a courtesy on top of one
(`src/core/toylocks/toylock-service.ts`, `RATE_LIMIT_THRESHOLD` / `RATE_LIMIT_MAX_MS`). A
successful unlock resets the counter. The rate-limit state is in-memory only and resets on app
restart, same as everything else here — this is a toy, and a restart is always available as an
escape hatch.

## Locked surfaces stay honest

A locked tab still shows up in the tab strip, labelled with a 🔒. It is never hidden and never
silently skipped — clicking it opens the unlock prompt rather than teleporting past the lock or
doing nothing. The full list of every lock on the machine — enumerable, searchable, removable one
at a time or in bulk — lives in **Settings → Just for fun → Toy locks**.

## Credential storage

Lock records split into two halves:

- **Metadata** (`ToyLockRecord`: target, credential kind, duration, timestamps) is plain JSON,
  because none of it is sensitive — it's exactly what the renderer already needs to show the lock
  list.
- **The credential** (a password hash record, or a TOTP secret) is sealed at rest using the same
  convention the rest of nodeterm already uses for the per-node hook-identity secret
  (`src/core/agents/node-auth-secret.ts`): on Desktop, Electron's `safeStorage` (OS keychain-backed)
  seals it; on the Server Edition, where there is no OS keychain to call into, it's written as raw
  bytes to a file with mode `0600` (owner-only). Either way the file that holds it
  (`toylocks.json` / `authenticator.json` under nodeterm's userData directory) is written
  atomically (temp file + rename) so a mid-write crash can never leave a half-written, corrupt
  file behind. See `src/core/secure-store.ts`.

Neither the app nor an agent working on this code ever displays, hints at, or characterises a
stored credential's value, length, or composition.

## Support Tickets

Reached from the unlock prompt's **"Forgotten your password?"** link, from **Settings → Just for
fun → Support Tickets**, and from the "?" shortcuts panel's footer. It plays the part of a real
support desk right up to the punchline: pick a category, write a (genuinely optional) description,
submit, and watch the ticket number, status, and canned responses advance as you click **"Check
for updates."**

Then the "resolution" does the one thing that actually works: it shows you the exact local
application-data folder path (copyable) and, on Desktop, an **Open folder** button that opens it
in your OS's own file manager. **nodeterm never deletes anything for you** — it opens the folder
and stands back; the deletion (if you want one) is yours to do by hand, in your own file manager.
On the Server Edition, opening a folder isn't meaningful from a browser tab (the folder is on the
server host, which the browser has no access to), so the resolution just shows the path and says
so honestly instead of offering a button that couldn't work.

One plain, unstyled line sits above every ticket you write, always: **nothing on this page is sent
anywhere.** There is no ticket outside this machine, no network request is made, no data is
collected, and nobody is reading it. Every ticket lives only in this browser/app's own
`localStorage` (`src/renderer/state/supportTickets.ts`) — the same place, structurally, as the toy
lock's own credentials live in the app's data directory: local, and nowhere else.

## Server Edition and the desktop relay

Toy locks are **core-bound**: the actual lock records live wherever the app's own core process
runs — Electron's main process on Desktop, or the server process for the Server Edition — reached
over the same request/response channel every other core service uses
(`src/renderer/bridge/ws-bridge.ts`'s `buildToylockApi` / `buildAuthenticatorApi` for the browser;
the Electron preload for Desktop). A relay tab (one desktop viewing another desktop's canvas over
the E2EE relay) keeps its **own local** toy locks — they describe the viewer's own machine and
never route to the remote host, the same way the update banner stays local there. The host's
raw-relay dispatcher enforces that split with an exact allowlist: every `toylock:*` request is
rejected before its handler can read or change the host's lock store. Registering the shared core
handler for the Server Edition does not, by itself, make it relay-callable.

## Known limitations

This shipped in a few focused passes and is honest about what didn't make it in:

- **A node lock does not gate `sendText`-style core-addressed writes.** Dictation
  (`DictationOverlay.tsx` → `api.pty.sendText`), and anything else that writes into a session by
  NAME through `src/core/pty-manager.ts` rather than through the renderer's own pty client, reaches
  the pty regardless of a node's lock state — that delivery path is entirely independent of the
  xterm/client this feature tears down. Closing it needs a guard inside `pty-manager.ts`'s
  `sendText` (or the IPC layer above it) that consults the toy-lock store before writing; it was
  outside the editable surface for the pass that wired up the rest of node-lock enforcement. The
  in-app rename push (`TerminalNode.tsx`'s `pushSessionRename`) IS gated, since it lives in the
  same file as the rest of the enforcement.
- **The Settings → Toy locks list still shows a two-way credential label** (`ToyLocksSection.tsx`:
  `credentialKind === 'password' ? 'Password' : 'Authenticator code'`) — a combo or Windows-PIN
  lock displays as "Authenticator code" there even though it isn't one. That file was outside this
  pass's editable surface; the label needs a fourth branch.
- **No command-palette "(locked)" label on search results yet.** Locked surfaces are honest in
  their own native search/UI (the tab strip, the Toy locks list), but a locked tab/node doesn't
  currently show a distinct "(locked)" badge inside the ⌘K command palette's own results.
- **Bulk creation isn't offered** — you lock things one at a time, at the element itself. Bulk
  *removal* is supported from the Toy locks settings list.
- **Windows PIN is not Windows Hello** — see the credential-kinds section above. If a genuine
  Windows Hello prompt ever becomes reachable (a native WinRT addon, or a future Electron API), it
  should be a NEW credential kind rather than silently changing what `windows-pin` means today.
