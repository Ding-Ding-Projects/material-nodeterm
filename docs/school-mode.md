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
this app is running (`SchoolModeStore.watchDir`, broadcast over `IPC.schoolModeChanged` to every
attached renderer).

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

This repository does not yet ship the broader Cantonese/bilingual/funny-level system described in
the shared instructions this feature is modeled on — those are separate, larger features tracked
elsewhere. Within *this* codebase, School mode's scope is:

- **The dim-sum surprise** ([docs/dim-sum.md](dim-sum.md)) never rolls while the mode is on
  (`DimSumSurprise.tsx` reads `useSchoolMode().enabled` as one of its reveal gates).
- **The personal-vocabulary capability** ([docs/personal-vocabulary.md](personal-vocabulary.md))
  is fully suppressed two ways: the Settings upload control is **omitted** entirely (not shown
  disabled) while the mode is on, and any already-uploaded vocabulary's text substitution is
  skipped everywhere (`useVocabularyText` short-circuits to the original text when
  `useSchoolMode().enabled` is true) — so a file uploaded before entering the mode is neither
  lost nor applied while the mode is on, and resumes the instant it goes off.

Wiring a future language-mode/funny-level system is expected to hook into the same
`useSchoolMode().enabled` boolean; nothing about this design is specific to the two capabilities
it currently gates.

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
- Enable with a valid PIN → `enabled: true`, dish surprise stops rolling, vocabulary substitution
  stops applying, a second app/window watching the same file sees the change without restarting.
- Disable with the wrong PIN → `{ok:false, error:'incorrect PIN'}`, record unchanged.
- Disable with the correct PIN → `enabled: false`, everything above resumes.
- Rename while on or off → every surface (sidebar, section title, descriptions) shows the new name
  immediately; the shipped name never reappears.
- Delete `~/.nodeterm/shared/` while enabled → next `load()` returns the default record
  (`enabled: false`, shipped name), `hasCredential()` returns `false`.
