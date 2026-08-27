# Read-only Windows diagnostics

The **Windows diagnostics** node provides a bounded, read-only snapshot of the computer hosting the
desktop application. It is a diagnostic view, not an administration console: there are no controls
to start, stop, enable, disable, edit, delete, install, or restart a host resource.

## What it shows

The node presents one tab for each independently readable area:

| Tab | Facts |
| --- | --- |
| Drives and storage | Local fixed volumes, labels, file systems, total bytes, and free bytes. |
| Services | Service name, display name, state, start mode, and service account label. |
| Startup entries | Startup name, command text reported by Windows, source location, and user. |
| Scheduled tasks | Task name, task path, state, and author when reported. |
| Updates | Operating-system caption/version/build and the most recent 200 hotfix rows. |
| Network state | Adapter status/link speed/MAC plus IP configuration, gateways, and DNS addresses. |
| Event summaries | Counts grouped by System or Application log, level, provider, and event id over the most recent seven days, capped at 200 groups. |

The host returns rows as facts. Empty values are shown as **Not reported**, not invented. A query
failure is kept separate from an empty result so that an unavailable area never looks healthy by
accident.

## Safe host boundary

The trusted core invokes `powershell.exe` with `-NoLogo`, `-NoProfile`, and `-NonInteractive` and one
fixed script containing only read operations. No renderer input is interpolated into that script,
and the renderer cannot select an executable, add an argument, or submit a command. Each area is
isolated, so a missing cmdlet or denied provider reports an unavailable/error state while other
areas remain useful. The whole response is bounded to four MiB, each query has a fifteen-second
deadline, and every section keeps at most 1,000 rows in memory.

On a non-Windows host, all sections report the explicit unavailable state that Windows diagnostics
is not available there. This is not a simulated snapshot and does not fall back to a different
platform command.

## Interaction

Tabs use the application's Material Design 3 node chrome and remain keyboard operable. The active
tab has a local plain-text-first filter. Its adjacent `.*` control opens the anchored full regex
builder, preserving the query, pattern, flags, validation, and mode for that tab. Invalid patterns
leave the rows visible and show the exact validation message. A no-match result is stated plainly.
The refresh control performs one new read-only snapshot and keeps the prior snapshot out of the
shared project data.

## Persistence and portability

Only the node's normal display title, position, size, colour, and group membership are project
content. The snapshot, timestamps, host identifiers, paths, process state, event details, caches,
and query output are runtime data and never enter the portable project projection. Reopening a
project on another computer shows a fresh snapshot or the explicit unavailable state for that
computer.

## Failure and privacy behavior

The node distinguishes these states:

- **Reading this host** — the first query has not returned.
- **Available** — the section returned a bounded list, including an honest empty list.
- **Unavailable** — the host is not Windows, the fixed query could not run, or a required provider is missing.
- **Error** — the response was malformed or a section could not be interpreted safely.

Raw event messages are not collected. Event summaries keep only bounded grouping facts. No
credentials, command arguments, process handles, or mutation APIs cross the bridge. Network state is
read from the host only; diagnostics never changes adapter state, routes, DNS, firewall settings,
services, tasks, startup entries, updates, or event logs.

## Verification boundary

This lane was delivered under the issue's ultra-speed boundary. No tests, type checks, lint, reviews,
security checks, accessibility checks, installer execution, runtime interaction, or UI captures
were run. The implementation and documentation are therefore evidence of the intended read-only
route, not a claim that the built artifact has been exercised.

## Suggested articles

- [Windows user guide](../../windows.md) — supported Windows installation and shell behavior.
- [Windows shell profiles](../terminals/windows-shell-profiles.md) — local shell profile detection.
- [Node kinds](../canvas/node-kinds.md) — shared canvas node behavior and persistence.
