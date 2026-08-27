# Usage-threshold account rotation

**Category:** [Agents](./README.md)

## Behaviour

When enabled, a new Claude node that would use the active project's default account checks the
latest successful per-account usage snapshots. If the selected account's primary limit reaches the
configured threshold, the node uses the configured account with the most headroom. If every account
with a readable snapshot is at or above the threshold, the least-used account is selected so the
launch remains available.

The policy applies only to new default launches. An explicit account selection is treated as a pin,
and running sessions are never changed. SSH-host accounts are not candidates for the local rotation
policy. A missing, stale, unavailable, or errored usage row leaves the selected account unchanged.

## Configuration

Open Settings, then Usage, and enable **Rotate Claude accounts**. The threshold slider defaults to
90 percent and can be adjusted from 50 to 100 percent. The setting is stored in the normal local
settings record and does not change project files or account credentials.

## Failure modes

Rotation is best effort. Usage that cannot be read does not block node creation and does not invent a
replacement account. If no alternative account has a usable snapshot, the selected account remains
in effect. A stale project default is still rejected by the existing account eligibility check.

## Security considerations

The feature reads the usage snapshots already held by the local usage service. It never reads,
writes, exports, or forwards account credentials. The choice only changes which isolated Claude
configuration directory a newly created default node receives.

## Verification boundary

This ultra-speed implementation lane did not run tests, type checks, lint, reviews, security checks,
accessibility checks, builds, packaging, installer execution, runtime interaction, or UI captures.
The implementation should be exercised in a later verification lane against the built desktop and
Server Edition surfaces.

## Suggested articles

- [Agent support](./agent-support.md) - managed account isolation and launch behaviour.
- [Global and project settings](../global-and-project-settings.md) - persisted settings and scopes.
- [Session continuity](../terminals/session-continuity.md) - what happens when an existing node is
  reopened.
