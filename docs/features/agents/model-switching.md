# Per-node model switching

**Category:** [Agents](./README.md)

Agent nodes can select a model independently through the configured model gateway. The selection
belongs to the node, not to the whole application or project, so two nodes using the same agent can
run different gateway models at the same time.

## Configuration

Open **Settings → Model gateway** and provide the gateway root and its credential source. The host
derives the OpenAI-compatible discovery route at `<root>/v1/models`, plus the provider routes used
when a node starts or resumes. Credentials are resolved in the host process and are never placed in
the renderer's launch command or typed into the terminal pane.

The gateway model list is normalized before it reaches a menu. Empty, control-bearing, oversized,
duplicate, and malformed entries are ignored. A failed or incomplete discovery response does not
invent a model. The menu remains unavailable until a usable list is available, with the recovery
route shown in the menu hint.

Only harnesses that declare model-switch capability receive the model picker. The capability is
resolved through the effective base harness, so a custom agent inheriting a supported base receives
the same model behavior without a second frontend allowlist. The current supported bases are
Claude, Codex, and Copilot.

## Choosing a model for a future node

Model selection is an explicit user choice. The **Transfer conversation to** menu lists the gateway
models for a supported destination when discovery has completed. Choosing a model passes it into
the new node's launch plan and persists it as `data.agentModel`. Choosing the default entry leaves
the destination on its normal CLI model selection.

The persisted value is reused for a cold restore and for later resumes. A node that has never been
given a model does not acquire one merely because a gateway is configured. Copilot likewise keeps
its ordinary routing until the user deliberately selects a gateway model.

## Switching a running node

For one selected node, open its context menu and choose **Switch model**. The menu marks the active
model and disables that same entry. The runtime repeats this check when the action runs, because a
menu callback can outlive a node update.

The running-node sequence is:

1. Confirm that the node still has a resumable provider session and that its effective harness can
   use model switching.
2. Resolve and validate the selected model again at the point of use.
3. Ask the host to terminate only the foreground process group owned by the expected harness. A
   stale menu cannot terminate a shell, editor, build, or unrelated foreground process.
4. Recycle the persistent terminal session so the replacement shell receives the current gateway
   environment.
5. Persist the selected model on the node and cold-resume the same provider conversation.

The model key is never prefixed onto the resume line. Claude and Codex receive the validated model
flag through their launch grammar. Copilot receives its protocol-specific environment mapping,
including the provider-prefixed wire model when required.

Relay sessions do not expose the local model picker. Their terminal and gateway belong to another
host, so applying this machine's gateway would be misleading and unsafe.

## Failure recovery

Invalid gateway settings or a missing credential cause discovery to fail closed. The context menu
keeps the switch action disabled and names the next configuration or recovery step. A missing model
list never becomes an empty success state that hides the reason.

If the running node is busy, has no resumable session id, is not attached, or is no longer owned by
the expected harness, the action is refused before the foreground process is signalled. If session
recycling is refused or its host acknowledgement fails, node data is left unchanged and the caller
receives the existing restart failure notice so the node can be inspected and retried.

A request for the model already active on the node is also refused before termination or recycling.
This protects a healthy conversation from callbacks held by an older context menu.

## Persistence and ownership

`agentModel` is part of terminal node data and the project projection. It is a model selection, not a
credential, process id, host id, account session, or gateway secret. The gateway URL and credential
reference remain application settings, while the selected model remains per-node state. Account
selection and project ownership are not changed by a model switch.

The node's existing provider session id is preserved during a running-node switch. The switch
changes the launch model while keeping the conversation identity, and the cold-resume path uses the
node's current permission mode, effective agent configuration, and owning project settings.

## Verification boundary

The source implementation is present in:

- `src/shared/agents/config.ts`, for capability membership.
- `src/shared/agents/model-gateway.ts`, for discovery parsing, route derivation, environment
  mapping, and launch-model validation.
- `src/shared/agents/launch.ts`, for applying the model to fresh and resume commands.
- `src/shared/types.ts` and `src/renderer/state/workspace.ts`, for node and project persistence.
- `src/renderer/canvas/Canvas.tsx`, for the user-facing model picker and action dispatch.
- `src/renderer/nodes/TerminalNode.tsx`, for identity-gated termination, recycling, and resume.
- `src/core/pty-manager.ts`, for host-side gateway environment and foreground ownership checks.

The implementation lane recorded source and documentation state only. Tests, type checks, lint,
builds, packaging, runtime interaction, reviews, security checks, accessibility checks, and UI
captures remain pending for the integration lane.

## Suggested articles

- [Agent support](./agent-support.md), for shared capabilities, status, and launch behavior.
- [Copilot CLI](../../copilot-agent.md), for Copilot's provider routing and model mapping.
- [Session continuity](../terminals/session-continuity.md), for persistent sessions and cold resume.
- [Projects and tabs](../projects/projects-and-tabs.md), for node persistence and project ownership.
