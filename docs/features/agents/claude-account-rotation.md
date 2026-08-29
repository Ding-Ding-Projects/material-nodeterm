# Claude account rotation

**Category:** [Agents](./README.md)

Claude account rotation is an opt-in launch policy for people who keep more than one local Claude
login in nodeterm. It chooses the account for a **new** Claude session after the selected account's
most urgent usage limit reaches the configured threshold. The shipped threshold is 90%.

## Behaviour

The policy is configured at Settings → Usage → **Automatic Claude account rotation**. It is off by
default. When enabled, nodeterm reads the system Claude login and every configured local managed
account before creating a new Claude node. The account with the most headroom below the threshold is
selected. If every readable alternative is already at or above the threshold, the least-used
readable account is selected and a warning says that no lower-usage alternative existed. A failed
usage read is shown as missing evidence and is never treated as 0% usage.

The gating limit is selected deterministically: the highest consumed percentage wins, then the limit
whose `resetsAt` is soonest. This means a weekly limit can cause rotation when it is the limit
actually closest to exhausting, rather than silently assuming that the five-hour window is always
the right one.

Explicit account choices remain pinned. The policy only changes the default account resolution path,
including the project default and the plain New Claude commands. Existing nodes and live Claude
processes are never touched. In particular, rotation never kills, restarts, or reconfigures a
conversation that is already running.

After a rotation, hysteresis requires the source account to recover below `thresholdPercent -
hysteresisPercent` before it can rotate again. A cooldown also prevents a second rotation from the
same source for the configured number of minutes. While either boundary is active, subsequent
default launches continue using the remembered target when its usage evidence is still readable,
instead of churning back and forth. The small non-secret memory record is kept in
browser application storage, keyed by project, and can be discarded by clearing local application
data. It contains account ids and timestamps only, never credentials or usage tokens.

## Configuration

The persisted `Settings.claudeAccountRotation` object contains:

| Field | Default | Bounds | Meaning |
| --- | ---: | ---: | --- |
| `enabled` | `false` | boolean | Enables rotation for default new-Claude launches. |
| `thresholdPercent` | `90` | 50–100 | Usage percentage at which the source is considered high. |
| `hysteresisPercent` | `5` | 0–25 | Recovery margin before the source is eligible again. |
| `cooldownMinutes` | `30` | 1–240 | Minimum time between rotations from one source. |

The settings store persists the object with the same coalesced settings write as the rest of the
application. Settings changes are included in the existing local settings history, with the actual
field names in the change label. The rotation memory is deliberately separate from the settings
snapshot because it is runtime policy state, not a user-selected preference.

Rotation is local-only. SSH projects keep their host-scoped account choices and are not rotated by
the local usage reader, because local usage evidence cannot honestly describe a remote host. Remote
account usage remains available through the existing SSH usage surface.

## Notifications and failure modes

Rotation emits a non-blocking notification naming the source percentage, selected account, target
percentage, and the fact that running sessions were untouched. When all readable alternatives are
at or above the threshold, the warning names the least-used fallback and says that no lower-usage
account was available. If no readable alternative exists, the new session remains on the selected
account and the warning says so. A network failure, unavailable credential file, malformed usage
payload, or stale account id never becomes an invented headroom value.

Cooldown and hysteresis are quiet decisions rather than user-blocking errors. The next launch keeps
the safe source account while the policy waits for recovery or the cooldown to expire. Disabling the
policy immediately restores the historical default account selection and performs no usage reads.

## Security considerations

Rotation reads the usage snapshots already exposed by the Claude usage service. It never writes,
refreshes, exports, logs, or displays an access token. Account credentials remain owned by the
Claude CLI inside each isolated configuration directory. Only stable account ids, labels, bounded
percentages, reset timestamps, and policy state reach the renderer and local history.

No arbitrary command or account path is accepted by the policy. The candidate list is built from
the existing validated `ClaudeAccount` records, excludes pending and remote records for this local
policy, and uses the existing account-to-config-directory resolver at launch.

## Verification status

The implementation seams are:

| File | Responsibility |
| --- | --- |
| `src/renderer/lib/claudeAccountRotation.ts` | Normalization, urgent-limit selection, evidence, deterministic choice, hysteresis, cooldown, and local memory. |
| `src/renderer/canvas/Canvas.tsx` | Applies the policy before UI and canvas-control new-Claude launches, and raises factual notifications. |
| `src/shared/types.ts` | Persisted settings contract and defaults. |
| `src/renderer/components/settings/sections/UsageSection.tsx` | Guided settings controls with threshold, recovery margin, cooldown, and the existing settings search. |

This implementation lane deliberately did not run tests, type checks, lint, builds, packaging,
runtime interaction, or captures. The documentation bundle was not regenerated in this no-build
lane, so the source article is current while `src/shared/docs-data.ts` still needs the normal
bundle command in a later verification lane.

## Suggested articles

- [Agent support](./agent-support.md): managed account isolation, launch choices, and node capabilities.
- [Usage and limits](../../mobile-usage-inbox.md): provider limits, account rows, and stale or unavailable reads.
- [Local version history](../../local-history.md): how settings mutations are recorded without storing credentials.
- [SSH projects](../remote/ssh-projects.md): host-scoped account behavior and remote usage evidence.
