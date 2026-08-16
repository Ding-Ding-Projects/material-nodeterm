# nodeterm on Windows

Windows is a first-class desktop target: a native Squirrel.Windows installer, a Windows-shaped
default shell (PowerShell/cmd, not `bash`), and a Material title bar with the native window
buttons on the right instead of macOS's traffic lights on the left.

This page covers what works out of the box, what degrades (and why), how the unsigned installer
behaves, and how to build it yourself.

> **Changing the code rather than using it?** [`windows-support.md`](windows-support.md) is the
> contributor page: the platform-difference defects found so far, the guards that now catch them,
> and the build preconditions. The short version of its lesson, worth knowing before you touch
> anything path-shaped — almost every Windows defect in this codebase has been code that is
> genuinely *correct* on POSIX, which is why reviews and a 6,000-test suite sailed past it.

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
- Automatic updates use Electron's built-in Squirrel updater and also install unsigned builds;
  there is no additional warning beyond the one at first install, since Squirrel does not re-run
  SmartScreen's Mark-of-the-Web check the way a fresh browser download does.

If your organization requires signed installers, you'll need to sign the artifacts yourself as a
post-build step outside this project's build scripts — this repository will never add signing
itself (a durable, explicit project policy, not a missing feature).

## Automatic updates

A packaged Windows install checks the project's stable GitHub Release on launch and every six
hours. If a newer Squirrel package is available, nodeterm downloads it without blocking the
terminal and shows a minimizable card. The card's moving bar is intentionally indeterminate:
Squirrel does not provide byte-level progress, so a numeric percentage would be misleading.
**Restart to update** is the explicit way to restart immediately, and repeated clicks cannot start
a second installation. If a successfully downloaded update is left ready, Squirrel may apply it
on your next normal app launch even when you did not use that button.

If the update service is offline or returns 404, the current version keeps running. Scheduled
checks quietly retry later; a check you start reports the problem without turning it into a false
“no update exists” result. Stable updates come only from a manually dispatched `main` release;
automatic publication is disabled. Version `0.4.0` is a candidate, and manual publication remains
pending the real packaged transition checks.

**If you have Windows `0.3.0`, its update check cannot find `0.4.0`.** That version expected NSIS
metadata from the old generic feed, while Windows releases contain Squirrel packages, so a manual
`0.4.0` Setup is required. Closing the old app first is the provisional recommendation, not yet a
verified sequence: the final real-Windows proof must try Setup with `0.3.0` both closed and running
and the release instructions must publish the supported state. Once migrated, the new Squirrel
updater can discover later releases.

## Installing

1. Download `nodeterm-Setup-<version>.exe` from the release you want.
2. Run it. Click through the SmartScreen prompt described above.
3. Squirrel installs per-user (no admin elevation needed) in its package-specific directory under
   your local application-data folder and creates Start Menu / desktop shortcuts. Resolve that
   location from the installed shortcut or uninstall registration rather than relying on a
   hard-coded implementation path. The `node-terminal` package identity itself stays unchanged
   across `0.3.0` → `0.4.0` so Squirrel can update it in place.
4. Launch **nodeterm** from the Start Menu.

Uninstall from **Settings → Apps** like any other Windows app (Squirrel registers itself with
"Programs and Features" the same way).

## Building it yourself

```powershell
npm install
npm run dist:win
```

`dist:win` runs the Windows preflight, regenerates `build/icon.ico`, verifies that exact ICO is
committed and downloadable at the current source SHA, builds with electron-vite, then invokes
electron-builder's x64 Squirrel target with that immutable URL. The supported command is
Windows-only, and the source commit must already be available from the public GitHub repository so
the exact-SHA HTTP proof can succeed. The output lands in `dist/squirrel-windows/`: a Squirrel
`Setup.exe`, `RELEASES`, and the full `.nupkg` (plus a delta only when Squirrel deliberately emits
one). This command does not build the zip target configured for broader packaging.

- **Target**: `squirrel` (per project policy — never NSIS, never portable-only). Requires the
  `electron-builder-squirrel-windows` package, declared as a devDependency alongside
  `electron-builder` itself.
- **Icon**: `scripts/make-icon.mjs` renders the same nodeterm mark SVG used for `build/icon.png`
  into a real multi-resolution `build/icon.ico` (16/24/32/48/64/128/256px PNG-compressed frames
  packed into a hand-written ICO container — no extra npm dependency, and no PNG-renamed-to-.ico
  shortcut). The ICO is committed so Squirrel's Apps & Features URL can name a full immutable
  source SHA. Packaging verifies the URL download, semantic nuspec ID/version/title, and
  Setup/app/execution-stub PE icon and version metadata byte-for-byte before success. Squirrel's
  vendor `Update.exe` remains vendor-branded and outside this gate because the pinned builder
  plugin exposes no supported project hook for rewriting it.
- **Signing**: `build.win.signExecutable` and root `build.forceCodeSigning` are explicitly `false`
  in `package.json`; the produced installer is intentionally unsigned. `build-installer.bat` and
  the publication workflow accept only exact Authenticode `NotSigned`.
  `build.win.signAndEditExecutable` stays enabled at its default so icon and version resources are
  still written; signing and resource editing are separate controls. Do not add a certificate or
  signing script.
- **`npm run rebuild`** still matters on Windows exactly as it does on macOS/Linux: it rebuilds
  `node-pty` (and `smart-whisper`) against Electron's ABI via `electron-rebuild`. The
  `patch-node-pty.mjs` step it runs first patches a **darwin-only** `pty_posix_spawn` fd leak
  (see `CLAUDE.md`) and is a documented no-op on Windows — `src/main/node-pty-patch.test.ts` only
  asserts the marker on the darwin source path.

### Windows host requirement

The supported `npm run dist:win` wrapper refuses non-Windows hosts. Invoking electron-builder
directly to cross-build would bypass the source, inventory, PE-resource, and identity gates above
and is not a supported release path.

## Known gaps / follow-ups

- **The one-time production migration is pending.** A real Windows `0.3.0` install still needs to
  be upgraded by manually running `0.4.0` Setup in separate closed-app and running-app trials, then
  checked for settings, shortcuts, executable metadata, and uninstall registration continuity.
  Those trials must establish which sequence the release instructions support.
- **The new updater interaction is separately pending.** The controller and loopback fixture are
  covered by deterministic checks, but the isolated `0.4.0-fixture.1` → `.2` pair has not yet
  been installed, downloaded, restarted, and checked through Settings → Updates / installed
  metadata in a Windows Sandbox/VM. Automatic publication is disabled; the workflow remains
  manually dispatchable, and manual publication awaits both proofs and the final release audit.
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
