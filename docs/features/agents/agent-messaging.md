# Agent messaging

Agent messaging lets one authenticated agent node send a bounded message to another agent node in
the same project. The feature has four related control verbs:

| Verb | Purpose | Message body |
| --- | --- | --- |
| `send` | Start a new conversation | Caller supplied text |
| `reply` | Continue an existing conversation | Caller supplied text, linked by `replyTo` |
| `status` | Read a message receipt | No body; returns the current delivery state |
| `notify` | Ask a linked agent to read shared context | Fixed app-owned prompt |

The renderer validates the command shape and forwards only the source id, target id, verb, and
body. The core delivery service resolves project membership, node identity, live pane ownership,
turn state, and queue capacity again. Titles are display metadata only. They are never accepted as
addresses, and a duplicate or unsafe node id is refused rather than guessed.

## Delivery and failure states

An idle, verified target receives one framed payload and one submit action. The receiver's next
verified turn is used as the receipt. A target that is working or waiting can be queued in the
bounded per-target queue. Queued messages expire after 15 minutes and remain visible as `expired`,
so a dropped message is never mistaken for delivery. The queue has a depth of 20 per target and a
500-entry process ring. Rate limits and per-turn fan-out limits are checked before pane probing.

Every delivery and refusal records a trace containing ids, outcome, timestamp, body length, and the
trace destination. Message content is not written to traces. A trace uses the project board log
when that log is available, otherwise it stays in the bounded memory ring.

The result is one of `delivered`, `queued`, `expired`, `rateLimited`, `queueFull`, `targetBusy`,
`targetGone`, or `notPermitted`. The reply states whether retrying is useful. A stalled or replaced
target is never reported as a successful delivery. Locally created `send` and `reply` records also
retain a `failed` status when the core refuses a delivery after the record is created.

## Authentication and context links

Control requests carry the per-node identity issued by the host. The hook server reads the request
body under a 2 second receive-phase slow-client limit, then raises the socket ceiling to 130
seconds for the handler. This preserves the 120 second confirmation ceiling without restoring an
unbounded request. Context-link reads use the same identity route and their own 30 second read
bound.

Context links remain pull-based. They use the persisted node ids and the host's verified transcript
authority, not a title lookup. A context-link refusal is returned as explanatory text because the
shell client cannot safely distinguish a text refusal from an unreachable endpoint using only a
status code.

## Seamless write setting

Settings → Agents contains **Seamless agent messaging**, off by default. When enabled, the
confirmation dialog is skipped for the `write` control verb and the same per-node restart lock is
still held while the write runs. This is a broad trust decision, so the setting explains that any
control-capable agent can type into any node terminal while it is enabled. The `close` verb always
keeps its destructive-action confirmation. `send`, `reply`, and `status` continue to use the
authenticated core delivery path.

## Accessibility and appearance

The Settings row is searchable and uses the shared Material Design 3 switch, visible focus, a
screen-reader name, and a clear off-state explanation. Delivery results are non-blocking status
messages, while destructive node closure remains a blocking confirmation. English, Cantonese, and
bilingual language modes retain the same ids, timestamps, outcome names, and retry facts. The
English and Cantonese funny-level controls may style the surrounding copy but never change a
delivery fact.

The Server Edition exposes the same typed API namespace and returns a named, non-retryable refusal
because it has no desktop confirmation owner for this pane-delivery path. The browser surface does
not present a control that appears to deliver successfully when the host cannot perform it.

## Verification record

The implementation is split across the shared wire types, the platform-free core delivery modules,
the desktop service, the renderer bridge, and the hook server. The current ultra-speed lane does
not run tests, type checks, lint, security checks, accessibility checks, installer execution, runtime
interaction checks, or UI captures. Build and package evidence, when produced by the release lane,
proves artifact production only.
The generated offline documentation bundle still needs its normal regeneration in a later build
lane; this no-build implementation lane does not claim that generated artifact is refreshed.

Suggested articles: [Agent support](./agent-support.md), [Node identity](../../node-identity.md),
[Hook-reply approvals](../../hook-reply-approvals.md), and [Context links](../../ssh-agent-skills.md).
