# Linked-agent inbox notifications

**Category:** [Agents](./README.md)

Linked-agent inbox notifications give an agent node a bounded way to tell another linked agent that
shared coordination context changed. The sender can request a notification with
`notify --node <id>`. The command accepts no message text. The application supplies the complete
prompt, so a caller cannot inject instructions through the command arguments.

## Behaviour

The current implementation keeps the upstream [PR #98](https://github.com/eneskirca/nodeterm/pull/98)
intent while using this fork's stronger messaging path. A notification:

1. names one target node;
2. requires the target to be an agent node that supports context links;
3. requires a persisted link between the source and target in the same project;
4. requires the project messaging capability and this machine's recorded consent;
5. rechecks the target's runtime pane ownership and verified agent status; and
6. delivers the app-authored context-refresh prompt through the same receipt, trace, flow-budget,
   and deliver-on-idle path used by ordinary agent messages.

The prompt tells the target that a linked agent updated shared coordination context and to read the
latest linked context with `get-linked-context` before continuing. A notification is a nudge, not a
conversation payload: ordinary text belongs to `send` or `reply`, which retain their own validation
and delivery rules.

If the target is busy, a permitted notification can wait in the bounded per-target queue and flush
when the target reaches a verified idle state. The queue preserves FIFO order, has a capacity of 16,
and expires entries after five minutes. Expiry and flush outcomes are reported to the sender and to
the delivery trace; a dropped entry is never silent.

## Configuration and persistence

Enable the capability for the active project in **Settings -> Agents**. The `agentMessaging` switch
is stored in the git-shared `.nodeterm/project.json` projection. The first-use answer is stored
machine-locally in the project index as `capabilityAck`, so cloning a project cannot silently grant
messaging on another machine. The capability is off by default, and turning it off takes effect on
the next delivery attempt, including a queued flush.

Canvas links and safe node relationships remain project data. Credentials, hook secrets, machine
paths, process state, pane ownership records, caches, and queued runtime payloads do not enter the
portable project projection. Importing a portable project is side-effect free. A reopened project
must establish fresh runtime sessions, verified ownership, and local consent before a notification
can be delivered.

## Failure modes and recovery

- **Capability disabled or not yet acknowledged:** the request returns a named refusal. Enable
  messaging for the active project and answer its local consent notice.
- **Target is not a linked agent:** the request is refused before any pane write. Link the two agent
  nodes in the same project, then retry from the source node.
- **Target is busy or between sessions:** the request is queued only after the scope and ownership
  checks pass. The result says `queued`, and a later verified idle event either delivers it or reports
  the exact terminal outcome.
- **Queue full or entry expired:** no existing message is discarded to make room. The sender gets a
  `queueFull` or `expired` result and can decide what to do next.
- **Project consent revoked, ownership changed, or the target disappears:** the flush re-runs every
  authorization check and reports the refusal. It does not deliver to a replacement pane.
- **Server Edition:** this desktop control route is not available there. The browser surface returns
  the explicit unsupported-edition response rather than pretending that a notification was sent.

## Security considerations

The application owns the notification body and substitutes it in the main process, even if a
hostile renderer request carries a body field. The sender's identity is checked through the verified
node route, the target must be in the same project, and runtime pane ownership is proven before the
write. Per-sender and per-target flow budgets prevent notification floods. The delivery trace keeps
metadata such as source, target, outcome, and body length, but never stores the message body or
credentials.

Notifications use the existing framed delivery transport and never place the body in a shell
argument. The project capability is a git-shared intent bit, not a grant by itself. A machine-local
consent answer and a fresh runtime ownership record are required before a delivery is allowed.

## Upstream provenance

- [PR #98](https://github.com/eneskirca/nodeterm/pull/98) proposed the fixed `notify --node <id>`
  command and the app-owned prompt.
- [`43f58420`](https://github.com/eneskirca/nodeterm/commit/43f58420297965b986334206780e01ad7b393636)
  recorded the upstream design.
- [`8d3b00b3`](https://github.com/eneskirca/nodeterm/commit/8d3b00b36a39a3bdeaa274da8236e4f5eba6ff29)
  added the upstream prototype.
- This fork's successor path is recorded in `src/shared/agents/agent-messaging.ts`,
  `src/main/agent-messaging.ts`, `src/core/agents/delivery-queue.ts`, and the project capability
  registry. The later implementation deliberately supersedes the prototype's direct renderer
  `sendText` call with authenticated main-process delivery and revalidation.

## Verification status

This issue lane is the explicitly bounded ultra-speed source lane. It did not run tests, type
checks, lint, reviews, security or accessibility checks, builds, packaging, installer execution,
runtime interaction, or UI captures. The source locations and upstream commit links above are the
traceable implementation record. Packaged-artifact behavior and real runtime delivery remain
unverified until the integration lane runs its own checks.

## Suggested articles

- [Agent support](./agent-support.md) - status hooks, capabilities, and agent nodes.
- [Portable project schema 3](../projects/portable-schema3.md) - safe project intent and omitted
  machine-local state.
- [Projects and tabs](../projects/projects-and-tabs.md) - project-scoped canvases and links.
- [Session continuity](../terminals/session-continuity.md) - how agent sessions resume.
