# Stale working directory banner

If a project folder is deleted while a terminal's tmux session keeps running, and the folder is
then re-created at the same path, the reattached shell keeps printing `getcwd: cannot access
parent directories` forever: it still holds the deleted directory, and the new folder with the
same name is a different directory. A new terminal is fine, because a fresh spawn re-checks the
node's folder. The reattached one is now flagged.

## Behavior

- **Detection (core).** On a warm reattach of a local tmux session, `PtyManager.create` asks tmux
  for the pane's `#{pane_current_path}` with the exact target `=nt-<id>:` and classifies the answer
  with `classifyPaneCwd` (`src/core/pane-cwd.ts`). On Linux the kernel names the dead directory
  `<path> (deleted)`, which is definite; on every platform a reported path that no longer exists
  is stale; on macOS an empty answer is stale (tmux cannot name an unlinked directory there). Any
  failure, and an empty answer on other platforms, means "unknown" and raises nothing.
- **Banner (renderer).** The verdict rides `PtyCreateResult.staleCwd`. The node shows a slim banner
  along its top edge, never a cover over the terminal, saying the folder was deleted or replaced,
  with **Restart in folder** and a dismiss button. Restart ends the old tmux session and starts a
  fresh shell in the node's folder, the same recycle a model switch uses. Nothing is typed into the
  pane and nothing restarts on its own. Every later create result re-states the flag, so a clean
  respawn clears the banner.
- The node's visible-state gate (`sameTerminalCoState`) now compares this flag too, so a write
  that only changes it is never swallowed.

## Configuration

None.

## Failure modes

- SSH-project nodes are not probed: their working directory lives on the host, and a remote probe
  is not built. Session-host (Windows) sessions and plain shells are not probed either.
- Restart in folder ends whatever is still running in that terminal; the button's tooltip says so.
- If the folder does not exist at all when you restart, the fresh shell starts wherever a new
  terminal would (the spawn path's own folder check applies).

## Security considerations

The probe is one read-only `display-message` against an exact session name; no path from the
pane is ever executed or typed anywhere.

## Verification

`pane-cwd.test.ts` covers the classifier, `pane-cwd.realtmux.test.ts` reproduces the delete and
re-create against a real tmux, and `co-state-equality.test.ts` pins the visible-state gate.

## Surfaces

Desktop and Server Edition (the probe is in core and the result passes through both bridges
unchanged). The kanban card modal shows the live pane while the banner lives on the canvas node.
The mobile companion is not applicable.

Ported from upstream `eb3e520f`.
