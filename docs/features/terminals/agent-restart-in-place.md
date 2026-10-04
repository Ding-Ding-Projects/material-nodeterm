# In-place agent restart and Eco quit

"Restart agent (resume)", the bulk "restart idle agents" action, "Restart agent and shell" and the
Eco hibernation sweep all quit an agent CLI inside its own terminal pane and later resume the same
conversation with the CLI's own `--resume`. This article covers how the quit is sent and how long
the app keeps watching for it. The rules live in `src/renderer/terminal/agent-restart.ts`.

## Behavior

- **Quit keystrokes per agent.** Claude, Grok and the agents whose composer would swallow a typed
  command are quit with Ctrl-C presses instead of a typed `/exit` or `/quit`: three for Claude and
  Grok, two for Codex, opencode and Copilot, 150 ms apart. A typed exit line could land inside a
  composer popup or a half-written prompt and be sent as text; a run of interrupts reaches the CLI's
  own quit path from any state. Gemini still receives its bare documented `/quit`.
- **opencode is restartable and can hibernate.** It is resumable and now has an exit entry, so the
  node menu, the bulk restart and Eco all accept it.
- **A slow quit is still watched.** The base exit window is 6 s. A user-requested restart keeps
  polling the pane for up to 60 s more while the pane can still be read (`RESTART_LATE_EXIT_MS`),
  so a CLI that takes a moment to quit is still resumed. Eco keeps the bare 6 s window because its
  sweep is serialized across the canvas.
- **The failure notice carries the resume line.** If the pane never returns to a shell, the notice
  names the full window and includes the exact `--resume` line to type once the CLI has quit, so a
  CLI that quits after the app stopped watching does not leave a bare shell with no way back.

## Configuration

There is no setting for the quit keystrokes or the windows; Eco itself stays opt-in under
**Settings → Agents**. The restart actions are hidden for an agent that has no quit entry.

## Failure modes

- A pane that cannot be read (no persistent session backend) ends the restart as before; nothing
  is ever killed by the app.
- A busy (`working`) or `blocked` session is still refused for the in-place restart, because any
  keystroke would answer the prompt the CLI is showing.
- The resume line delivery keeps the existing echo-verified writer and its Ctrl-C retry, which is
  what PowerShell's line editor honors.

## Security considerations

The resume line in the notice is built by `resumeCommand`, which refuses a session id that is not
safe to put on a command line, so a hand-edited project file cannot inject text through it.

## Verification

`src/renderer/terminal/agent-restart.test.ts` pins the Ctrl-C counts and spacing, the late exit
window, the notice text and the opencode split delivery; `hibernation-policy.test.ts` pins that an
agent without a quit entry is never planned.

## Surfaces

Desktop and Server Edition share this renderer code. The mobile companion has no restart action
and is not applicable.

Ported from upstream `ff365255`, `00d92ea8`, `81da4c5e`, `1a1c5285`, `72110c57`, `d8e89701` and
`43bfc1a4`.
