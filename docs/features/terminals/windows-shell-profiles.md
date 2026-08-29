# Windows shell profiles

**Category:** [Terminals](./README.md)

The Windows desktop app creates local terminals from named profiles instead of accepting an
executable-and-arguments pair from canvas state. A profile is a stable, machine-local choice;
the trusted desktop core resolves its executable and launch arguments immediately before the
PTY is spawned.

This feature applies only to local terminals and agent nodes in the Windows desktop app. It does
not embed Microsoft Windows Terminal, change the Server Edition or mobile companion, or replace
the remote shell selected by an SSH project.

## Profiles

The detected catalog uses stable ids:

| Id | Label and behaviour |
| --- | --- |
| `auto` | Automatic: PowerShell 7, then Windows PowerShell, then `%COMSPEC%`/`cmd.exe`. |
| `pwsh` | PowerShell 7, when `pwsh.exe` is installed. |
| `windows-powershell` | Windows PowerShell, when `powershell.exe` is installed. |
| `cmd` | Command Prompt, resolved from `%COMSPEC%` and the system `cmd.exe`. |
| `git-bash` | Git Bash, detected from `PATH` and the standard system and per-user Git for Windows locations. |
| `wsl:<distribution>` | One entry for each distribution reported by `wsl.exe --list --quiet`. The distribution name, including spaces, is part of the id. |
| `custom` | The executable in the compatibility `defaultShell` setting. Absolute paths containing spaces are supported. |

Settings → Shell lists the catalog, shows why an unavailable profile cannot be used, and can
refresh detection after a shell or WSL distribution is installed or removed. The custom profile
keeps an executable picker/text field for advanced setups.

Detection refresh evaluates the effective active-project custom executable without persisting it
as a global default. The renderer sends one bounded control-character-free string for that
read-only refresh; the trusted desktop service uses it only while deriving the public availability
row. It is never stored by the refresh path and never becomes launch arguments. Global and sparse
project persistence remains owned by the shared Settings store.

An explicit profile never silently changes identity. If PowerShell 7, Git Bash, or a selected WSL
distribution later disappears, an existing node reports that profile as unavailable and offers a
profile choice; it does not open cmd, another distribution, or the automatic profile instead.
Only `auto` performs its documented precedence search.

## Defaults and per-node snapshots

Every one-click creation path uses `defaultTerminalProfileId`: the keyboard shortcut, command
palette, sidebar, canvas, group, dock, and kanban board. Creation menus that can show alternatives
also provide **New terminal with profile**. Choosing an alternative snapshots its stable id on the
new node.

Changing the default therefore affects only terminals and agent nodes created later. Existing
nodes keep their snapshotted profile. A node created before profile snapshots existed has no
profile id and continues to use the current configured default.

Settings migrate without changing existing custom-shell behaviour:

- an empty legacy `defaultShell` selects `auto`;
- a non-empty legacy `defaultShell` selects `custom` and retains the executable text exactly.

The selected label appears in terminal metadata so PowerShell, Command Prompt, Git Bash, and
individual WSL distributions remain distinguishable on a mixed canvas.

## WSL working directories

A WSL profile means the selected distribution's configured default Linux shell. Before spawning,
the trusted core asks that same distribution's `wslpath` to translate the Windows project
directory. It keeps the structured `--cd` launch and adds a trusted distro-side guard:

```text
wsl.exe -d <distribution> --cd <translated-linux-path> --exec /bin/sh -c <trusted-cwd-guard> nodeterm-wsl <translated-linux-path>
```

The guard receives the Linux path as a positional argument, independently changes to it, and only
then replaces itself with the distribution's configured default shell. This closes a WSL behavior
where a directory disappearing after translation can otherwise print a warning, return success,
and silently open in `/`.

Distribution enumeration handles the UTF-16 and NUL-padded output produced by Windows `wsl.exe`;
a distribution name containing spaces remains one argument. Enumeration failure, a missing
distribution, cwd-translation failure, or launch failure is an actionable unavailable/spawn
error. None of those cases falls back to a different distribution or opens a shell in the wrong
directory.

## Switching an existing node

**Restart with profile…** is available from terminal and agent-node menus. This is deliberately
destructive: the confirmation states that the live process and its persistent session will end.
On confirmation, nodeterm destroys the old session, updates the machine-local profile snapshot,
and recreates the node with the selected profile. Cancellation changes neither the node nor its
running session.

This is different from restarting an agent CLI inside its existing shell: switching profiles
replaces the shell and therefore cannot preserve the process that shell owns.

## Trust boundary

Executable launch paths and launch arguments are private to the trusted desktop core. The renderer
sends only `profileId` for launch, and core validates and resolves that id again at the point of
use. For read-only detection refresh only, the renderer may send the bounded effective custom
executable setting described above; it is validated again, used only for availability, and never
stored or executed by that call. A malformed, unknown, unavailable, or hand-edited id fails closed.

`terminalProfileId`, the legacy custom `shell`, and advanced SSH execution fields live in the
machine-local `LocalNodeExec` overlay. They are stripped from `.nodeterm/project.json`, portable
exports, and inbound canvas traffic. A cloned project or peer mutation therefore cannot choose a
local executable, inject arguments, or replace this machine's profile snapshot. SSH-project nodes
remain remote and never receive a local Windows profile.

## Session continuity

The selected shell runs through nodeterm's Windows session host when that persistence backend is
active. Closing and relaunching nodeterm detaches and reattaches to the same process and rebuilt
screen. A machine reboot still ends the OS process; the normal cold-snapshot and resumable-agent
recovery path applies after reboot. See [Session continuity](./session-continuity.md) and
[Windows session host](../../windows-session-host.md).

## Verification status

Behavioral tests cover detection precedence, executable availability, custom paths containing
spaces, `%COMSPEC%`, malformed ids, WSL UTF-16/NUL parsing, distribution names containing spaces,
cwd conversion failures, spawn resolution, settings migration, machine-local stripping, creation
snapshots, and fail-closed attach handling. The old source-scanning shell regression test was
replaced by resolver and spawn behaviour tests.

Profile-specific Settings, creation, unavailable-state, restart, header, and recovery copy is
registered for every shipped app language and passes through the local personal-vocabulary
boundary; detected profile names, WSL distribution names, executable paths, and host diagnostics
remain verbatim facts. Capture evidence is recorded only after it has been exercised through the
required cheap Lowlevel MCP headless Windows route.

Packaged-app interaction **is** exercised, by `npm run check:wired` against the real built
artifact. Three cases in `scripts/check-app-wired.mjs` drive this feature end to end over CDP in
a disposable profile: `terminal-profile-picker` opens Settings → Shell, checks the picker offers
exactly the catalog core detected and leaves selectable only what this machine actually has, then
moves the default and reads it back out of main; `terminal-profile-spawn` creates a terminal from
the canvas menu under a named profile, confirms the node reaches a live terminal under it, and
confirms an unknown profile id is REFUSED rather than quietly becoming another shell;
`terminal-profile-restart` takes a live node through **Restart with profile…** and its two-key
destructive gate, and requires both the relaunched node and main’s workspace to agree on the new
profile. Those three cases are win32-only and declare a skip, with its reason, on any other host.

Capture evidence remains pending. This article does not claim that the pending capture
verification has happened.

What changed is *why* it is pending. Until recently the blocker was structural rather than
practical: `scripts/run-windows-profile-packaged-acceptance.mjs` produced real packaged evidence
but wrote it to a disposable task root, and the contract read a committed manifest, and nothing
carried one to the other. Somebody could have done the whole run and still had nowhere to put the
result. The obvious shortcut — hand-adding the ids to `docs/assets/shots/capture-manifest.json` —
is self-erasing (`capture-shots.mjs` rewrites that file wholesale on every `npm run shots`) and
dishonest besides, since one manifest declares one `method` and that file's method describes the
unpackaged CDP sweep against a different artifact.

So packaged evidence now has its own committed manifest,
`docs/assets/shots/packaged-capture-manifest.json`, written only by
`node scripts/promote-packaged-captures.mjs --evidence <acceptance manifest>` and untouched by the
capture sweep. That promoter is deliberately hostile: it verifies the schema version, that the
route passed, that the method names the cheap headless route, that every required id is present,
that every referenced PNG opens and carries the real PNG signature, clears the 6000-byte
blank-frame floor and matches its own recorded `sha256`, and that the recorded `gitHead` is a real
commit in this repository. It refuses on the first unmet condition and writes nothing — a
half-promoted manifest is worse than none, because it reads as evidence.

The mechanism exists; the evidence does not. What is left is running the harness on a Windows
machine against a packaged build of the commit under test.

## Windows multiplexer discovery

The desktop core resolves the persistent multiplexer without trusting a renderer-supplied path or
spawning a shell on the UI thread. It checks the normal Windows `PATH` using the host's `PATHEXT`
rules, then prefers `tmux` and finally `psmux`. A bare name is never treated as an executable on
Windows, because a directory with that name must not be mistaken for a runnable program. The POSIX
fixed locations are skipped on Windows because they cannot identify a Windows binary.

When `psmux` is missing and the host exposes the verified Windows Package Manager executable, the
non-blocking continuity banner offers the exact command `winget install -e --id marlocarlo.psmux`
in a terminal node. The command uses the package identity rather than an arbitrary search term, and
the banner remains visible while installation is running. Discovery repeats after installation so
new terminals use the detected backend without restarting the app. Existing plain-shell nodes are
not silently migrated; restart that node deliberately if continuity is needed.

If the package manager is unavailable, the banner says so and keeps `psmux` unavailable. It does
not invent a download URL, silently use another shell, or claim continuity. The Windows session
host remains the supported fallback, so terminals stay usable with an explicit limitation.

Executable paths, package-manager state, and process state remain machine-local. They never enter
the portable project projection, exports, peer mutations, or shared node metadata. Importing a
project therefore performs no installation, process launch, or network action.

## Suggested articles

- [Session continuity](./session-continuity.md) — persistent session behaviour across detach,
  relaunch, and reboot.
- [Windows user guide](../../windows.md) — installation, packaging, and other Windows-specific
  behaviour.
- [Projects & tabs](../projects/projects-and-tabs.md) — the shared project file and machine-local
  execution overlay.
