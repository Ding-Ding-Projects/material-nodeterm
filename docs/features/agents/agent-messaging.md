# Seamless agent messaging

**Category:** [Agents](./README.md)

Agent messaging lets one control-capable agent node send a bounded message to another agent node in
the same project. The message is stored in the local mailbox first, then delivered only when the
target passes the project's messaging capability, identity, flow, pane, and idle-state checks.
This is a messaging path between agent nodes, not a general terminal-writing shortcut.

## Behaviour

`send` creates a new message and `reply` creates a message in the original conversation. The
recipient sees the sender, recipient, timestamp, subject, body, message id, and the command shape
for replying. `notify` remains app-owned text and is delivered through the same main-process
service without accepting caller-supplied body text.

When the message cannot be delivered immediately because the target is busy or between sessions,
it remains queued for the existing bounded idle-delivery path. Queue capacity and message lifetime
remain finite, and an expired message is reported as expired rather than disappearing. A successful
delivery is marked delivered only after the target accepts it.

## Configuration

The **Seamless agent messaging** switch in **Settings → Agents** is off by default. With it off,
every `send` or `reply` request opens the existing confirmation surface, and the caller receives a
clear refusal when that surface is already handling another decision. Confirming sends through the
same mailbox and delivery service as the confirmation-free path; cancelling returns `denied by
user` and sends nothing.

With the switch on, `send` and `reply` use the same delivery service without opening the
per-message confirmation surface. The setting only removes that repeated human click. The active
project's `agentMessaging` capability, machine-local consent, sender and target scope, idle-agent
checks, rate limits, pane ownership checks, and delivery trace remain required. Closing a node
always confirms at every setting value.

The switch is global to the app's settings and persists through the normal settings store. The
project messaging capability remains a separate project-level choice because the project file is
shared and can be cloned. A cloned project never becomes a grant on this machine until its user
explicitly keeps the capability. Per-node-pair grants from the original upstream proposal are not
used here: the current node-scoped delivery service provides the safer shared substrate, and the
older asserted-source pair key was removed upstream because the hook bearer did not identify the
calling node.

## Portability

The project file carries only the safe `agentMessaging` capability intent. Settings, mailbox
records, credentials, active process state, machine paths, and delivery runtime state stay local.
Importing or reopening a project performs no message delivery, process launch, provider mutation,
or network action. The receiving machine must explicitly keep the project capability before its
agent nodes can message one another.

## Failure modes

- A missing or declined project capability is refused before any pane operation.
- Self-send, cross-project, ambiguous, or unsafe node ids are refused before a mailbox record is
  created.
- A busy or hibernated target is queued only through the bounded idle-delivery path. A real
  non-agent pane is not treated as an agent target.
- A full queue, expired message, rate limit, stale status, missing session, or failed delivery is
  returned as a typed outcome. The caller is never told that queued bytes were delivered.
- If the confirmation surface is already occupied, the new request is rejected without replacing
  or stacking the existing decision. The original request therefore keeps its reply channel.
- The hook server keeps its bounded `CONTROL_CEILING_MS` after request-body receipt. This preserves
  a long confirmation window without returning to an unbounded socket or reviving the old
  two-second receive-phase failure.

## Security considerations

Messages can steer the agent that reads them, so the capability is deliberately opt-in and the
default is confirmation-required. Main resolves project scope and capability state from its own
stores, rather than trusting the renderer's target claims. Delivery also rechecks live target state
before writing, serializes writes against restart and wake operations, and records outcomes for
later inspection. Credentials, hook tokens, message bodies in public records, and machine-local
paths are not written to the shared project file.

## Verification boundary

This Program 58 ultra-speed lane intentionally did not run tests, type checks, lint, reviews,
security checks, accessibility checks, installer execution, runtime interaction checks, or UI
captures. The implementation and generated offline documentation bundle were updated from the
current source tree. A later full-delivery lane must exercise the setting off and on, confirmation
cancel/confirm, queued and expired outcomes, reload persistence, and packaged desktop behavior.

## Suggested articles

- [Agent support](./agent-support.md): status hooks, agent capabilities, and project settings.
- [Context links](../canvas/canvas-and-lifecycle.md): pull-based context sharing between nodes.
- [Project settings](../global-and-project-settings.md): shared project intent versus machine-local
  settings.
- [Session continuity](../terminals/session-continuity.md): how target sessions survive app restarts.
