# Cognition Devin CLI

**Category:** [Agents](./README.md)

nodeterm includes first-class support for Cognition's Devin CLI. The integration is grounded in
the measured `devin 3000.4.25 (7e8e528a)` behavior recorded in upstream issue
[`eneskirca/nodeterm#447`](https://github.com/eneskirca/nodeterm/issues/447). It does not inherit
Claude, Codex, Gemini, opencode, Grok, or Copilot behavior.

## Launch forms

The builtin registry identifies the executable as `devin`, presents the label `Devin`, uses the
Devin mark, and recognizes the foreground process as `devin`. An unavailable executable remains an
honest unavailable node; nodeterm does not substitute another CLI.

The measured command forms are:

| Use | Command shape | Boundary |
| --- | --- | --- |
| Interactive REPL | `devin` | No initial prompt. |
| Interactive prompt | `devin -- <prompt>` | `--` keeps prompt words from being parsed as subcommands. |
| Prompt file | `devin --prompt-file <file>` | The file path is selected locally and shell-quoted. |
| Single-turn print | `devin -p -- <prompt>` | Prints one response and exits. |
| Resume a session | `devin -r <session-id>` | Requires a measured `session_id` from Devin. |
| Continue | `devin -c` or `devin -c <session-id>` | Uses the most recent session unless an id is supplied. |

The main launch path uses argv prompt injection. There is no plain prompt-stdin mode for the main
CLI. Devin's ACP mode is a separate JSON-RPC protocol and is not silently treated as an interactive
REPL.

## Lifecycle hooks and status

For a local project, nodeterm installs its observer command into the project-level
`.devin/hooks.v1.json` file immediately before a Devin node starts. The file is Devin's direct event
map, so existing user-authored hook definitions remain in place and only nodeterm's managed entry is
replaced on reinstall. The subscribed events are:

`PreToolUse`, `PostToolUse`, `PermissionRequest`, `UserPromptSubmit`, `Stop`, `PostCompaction`,
`SessionStart`, and `SessionEnd`.

The command reads the event JSON on stdin and posts a bounded, authenticated status payload to the
local nodeterm hook server. It exits successfully without returning a decision, so the integration
is observation-only. It never blocks a tool, rewrites tool input, or claims to answer a Devin
permission request.

The shared status mapping is:

| Devin event | nodeterm state | Meaning |
| --- | --- | --- |
| `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostCompaction` | `working` | The session is active. |
| `PermissionRequest` | `blocked` | Devin is asking for a permission decision; the user must answer in Devin. |
| `Stop` | `done` | The current turn stopped. |
| `SessionEnd` | session end | The session ended and its status state is reset. |
| Unknown event | no event | Unknown facts are not guessed into a state. |

Devin also emits terminal BEL, OSC 9, and OSC 777 notifications according to its `notify` setting.
nodeterm exposes a parser for those as a fallback only. A bare BEL has no semantic payload and is
reported as unknown. OSC messages are classified only when their text explicitly indicates input,
permission, approval, completion, or stopping. They never become a fabricated structured hook
event.

## Session identity and capability boundaries

Devin supplies a stable `session_id` in hook payloads. nodeterm learns and uses that id for measured
resume forms. It does not mint a caller-selected id, because that flag was not measured for this
CLI.

The following capabilities are deliberately not advertised for Devin in this lane:

- context-window or billing usage meters, because no trustworthy denominator and usage payload were
  measured;
- nodeterm permission-mode controls, because observing `PermissionRequest` does not prove that
  nodeterm can set or override Devin's permission policy;
- session title read or rename, subagent cards, conversation transfer, branching, canvas-control
  skill injection, and shared identity, because their Devin contracts were not measured;
- structured chat transcript rendering, because hooks alone are not a transcript format.

This distinction matters: an unavailable capability is shown as unavailable rather than being
borrowed from another agent's flags, token formula, title format, or hook dialect.

## Configuration and privacy

The managed script lives in the local nodeterm application-data area. The project hook file contains
only the managed command definition and user-authored hook definitions. Devin login state, account
data, and credentials remain under Devin's own local configuration and are never copied into a
project file, export, log, hook payload, or nodeterm setting.

Desktop and Server Edition both use the shared core spawn path, so local Devin projects receive the
same project-level hook installation and status normalization. An SSH project currently skips the
write because its project root is on the remote host and the existing remote hook setup does not
yet carry a safe project-root file-write route. SSH Devin remains usable as a terminal node with
launch and process status, but no structured Devin hook status is claimed there.

## Verification boundary

The registry, command builders, hook config merger, project spawn wiring, status normalizer, and
notification parser are source-level implementation. The real Devin binary was not available in
this lane, so no runtime launch, hook delivery, status transition, resume, print, prompt-file,
availability, Desktop, Server Edition, or SSH behavior is claimed as runtime-verified. The lane also
intentionally ran no tests, lint, type checks, builds, packaging, debugging, reviews, audits, or
HuiShots.

## Suggested articles

- [Agent support](./agent-support.md) — shared status, capability membership, and configuration.
- [Session continuity](../terminals/session-continuity.md) — how resumable CLIs are relaunched.
- [SSH projects](../remote/ssh-projects.md) — remote hook and launch boundaries.
- [In-app documentation browser](../help/in-app-documentation.md) — how this article is bundled
  for offline reading.
