# Custom agent harnesses

**Category:** [Agents](./README.md)

A custom agent may inherit one builtin agent harness while keeping its own launch command. The
custom command can therefore use the inherited lifecycle hooks, resume grammar, permission mode,
canvas control, session identity, pane recognition, and visual identity without adding a second
copy of the builtin capability table.

## Configuration

Open Settings, then Agents, then Custom agents. Each record keeps a stable custom id, display
label, optional builtin `baseAgent`, launch command, optional argument text, environment map, and
optional color. The launch preview uses the same command assembler as a real launch. `${env:NAME}`
and `${env:NAME:fallback}` values are expanded against the host environment at launch time.

The base harness owns protocol details. For example, a custom command based on Claude uses the
Claude positional prompt and resume grammar even when an older record contains a stale prompt-mode
value. A blank custom launch command uses the selected base command.

## Persistence and recovery

Agent nodes persist `agentBaseId` next to `agentId`. On reload, the node keeps the recorded builtin
harness even if the mutable custom-agent settings record was removed. The node remains labelled as
the custom agent, while capability checks use the recorded harness. Nodes saved before this field
existed recover the value from the current custom-agent record when that record is still present.

## Security boundaries

Custom environment values are merged only at the trusted host spawn boundary, after account and
hook environment setup. Environment values never enter the launch command, project files, logs, or
the renderer preview. Missing references expand to an empty value and produce an explicit warning.
Custom `PATH` values should include `${env:PATH}` when extending the inherited path. A remote
session does not receive a local custom `PATH`.

Windows profile launches remain under the host-owned profile resolver. The resolver supplies the
registered executable and working-directory facts, rejects unsupported executable kinds, bounds
command lengths and arguments, and keeps executable paths and raw launch details out of renderer
errors. Relay requests carry view geometry only, so a peer cannot select an executable, profile,
working directory, environment, account, or launch command.

## Failure modes

- A custom agent with no base keeps only the capabilities it can prove itself.
- A removed custom record can continue an existing node only when its persisted base harness and
  launch data are still available. Unknown or malformed values fail closed.
- An unset environment reference is reported instead of becoming a silently missing value.
- An unsafe or unsupported Windows executable resolution is refused before process creation.
- A base harness never grants a custom agent another account or secret. Credentials remain owned by
  the host credential store and are not copied into settings, project files, exports, or logs.

## Verification boundary

This source lane was reconciled against `origin/main` at `54164b84dce0b7e62787b1de2885405ff4ed821c`.
No tests, lint, type checks, builds, packaging, runtime interaction, reviews, audits, or captures
were run in this lane. Those checks remain integration work.

## Suggested articles

- [Agent support](./agent-support.md)
- [Session continuity](../terminals/session-continuity.md)
- [Windows support](../../windows-support.md)
