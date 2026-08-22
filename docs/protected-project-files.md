# Protected project files

A project can be saved as **one file** — `.nodeterm-project`, the whole project the way a `.docx`
is the whole document: the canvas snapshot, the app-owned local history, the project's own git
repository as a bundle, and its working files, in a ZIP container
([`core/project-archive.ts`](../src/core/project-archive.ts)).

Since this change that file can also carry a **password**.

## Saving with a password

Project switcher → a project's ⋮ → **Save project as one file**, or the same row on the sessions
sidebar's project menu. The flow asks for a password first:

- **Blank = unprotected**, exactly as before. Protection is opt-in, because a password nobody
  chose is a project nobody can open.
- A non-blank password must be **typed twice**. That is not ceremony: there is no recovery path —
  the file is AES-256-GCM under a key derived from that password and nothing else — so a typo here
  quietly destroys the save file's usefulness and the user finds out weeks later.

## Opening one

The welcome screen now has **Open project file…** beside Open folder / Clone repo / Connect over
SSH. (The action already existed, but only inside the project switcher's per-project ⋮ menu —
which a user with no project open has no way to reach. That was the whole gap.)

Picking a protected file does not fail; it **prompts**. Each wrong password re-prompts against the
same file rather than making the user find it again.

The failure copy says "the password may be wrong, **or the file may have been altered**" rather
than picking one. That is not hedging: AES-GCM refuses to release any plaintext once
authentication fails, and there is nothing left to inspect that would tell the two apart. See the
note at the top of [`core/password-manager/crypto.ts`](../src/core/password-manager/crypto.ts).

A **damaged envelope** — not JSON, no KDF block, a payload the version does not understand — is
reported as damage instead, never as a wrong password. Otherwise the user retypes a correct
password forever against a file no password can open.

## Too many wrong passwords

After 5 wrong passwords for one file, that file earns a **wait** — 60s, then 2m, then 4m, capped at
an hour — and during it no password may be tried at all
([`core/archive-unlock-guard.ts`](../src/core/archive-unlock-guard.ts)). The refusal happens
*before* a key is derived, because the point of the wait is that the next guess costs wall-clock
rather than only 128 MiB of scrypt.

The prompt then offers the **unlock ladder** (`docs/unlock-ladder.md`) to end that wait: dim sum →
mental maths → whack-a-mole, exactly the rungs the toy locks and the Server Edition login use.
Every one of the ladder's five rules holds here unchanged, and two are worth restating:

- **Clearing a rung ends the WAITING, never the credential.** Winning returns you to the same
  password field, still needing the same password. Nothing in the ladder path decrypts anything —
  there is a test that fails if the dialog ever resolves a password from a cleared rung.
- **No attempt refund.** The failure count survives a clear, so the next wrong password waits
  *longer* than this one did. The ladder skips a wait; it never shortens the next one.

The rolling clear budget (3 per hour) is **shared across every file**, because every rung is
machine-solvable and spreading guesses over several files must not multiply the waits a script can
skip. That cap, not the difficulty of the games, is what keeps this playful rather than dangerous.

Under **School mode** the climb starts at maths — the dim-sum rung is absent, not skipped with a
message that would name the hidden thing.

The wait lives in the **main process** and only in memory. In the renderer it would be kept by the
guesser; persisted, a file you typo'd twice could refuse you after a reboot with no way to see why.

### What the wait is not

It is not what protects the file. Anyone holding the bytes attacks them offline at their own pace
with none of this code involved; what costs them is the KDF. This is a speed bump for the person at
the keyboard, in exactly the sense the toy locks are, and the copy in front of it never implies
otherwise.

## How it is encrypted

[`core/project-archive-encryption.ts`](../src/core/project-archive-encryption.ts).

- The **finished container is wrapped whole**, never entry-by-entry. A ZIP's entry names alone
  would say which repository travelled, which working files exist, and what the project is called;
  wrapping the whole thing leaks none of that. The protected file does not even start with `PK`.
- **The same primitives the password manager uses**: scrypt at `N=131072, r=8, p=1` (128 MiB per
  guess) and AES-256-GCM. A save file is the most portable thing this app produces — it goes on USB
  sticks and into mail — so it gets the strong contract, never the toy-lock one.
- Per-file random salt, so one password derives this file's key and no other file's.
- The envelope is small self-describing JSON, so a protected file can be *recognised* and refused
  politely rather than reading as corruption.

### What this does not claim

A password on a file the attacker **holds** can be attacked offline, as fast as their hardware
allows. The KDF is what makes that expensive; it is not what makes it impossible. Choose a password
accordingly, and note that the vault warning on export still applies: a password-manager vault
travels inside the archive, and is only as safe as its own password.

## Surfaces

- **Desktop** — full. The dialogs are the native save/open pickers; the password prompts are the
  app's own (Electron does not support `window.prompt`).
- **Server Edition** — unchanged: archive save/open were already desktop-only there
  (`ws-bridge.ts` answers "available in the Windows desktop app"), so there is nothing new to
  degrade.
- **Mobile companion** — not applicable: it attaches to tmux sessions over the transport protocol
  and has no archive concept.

## Not built yet

- **A password manager for a project with no folder.** The vault still lives at
  `<cwd>/.nodeterm/vault.json`, so an SSH project or a cwd-less canvas still shows "Not available
  for this project". The chosen design is to keep a file-backed project's vault inside its own
  project file.
