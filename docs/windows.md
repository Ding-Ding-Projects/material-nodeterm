# nodeterm on Windows

Windows is a first-class desktop target: a native Squirrel.Windows installer, detected native and
WSL shell profiles (PowerShell/cmd by default, not `bash`), and a Material title bar with the native window
buttons on the right instead of macOS's traffic lights on the left.

This page covers what works out of the box, what degrades (and why), how the unsigned installer
behaves, and how to build it yourself.

> **Changing the code rather than using it?** [`windows-support.md`](windows-support.md) is the
> contributor page: the platform-difference defects found so far, the guards that now catch them,
> and the build preconditions. The short version of its lesson, worth knowing before you touch
> anything path-shaped — almost every Windows defect in this codebase has been code that is
> genuinely *correct* on POSIX, which is why reviews and a 6,000-test suite sailed past it.

## What works

- **Terminals** — every local terminal/agent node spawns a real shell from a detected Windows
  profile (see [Windows shell profiles](features/terminals/windows-shell-profiles.md)), with full
  input/output, resize, copy/paste
  (standard Ctrl+C/Ctrl+Shift+C — see the terminal node section of `CLAUDE.md` for the exact
  chord table), and the WebGL/DOM renderer split. The app hosts those shells itself through
  ConPTY; it does not embed Microsoft Windows Terminal.
- **Agent CLIs** (Claude Code, Codex, Gemini, Grok, custom) — spawn and run exactly as they do on
  macOS/Linux. Hook-based status (RUNNING/NEEDS YOU badges, subagent cards, context meter,
  session naming) all work the same way, because the hook server is a plain loopback HTTP server
  with no POSIX dependency.
- **Projects, canvas, kanban board, source control, worktrees** (local repos), **editor/diff
  nodes**, **the command palette**, **notifications**, **local Claude account switching** — all
  Electron-free `src/core` logic, none of it POSIX-specific.
- **SSH projects** — OpenSSH ships as an optional Windows feature since Windows 10 1809 and is
  resolved automatically (see [SSH resolution](#ssh-resolution)); these remain remote sessions
  and never receive a local Windows profile.
- **The Server Edition** — unaffected by any of this; it targets Linux and is unchanged.

## Session continuity

A stock Windows installation has no native tmux. nodeterm therefore keeps local Windows shells in
its standalone **session host**: a detached process that owns the ConPTY sessions and reconstructs
their screens with headless xterm. Closing or crashing the desktop app detaches its clients; the
session host and the processes it owns continue running. Relaunching nodeterm reattaches to the
same session and restores its current screen.

A **machine reboot** still ends those OS processes. On the next launch, nodeterm uses the same
cold-restore path as a rebooted tmux host: it replays the capped scrollback snapshot and resumes a
supported agent CLI from its recorded conversation when possible. See [Session continuity](features/terminals/session-continuity.md)
and [Windows session host](windows-session-host.md) for the backend details.

An attach that is provisional, rejected, or cannot be authenticated fails closed. It is never
reported as persistent, never retained in the local session index, and never replaced by a plain
shell that only appears to be the requested session. The node shows the real attach/spawn reason
so it can be recovered deliberately.

WSL profiles do not depend on a native Windows tmux. They launch the selected distribution's
default Linux shell through `wsl.exe`; the Windows session host owns that process just like the
other profiles.

## What degrades

### Managed Claude accounts / Keychain scoping

Claude Code's per-config-dir Keychain scoping (used to isolate several logged-in identities on
macOS ≥ 2.1) is a macOS-only mechanism. On Windows (as on Linux), account isolation still works
via the config-dir split (`CLAUDE_CONFIG_DIR`), but credential storage is whatever the `claude`
CLI itself does on Windows — nodeterm never writes credentials itself on any platform.

### Codex shared-identity / app-server launcher

The optimization that lets several Codex nodes share one `codex app-server` process (see
`docs/codex-shared-identity.md`) is gated behind a **managed standalone Codex install** at a fixed
POSIX-style path (`~/.codex/packages/standalone/current/codex`) that the mainstream Windows
install of Codex does not produce. The gate (`codexManagedRuntimeInstalled`) simply answers
`false` there, so this degrades automatically and silently to "one `codex` process per node" —
functionally correct, just without the RAM-sharing optimization. Nothing to configure.

## Windows shell profiles

Settings → Shell detects profiles with stable ids: `auto`, `pwsh`, `windows-powershell`, `cmd`,
`git-bash`, one `wsl:<distribution>` for each installed WSL distribution, and `custom` for the
legacy executable setting. `auto` tries PowerShell 7, then Windows PowerShell, then
`%COMSPEC%`/`cmd.exe`. Git Bash is detected from `PATH` and the standard Git for Windows system and
per-user locations. Refresh detection after installing or removing a shell.

One-click terminal creation uses the saved default. Profile submenus let you choose a different
profile for a new node, and the chosen stable id is snapshotted on that node so later default
changes affect only newly created nodes. Existing legacy nodes with no snapshot continue to use
the configured default. A non-empty legacy `defaultShell` becomes the `custom` default without
changing its executable text; absolute custom paths containing spaces are supported.

For WSL, nodeterm enumerates distributions with `wsl.exe --list --quiet`, asks the selected
distribution's `wslpath` to translate the Windows project directory, then keeps the structured
`wsl.exe -d <distribution> --cd <linux-path>` prefix and runs a trusted distro-side cwd guard before
the configured default shell. The guard prevents a directory removed after translation from
silently opening in `/`. A missing distribution, failed translation, or
failed launch is shown as an error for that exact profile. It never opens another distribution or
a different shell in the wrong directory.

Executable paths and launch arguments remain private to the trusted core. Shared project files
and peer mutations carry neither them nor `terminalProfileId`; only the stable id in this
machine's local overlay reaches PTY creation and is revalidated immediately before spawn. See the
full [Windows shell profiles](features/terminals/windows-shell-profiles.md) article for profile
switching and the trust boundary.

## SSH resolution

`ssh`/`scp` are resolved the same way tmux is — PATH first, then a short list of well-known
install locations, all without spawning a login shell synchronously (the same GUI-PATH-gap
concern as every other executable lookup in this app). On Windows the well-known fallback is
`%WINDIR%\System32\OpenSSH\ssh.exe` / `...\scp.exe` — the built-in OpenSSH client feature. If
you've installed a different `ssh` (e.g. via Git for Windows or MSYS2) and it's on your PATH, that
one is found first, exactly as on macOS/Linux.

### Encrypted key passphrases are not prompted for on Windows

On macOS and Linux, a key with a passphrase is handled by an `SSH_ASKPASS` helper: nodeterm
generates a small POSIX shell script and serves the answer over a unix domain socket, so the
prompt appears in the app instead of on a terminal nobody is watching.

**Neither half of that works on Windows.** Windows OpenSSH will not execute a `.sh` helper, and
Node cannot listen on a unix socket at a filesystem path there (it wants a `\\.\pipe\…` name), so
the socket bind fails outright. The consequence is concrete: connecting with an encrypted key gets
no prompt, and the connection fails rather than asking you for the passphrase.

Until this is ported (a named pipe plus a `.bat`/`.exe` askpass helper), use one of:

- an **unencrypted** key for the host, or
- an agent that already holds the decrypted key — `ssh-agent` via the built-in **OpenSSH
  Authentication Agent** service, or Pageant — since a key served by an agent never prompts.

The test that covers this wiring is skipped by condition on Windows (`ssh-project.test.ts`) and
still runs on macOS/Linux, so the POSIX path stays guarded.

## The unsigned-installer warning

**Code signing is permanently out of scope for this project** (see `CLAUDE.md`'s "Permanent
no-signing policy"). The Squirrel.Windows installer this project builds is **not signed**, which
means:

- Windows SmartScreen will very likely show an **"Windows protected your PC"** interstitial the
  first time you run the downloaded `Setup.exe`. Click **More info**, then **Run anyway**. This is
  expected and is not a sign of a corrupted download — it is what every unsigned Windows installer
  looks like, from any publisher, without a paid code-signing certificate.
- Some antivirus/EDR products flag unsigned installers more aggressively than signed ones. If
  yours quarantines the download, that's a false positive from the same root cause, not a real
  detection.
- Automatic updates (via `electron-updater`) also install unsigned builds; there is no additional
  warning for updates beyond the one at first install, since Squirrel's updater does not re-run
  SmartScreen's Mark-of-the-Web check the way a fresh browser download does.

If your organization requires signed installers, you'll need to sign the artifacts yourself as a
post-build step outside this project's build scripts — this repository will never add signing
itself (a durable, explicit project policy, not a missing feature).

## Installing

1. Download `nodeterm-Setup-<version>.exe` from the release you want.
2. Run it. Click through the SmartScreen prompt described above.
3. Squirrel installs per-user (no admin elevation needed) under
   `%LOCALAPPDATA%\node-terminal\` (the package id) and creates Start Menu / desktop shortcuts.
4. Launch **nodeterm** from the Start Menu.

The packaged desktop handles Squirrel's install, update, uninstall, and obsolete-version lifecycle
invocations before normal app startup. Install/update creates the shortcut for the trusted
`nodeterm.exe` target, uninstall removes that same shortcut, and obsolete versions exit without
touching one. These maintenance launches never open a window or initialize settings and terminal
sessions; updater failures exit with an error instead of continuing into an ordinary app launch.

Uninstall from **Settings → Apps** like any other Windows app (Squirrel registers itself with
"Programs and Features" the same way).

## Building it yourself

```powershell
npm install
npm run dist:win
```

`dist:win` is `make-icon` (generates `build/icon.ico` — see below) → `electron-vite build` →
`electron-builder --win --x64`. The output lands in `dist/`: a Squirrel `Setup.exe`, `RELEASES`,
the full `.nupkg` (and generated delta packages on a repeat build against a prior release), plus a
`.zip`.

- **Target**: `squirrel` (per project policy — never NSIS, never portable-only). Requires the
  `electron-builder-squirrel-windows` package, declared as a devDependency alongside
  `electron-builder` itself.
- **Icon**: `scripts/make-icon.mjs` renders the same nodeterm mark SVG used for `build/icon.png`
  into a real multi-resolution `build/icon.ico` (16/24/32/48/64/128/256px PNG-compressed frames
  packed into a hand-written ICO container — no extra npm dependency, and no PNG-renamed-to-.ico
  shortcut). electron-builder reads it via `build.win.icon`.
- **Signing**: `build.win.forceCodeSigning`, `signExecutable`, and `signAndEditExecutable` are all
  explicitly `false` in `package.json`. Nothing in this build path requests, discovers, or invokes
  a signer, per the permanent no-signing policy. Do not add a certificate or a signing script.
- **`npm run rebuild`** still matters on Windows exactly as it does on macOS/Linux: it rebuilds
  `node-pty` (and `smart-whisper`) against Electron's ABI via `electron-rebuild`. The
  `patch-node-pty.mjs` step it runs first patches a **darwin-only** `pty_posix_spawn` fd leak
  (see `CLAUDE.md`) and is a documented no-op on Windows — `src/main/node-pty-patch.test.ts` only
  asserts the marker on the darwin source path.

### Local/CI environments without a Windows machine

`dist:win` (and `electron-builder --win`) can cross-build a Windows Squirrel installer from
macOS/Linux using Wine for the resource-editing step — see electron-builder's own docs for the
Wine prerequisite if you're building off-Windows. Building **on** Windows needs no such setup.

## Known gaps / follow-ups

- **`env(titlebar-area-*)`** — the tab bar currently reserves a fixed 146px on the right for
  Windows' native caption buttons (`titleBarOverlay`) rather than reading Chromium's own
  `titlebar-area-width` CSS environment variable, which would stay exactly correct across DPI
  scales and Windows versions instead of being a reasonable fixed estimate. Tracked as a follow-up
  rather than blocking the initial Windows support pass.
- **Codex/Grok on Windows have not been device-verified** against a real Windows machine as part
  of this change — the platform branches above were built and typechecked, but the existing
  device-checklist discipline this project uses for other agent integrations (`docs/grok-agent.md`,
  `docs/gemini-agent.md`) has not yet been run for a from-scratch Windows install. Treat the agent
  behavior described above as "should work by construction," not "measured."
- **Windows ARM64 (`arm64`)** is not currently packaged — only `x64`. Electron itself supports
  `win32-arm64`, so adding it is a `build.win.target[].arch` addition plus verifying `node-pty`'s
  native rebuild on that architecture; not done here.
