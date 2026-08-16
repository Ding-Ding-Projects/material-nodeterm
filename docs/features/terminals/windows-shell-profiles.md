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

Executable paths and launch arguments are private to the trusted desktop core. The renderer sends
only `profileId`, and core validates and resolves that id again at the point of use. A malformed,
unknown, unavailable, or hand-edited id fails closed.

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
remain verbatim facts. Packaged-app interaction and capture evidence is recorded only after it has
been exercised through the required cheap Lowlevel MCP headless Windows route. This article does not claim that the pending packaged interaction or capture verification has happened.

## Suggested articles

- [Session continuity](./session-continuity.md) — persistent session behaviour across detach,
  relaunch, and reboot.
- [Windows user guide](../../windows.md) — installation, packaging, and other Windows-specific
  behaviour.
- [Projects & tabs](../projects/projects-and-tabs.md) — the shared project file and machine-local
  execution overlay.
