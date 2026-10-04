# Switched-away terminal park

When you switch to another project, its terminals are not torn down at once. Each node's xterm
instance and its attached PTY client are parked off-screen, so switching back re-adopts them
exactly as they were: the alternate screen, mouse modes, scrollback and cursor carry over with no
redraw. The rules live in `src/renderer/terminal/park-budget.ts`; the park itself is in
`src/renderer/nodes/TerminalNode.tsx`.

## Behavior

- **Window.** A parked terminal is kept for `settings.terminalParkMinutes` (default 10). After
  that its PTY client detaches; the tmux or session-host session keeps running and a later return
  is an ordinary warm reattach. `0` keeps parks until the app quits and arms no timer at all.
- **Cap.** At most `settings.terminalParkMax` terminals (default 20) stay parked across all
  projects. Beyond the cap the oldest parks are released first, **local ones before remote ones**:
  an SSH-project node or a relay tab costs a network round trip and a new client to rebuild, a
  local one only a local reattach.
- **Live work is never released by the cap or the window.** On the plain-shell fallback (no tmux,
  no session host) the PTY is the shell itself, so releasing it would end whatever runs there.
  Parks of such sessions are protected while an agent is working or waiting, and now also while
  an agent CLI is believed to be in the pane at all (`agentProcessInPane`), so an idle agent on a
  plain shell is not killed by a project switch.
- **Zoom mouse fix.** The text-selection coordinate fix used under canvas zoom reads each
  element's bounding box at most once per animation frame instead of on every mouse event.

## Configuration

**Settings → tmux** has two rows, **Keep switched-away terminals attached** (minutes, 0 to 1440)
and **Max attached terminals in other projects** (1 to 500). Both are re-validated where they
are read (`parkWindowMs`, `parkCap`), so a hand-edited `settings.json` value outside the range
falls back to the default or the limit. A change applies from the next project switch.

## Failure modes

- A huge window or cap trades memory for speed: about 2 MB per parked tmux-backed terminal, more
  for a plain shell whose scrollback lives in the app, and one local ssh client per remote park.
- The memory-pressure lever still drops every disposable park at once, whatever the settings say.

## Security considerations

Nothing here crosses a process or machine boundary; both values are numbers validated at use.

## Verification

`park-budget.test.ts` pins the validators, the local-before-remote eviction order and the
agent-process protection; `live-work.test.ts` pins the predicate; `scale-fix.test.ts` pins the
once-per-frame rect read.

## Surfaces

Desktop and Server Edition share this renderer code. The mobile companion has no canvas and is
not applicable.

## Not taken

Upstream's lower crisp-text threshold for low-DPI displays (`setWebglDevicePixelRatio`, #986) is
present in `webgl-budget.ts` but not wired: this fork's `raster-scale.ts` already supersamples the
WebGL raster above 100% zoom, and switching those terminals to the DOM renderer past 102% would
undo it. Without a reported ratio the gate keeps its previous thresholds.

Ported from upstream `30fbd95e`, `b894163f`, `f9980d5f`, `cbe6f994` (renderer half),
`e43fe37a`, and the module halves of `9504ff85`, `d63d3b05`, `85fb6758`, `b6ffc06b`.
