# Hook settings preservation

**Category:** [Agents](./README.md)

nodeterm learns an agent's state from that agent's own hooks, so at every launch it merges one
managed hook entry into the agent's configuration. For Claude and Gemini that configuration is the
user's own `settings.json`, shared with every other tool the user runs. The installer therefore
treats the file as the user's data: it adds or refreshes its own entry and changes nothing else,
and when it cannot read the file with certainty it changes nothing at all.

## Behavior

- **One guarded transaction for every user-owned file.** The Claude and Gemini `settings.json`
  merges (system and managed-account config directories), the fullscreen-TUI default, and the
  marker blocks in `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`, Copilot's
  `copilot-instructions.md` and opencode's `AGENTS.md` all go through
  `src/core/agents/hooks/settings-file.ts`. It takes a per-file lock, reads the file through one
  open descriptor, stages the new bytes in a unique temp file with the original mode, checks that
  the file still holds exactly what it read, and only then renames the temp onto the resolved
  target.
- **Only `ENOENT` means "no file".** A missing file is created (mode `0600` for settings, `0644`
  for instruction files). A file that exists but cannot be read, is not a regular file, or does not
  parse as a JSON object is left byte-for-byte as found. A blank file (zero bytes or whitespace) is
  a successful read of nothing, so it is treated as `{}` and restored with the managed entry.
- **Hook shapes the installer cannot interpret are refused.** A `hooks` value that is not an
  object, a definition that is not an object, or a handler list that is not an array of objects
  makes the merge throw, which leaves the file untouched. A non-array value on an event nodeterm
  does not subscribe to is left exactly as found while the subscribed events still get the hook.
- **Other tools' hooks survive at the handler level.** The merge and the uninstall remove only
  handlers whose command carries nodeterm's own `agent-hooks/<agent>.sh` marker (or the legacy
  `claude-signals` marker). A user who hand-merged nodeterm's command into one of their own
  definitions keeps their own handler; a definition left empty disappears.
- **Symlinks and modes are kept.** A dotfile-managed `settings.json` that is a symlink is updated
  at its resolved target and stays a symlink; the existing permission bits are carried over. A
  dangling symlink is not repaired.
- **Uninstall never creates a file.** Removing the managed hooks from a missing settings file is a
  no-op, and a blank, malformed or unreadable file is left alone.
- **Grok's file is owned, so it is healed.** Grok merges every `$GROK_HOME/hooks/*.json`, so
  nodeterm owns `nodeterm-status.json` outright. That file alone is rebuilt when it is malformed
  and is published by temp + rename (`atomicConfig: true` on the Grok installer).
- **Files nodeterm owns are published atomically.** The canvas-control and context-link shims (mode
  `0755`) and skills, and the Copilot hook file, are written through `writeManagedHookFileAtomic`
  (temp + rename), so an agent never executes a half-written shim.

## Configuration

There is no setting. The behavior applies to every launch-time hook install on the desktop app and
the Server Edition, and to the SSH remote installers, which use the matching shell transaction in
`src/core/agents/hooks/remote-settings-file.ts`.

## Failure modes

- A held lock (`<file>.nodeterm-lock`) means another nodeterm writer is updating the file; this
  launch skips it and the next launch tries again. A lock left behind by an interrupted writer is
  named in the warning and must be removed by hand after every writer has stopped.
- A malformed or unreadable settings file means that agent's sessions run without status hooks
  until the user repairs the file; nodeterm never replaces it. The session itself still starts.
- A concurrent change by another program between the read and the rename makes the transaction
  give up rather than publish stale content. Other programs do not honor the lock, so the final
  comparison narrows that race but cannot remove it.

## Security considerations

The transaction never follows a symlink swapped in after the target was resolved (`O_NOFOLLOW` on
POSIX, plus a second target resolution immediately before publication), never reads a FIFO, and
never writes through a dangling link. No credential is read or written by this path; it only
merges hook commands that point at nodeterm's own guarded script.

## Surfaces

- **Desktop:** full, at launch and when a managed Claude account is added.
- **Server Edition:** full; the same core installers run at server start.
- **Mobile companion:** not applicable. The phone installs no hooks.

## Verification

- `src/core/agents/hooks/install-helper.fs.test.ts` drives the real installer against real files:
  creation on `ENOENT`, blank-file restore, mode and symlink preservation, a dangling link left
  alone, seven malformed shapes preserved through install and uninstall, an unreadable file left
  alone (skipped when running as root), a hand-merged handler kept, uninstall never creating a
  file, and the owned Grok file healed.
- `src/core/agents/hooks/settings-file.test.ts` and `settings-file.read-error.test.ts` cover the
  local and remote transactions, including symlink retargeting during the update and read errors.
- Removing the invalid-hooks check from `mergeManagedHook`, or routing shared settings back to the
  plain overwrite, turns those suites red.
