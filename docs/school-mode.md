# School mode

A shared, renamable, user-experience switch. While it is on, this app (and, by design, any other
locally installed app that reads the same shared record) presents in plain English and behaves as
if the Cantonese/bilingual, funny-level, dim-sum-surprise, and personal-vocabulary capabilities
were **not installed** — omitted, not merely disabled-and-visible.

**This is a self-imposed focus switch, not a security boundary.** It does not encrypt anything,
does not protect data from another person with access to the machine, and is not fit for guarding
anything sensitive. Settings → School mode says this in plain words, every time.

## Where the record lives, and why it is shared

`~/.nodeterm/shared/school-mode.json` (`core/school-mode.ts`, `sharedDir()`) — deliberately
**outside** any one app's own `userData`/`settings.json`. The point is that several apps on the
same machine could honor one switch: turning it on in one place should not require re-configuring
it everywhere. The record is small and holds only:

```json
{ "version": 1, "enabled": false, "name": "School mode" }
```

It is watched with `fs.watch` on its containing directory (not the file handle itself — editors
and other processes commonly write via temp-file-then-rename, which a file-handle watch can miss)
so a change made by **another window or another app** applies **live**, with no restart, everywhere
this app is running (`SharedRecordWatcher`, broadcast over `IPC.schoolModeChanged` to every attached
renderer).

On first run that containing directory usually does not exist. `SharedRecordWatcher` therefore
keeps exactly one watcher on the nearest existing ancestor and promotes it toward
`~/.nodeterm/shared/` as directories appear; a successful local write retries promotion
immediately, closing the creation-event race without a polling timer. Promotion performs one
reload because another app may have written the record before the target watcher was armed.
`dispose()` closes the sole live handle, and a lifecycle generation makes a reload queued before
shutdown inert when it eventually runs. Only `ENOENT` means absence: corrupt JSON still follows
the documented OFF policy, while a permission or other I/O failure preserves the last-known record
instead of laundering “could not read” into “mode is off”.

## Turning it on and off

- **Turning it ON never requires a PIN.** Entering a focus mode needs no proof — only leaving one
  does. The very first `enable()` call on a machine with no stored credential yet establishes the
  PIN from what you type at that point (minimum 4 characters).
- **Turning it OFF requires the correct PIN.** It is checked against a stored **hash**
  (`scrypt`), never a stored plaintext PIN. The hash+salt lives in its own file,
  `~/.nodeterm/shared/school-mode.credential.json`, **sealed at rest** through the platform's
  seal/unseal hooks when available:
  - **Desktop (Electron):** `safeStorage.encryptString`/`decryptString` — itself backed by the OS
    credential vault (Windows DPAPI, macOS Keychain, Linux `libsecret`/kwallet via Chromium).
  - **Server Edition:** no OS keychain to seal into on a headless Linux host, so the hash+salt is
    written as raw `0600` bytes instead — the exact same documented trade-off
    `core/agents/node-auth-secret.ts` already makes for the identical reason. The credential
    **still never contains the plaintext PIN**, sealed or not.
- **Renaming needs no PIN.** It carries no security meaning — see below.

## Renaming

The mode is **user-renamable** (Settings → School mode → Display name). Once renamed, **every
surface uses only the chosen name** — the shipped name "School mode" is never shown again anywhere
in this app: the Settings sidebar entry, the section title, and every description on that page all
read the live name from the shared record (`useSchoolMode`), not a hardcoded string.

## Recovery: there is no reset flow

Forgot the PIN? There is deliberately no recovery prompt, no support ticket, no backdoor. Delete
`~/.nodeterm/shared/` on that machine. This:

- turns the mode off,
- clears the stored PIN hash,
- does **not** touch any other per-app setting (this directory holds nothing else),
- lets your prior language/funny-level/dim-sum preferences return, because they were never
  deleted — they were only suppressed while the mode was on (see below).

Settings names this exact path next to the unlock control, so nobody has to find this document to
recover.

## What "behaves as if not installed" means in this app today

The renderer does not treat its initial `enabled: false` value as permission. Every optional
capability below calls `schoolModeAllowsOptionalFeatures({ enabled, hydrated })`, which returns true
only after a successful read has proved the shared mode is off. During startup, a failed bridge
read, or a Server Edition reconnect, the safe presentation is therefore the same reduced English
surface as enabled School Mode; saved preferences are suppressed, not erased.

Within *this* codebase, School Mode's scope is:

- **Language and funny levels** ([docs/language-modes.md](language-modes.md)) resolve to plain
  English at funny level 1. The Language Settings section is omitted, and a stale input event
  re-checks the live policy before writing. Confirmed-off hydration restores the saved language
  and independent funny levels without a restart.
- **Narrator event speech** ([docs/narrator.md](narrator.md)) keeps the user's narrator on/off
  choice, but both Canvas execution paths force English and remove the Cantonese text/voice from
  the request while School Mode is enabled or unknown. Only a confirmed-off record may use the
  saved Cantonese or bilingual narrator preference. Cantonese language/voice controls and their
  search entries are omitted too, and Preview re-checks the live policy before speaking.

- **The dim-sum surprise** ([docs/dim-sum.md](dim-sum.md)) never rolls while the mode is on
  or unknown; it re-checks the live policy immediately before revealing a previously scheduled
  dish.
- **The personal-vocabulary capability** ([docs/personal-vocabulary.md](personal-vocabulary.md))
  is fully suppressed two ways: the Settings upload control is **omitted** entirely (not shown
  disabled) while the mode is on or unknown, and any already-uploaded vocabulary's text
  substitution is skipped everywhere. A file uploaded before entering the mode is neither lost
  nor applied while the mode is on, and resumes once a real off record hydrates.

## Interface

`window.nodeTerminal.schoolMode` (`SchoolModeApi`, `shared/types.ts`):

| Method | Notes |
| --- | --- |
| `load()` | Current `{version, enabled, name}`. |
| `enable(pin?)` | PIN required only the very first time (no stored credential yet). |
| `disable(pin)` | Requires the correct PIN. Returns `{ok:false, error}` on a wrong one. |
| `rename(name)` | No PIN. |
| `changePin(currentPin, nextPin)` | Requires the current PIN. |
| `hasCredential()` | Whether a PIN has ever been set on this machine. |
| `onChanged(cb)` | Fires on any change, including one from another app/window. |

Registered identically on both shells (`core/school-mode.ts`'s `registerIpc()`, called from both
`src/main/index.ts` and `src/server/index.ts` — the same `CorePlatform` seam every other
cross-shell service uses) and served for real over the Server Edition's WebSocket bridge
(`renderer/bridge/ws-bridge.ts`'s `buildRealApi`) — it is not stubbed out in the browser build. A
relay (remote-desktop) tab treats it as APP-GLOBAL, exactly like `settings`: it stays local to the
tab you are looking at, never routed to the remote host.

## Security notes

- The credential is **never** written to `settings.json`, an export, a screenshot, a log, or Git
  history — it lives only in its own 0600/sealed file under the shared directory.
- The PIN itself is never displayed, hinted at, or characterized (length, composition) by the app
  or by an agent working on this codebase, per the project's general secret-handling policy.
- `scrypt` (Node's built-in, no external dependency) derives the hash; comparison uses
  `crypto.timingSafeEqual`.
- This is explicitly **not** a security boundary: anyone with filesystem access to
  `~/.nodeterm/shared/` can delete it and bypass the PIN entirely, by design (see Recovery above).

## Verification

- Enable with no prior credential and a short PIN (< 4 chars) → rejected.
- Enable with a valid PIN → `enabled: true`, presentation and narrator speech become plain English,
  dish surprise stops rolling, vocabulary substitution stops applying, and a second app/window
  watching the same file sees the change without restarting.
- Make the initial renderer load fail or remain pending → the same reduced English policy remains
  in force; a default `enabled: false` is not treated as a confirmed-off record.
- Disable with the wrong PIN → `{ok:false, error:'incorrect PIN'}`, record unchanged.
- Disable with the correct PIN → `enabled: false`, everything above resumes.
- Rename while on or off → every surface (sidebar, section title, descriptions) shows the new name
  immediately; the shipped name never reappears.
- Delete `~/.nodeterm/shared/` while enabled → next `load()` returns the default record
  (`enabled: false`, shipped name), `hasCredential()` returns `false`.
