# Triggers

## Behaviour

A Trigger node stores a schedule, a payload, a target node identifier, and an optional note in the
shared project definition. It supports standard five-field cron expressions, minute intervals, and
one-shot ISO timestamps. The node begins disarmed. A scheduled run is evaluated by the privileged
host process, not by the renderer, and never catches up missed occurrences after shutdown, sleep,
or a clock change.

The target is resolved again when the occurrence fires. Ordinary terminal targets use the host's
tmux paste transport and submit the payload separately. Agent targets use the ownership, idle,
receipt, trace, and flow checks used by agent messaging. A target that is missing, unreadable,
busy, unsupported, or replaced produces a non-executed receipt. Scheduled delivery is never
retried automatically because an uncertain retry could execute a command twice.

## Configuration

The editor provides three schedule types, a native date and time control for one-shot schedules,
a five-field cron input, a bounded interval control, a same-project target picker, a multiline
payload field, an optional note, and a local timezone disclosure. Target search is plain text by
default and has an adjacent regular-expression builder. The Arm and Run now actions each open an
explicit review surface showing the exact schedule, timezone, target, and payload. Run now does not
create persistent arm consent.

## Local consent and persistence

The project file contains only the sanitized trigger definition. Arm state is stored separately in
the host's application data and binds the project id, node id, and canonical specification. Any
schedule, target, payload, or note change invalidates that binding. The host persists a bounded
receipt history without copying payload text into history. Corrupt or unreadable consent and
history files fail closed to a disarmed, empty state.

## Failure modes

Malformed definitions become inert and are never repaired by guessing. A missed one-shot occurrence
is recorded as missed and does not execute later. A concurrent occurrence is recorded as skipped
when an earlier run remains active. Removing a target or closing a project cancels future work.
The Server Edition can deliver ordinary local terminal targets. Agent delivery on that edition is
reported as unsupported because it lacks the desktop host's ownership and receipt pipeline.

## Security considerations

Payloads are bounded and reject control characters other than tab and line endings. Payloads are
never interpolated into shell commands or command-line arguments. Unknown object keys are removed
at every project boundary, including prototype-pollution keys. Shared project content never grants
execution by itself, and arm consent never travels through project export, collaboration, or sync.

## Verification

Focused tests cover schema boundaries, canonicalization, local consent, corrupt consent recovery,
cron and interval scheduling, one-shot misses, no catch-up, overlap handling, bounded history, and
project-file sanitization. The renderer editor is exercised through the normal Canvas node catalog,
and the host bridge is registered on both the desktop and Server Edition surfaces.

## Suggested articles

- [Terminals](../terminals/README.md), inspect the target session lifecycle.
- [Agents](../agents/README.md), review ownership and delivery receipts.
- [Canvas](../canvas/README.md), learn how nodes are created and persisted.
