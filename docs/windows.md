# nodeterm on Windows

Windows is a first-class desktop target: a native Squirrel.Windows installer, a Windows-shaped
default shell (PowerShell/cmd, not `bash`), and a Material title bar with the native window
buttons on the right instead of macOS's traffic lights on the left.

This page covers what works out of the box, what degrades (and why), how the unsigned installer
behaves, and how to build it yourself.

## What works

- **Terminals** — every terminal/agent node spawns a real Windows shell (see [Default shell
  resolution](#default-shell-resolution) below), with full input/output, resize, copy/paste
  (standard Ctrl+C/Ctrl+Shift+C — see the terminal node section of `CLAUDE.md` for the exact
  chord table), and the WebGL/DOM renderer split.
- **Agent CLIs** (Claude Code, Codex, Gemini, Grok, custom) — spawn and run exactly as they do on
  macOS/Linux. Hook-based status (RUNNING/NEEDS YOU badges, subagent cards, context meter,
  session naming) all work the same way, because the hook server is a plain loopback HTTP server
  with no POSIX dependency.
- **Projects, canvas, kanban board, source control, worktrees** (local repos), **editor/diff
  nodes**, **the command palette**, **notifications**, **local Claude account switching** — all
  Electron-free `src/core` logic, none of it POSIX-specific.
- **SSH projects** — OpenSSH ships as an optional Windows feature since Windows 10 1809 and is
  resolved automatically (see [SSH resolution](#ssh-resolution)); a remote host's own tmux session
  still gives you full continuity even though the local Windows side has none of its own.
- **The Server Edition** — unaffected by any of this; it targets Linux and is unchanged.

## What degrades

### No cross-restart terminal continuity (no tmux)

The single biggest behavioral difference: **there is no Windows build of tmux**, and nodeterm does
not bundle one (the bundled binary in `mac.extraResources` is macOS-only —
`scripts/build-tmux.mjs` never runs for a Windows package). Every terminal on Windows therefore
runs as a **plain shell**, exactly the fallback path macOS/Linux use when tmux is unavailable
there too (see the "Terminal session continuity (tmux)" section of `CLAUDE.md`).

Concretely, on Windows:

- Closing a project tab and reopening it **within the same app run** still works — the renderer
  parks the live shell process for a few minutes (`TERM_PARK_MS`) and reattaches to the *same*
  process, not a tmux session, so this is unaffected.
- **Restarting the app, or rebooting the machine, does not survive.** A terminal's process — and
  anything running in it, including an in-flight agent CLI turn — ends when its plain-shell PTY is
  torn down. There is no scrollback replay and no `claude --resume`/`codex resume` auto-launch on
  the next open, because those only fire for a *cold-started tmux session* (`fresh: true`).
- The **mobile companion app cannot attach** to a Windows-local terminal for the same reason: it
  attaches to a tmux session, and there isn't one. It works normally for an SSH project the
  Windows desktop is *connected to*, because that continuity lives on the remote host's tmux, not
  on the Windows side.
- **Agent hibernation ("Eco")** and other tmux-lifecycle features that assume a session survives a
  detached PTY client are effectively inert on Windows — there's no tmux client to detach in the
  first place, so the plain-shell process (and the agent CLI in it) is what would actually be
  killed. `terminal/live-work.ts`'s "does the kill end live work" gate already protects against
  this for the levers it covers; it is the reason those levers stay conservative rather than
  reaching for it.

**If you want tmux-backed continuity on Windows**, install tmux somewhere it ends up on the
Windows PATH — the most common route is **MSYS2** (`pacman -S tmux`) with its `usr/bin` added to
PATH, or **Cygwin**'s tmux package. **WSL's own tmux does not count**: it runs inside a separate
Linux filesystem/process namespace and is not reachable from a native Windows PATH lookup at all
— running nodeterm *inside* WSL as a Linux app is a different (and, for terminal continuity,
better) option if that fits your workflow, but at that point you are running the Linux build, not
this one. nodeterm's own `findTmux()` skips every macOS/Linux-specific search path on Windows
(there is nothing at `/opt/homebrew/bin/tmux` etc. to find) and goes straight to a PATH lookup, so
a Windows-PATH tmux is picked up with no configuration needed.

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

## Default shell resolution

New terminal/agent nodes resolve a program to run in this order:

1. An explicit program the node was created with (an agent preset's launch command, `ssh` for an
   SSH-project node, etc).
2. `settings.defaultShell`, if you've set one in Settings → Terminal.
3. On Windows: **PowerShell 7+ (`pwsh.exe`)** if it's installed and resolvable (PATH, then the
   default per-machine install location), else **Windows PowerShell (`powershell.exe`)** (always
   present — resolved by PATH, then its fixed `System32\WindowsPowerShell\v1.0` location), else
   whatever `%COMSPEC%` names (normally `cmd.exe`), else a bare `cmd.exe` as the final fallback
   that can never come back empty.
4. On macOS/Linux: `$SHELL`, else `bash`.

## SSH resolution

`ssh`/`scp` are resolved the same way tmux is — PATH first, then a short list of well-known
install locations, all without spawning a login shell synchronously (the same GUI-PATH-gap
concern as every other executable lookup in this app). On Windows the well-known fallback is
`%WINDIR%\System32\OpenSSH\ssh.exe` / `...\scp.exe` — the built-in OpenSSH client feature. If
you've installed a different `ssh` (e.g. via Git for Windows or MSYS2) and it's on your PATH, that
one is found first, exactly as on macOS/Linux.

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
   `%LOCALAPPDATA%\nodeterm\` and creates Start Menu / desktop shortcuts.
4. Launch **nodeterm** from the Start Menu.

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
