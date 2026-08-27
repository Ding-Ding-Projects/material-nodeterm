# Usage popover default account

The usage popover lets a project choose which Claude identity new sessions should use without
leaving the usage view. It is available for local projects and for the connected SSH host that
owns the active project.

## Behavior

Each eligible Claude identity is rendered as an independently selectable radio action labelled
`Use for new sessions`. The System identity represents the absence of a project override. The
currently selected identity is marked with a check and exposed through
`aria-checked`.

Selecting an identity changes only the active project's
`defaultAccountId`. Existing terminal
nodes and running sessions keep the account identity resolved when they were created. A persisted
account id that is no longer available is treated as the System selection rather than rendered as
a ghost identity.

Local projects show the local System identity and local managed accounts. SSH projects show the
System identity and managed accounts returned for that SSH host. Rows from another host remain
read-only, and pending accounts are not offered. Non-Claude provider rows remain usage readouts.

## Keyboard and accessibility

The account choices are grouped with
`role="radiogroup"`. Arrow keys move between choices and
select the focused choice. Home and End move to the first and last choice. Escape closes the
popover and returns focus to the usage pill without reopening it. Each choice has an accessible
name that includes the identity and the fact that it applies to new sessions.

## Persistence and boundaries

The selection uses the existing project store and workspace persistence path. The desktop Canvas
may supply its existing persistence callback. The shared renderer fallback updates the project
store and marks the workspace dirty. No credentials, usage payloads, host paths, running-process
state, or session identities are written by this feature.

The feature is implemented in
`src/renderer/components/UsageIndicator.tsx` and styled in `src/renderer/styles.css`. The pure
scope and account eligibility rules remain in
`src/renderer/lib/usageScope.ts`.

## Failure modes

- No active project: no account selection is offered.
- No managed accounts: System remains the only available identity.
- Stale project default: System is selected and the stale id is not rendered.
- Another host's identity: the row remains a read-only usage record.
- Missing usage data: the identity row remains available when its account is known, while the
  usage area reports its existing empty state.
- Persistence callback unavailable: the renderer uses the project store and marks the workspace
  dirty so the normal save path can persist the choice.

## Verification

This source lane was intentionally limited to implementation and directly related records. Tests,
lint, type checks, builds, packaging, runtime interaction, reviews, accessibility checks, security
audits, and UI captures were not run. The parent integration lane must run those checks against the
exact integrated commit.

## Suggested articles

- [Managed provider services](provider-services.md)
- [Projects and tabs](../projects/projects-and-tabs.md)
- [Service nodes](service-nodes.md)
