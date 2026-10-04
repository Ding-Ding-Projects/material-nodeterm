# Usage indicator reliability and identity

The bottom-left usage pill and its popover describe the machine the active project runs on. This
article covers how they behave when a read fails, how they name the identity behind each number,
and how an SSH host's Codex limits join the host's Claude limits. Account selection for new
sessions is described separately in [Usage popover account defaults](./usage-popover-account-default.md).

## Behavior

- **Last good numbers survive a failed read.** When a Claude usage read fails after an earlier read
  of the same identity succeeded, the service keeps the earlier limits and marks the snapshot as
  an error (`holdLastGood` in `src/core/usage/claude-usage-map.ts`). The popover prints a quiet note
  under the kept bars: "Latest read failed — showing numbers from 3m ago." The pill keeps showing
  the numbers instead of flickering to a warning. The same rule applies to an SSH host's Claude
  rows, folded into the shared request so a coalesced reader sees the kept numbers too.
- **A rate limit is named.** An HTTP 429 from the usage endpoint is reported as "Rate limited by
  the usage endpoint (HTTP 429) — try again in a few minutes." instead of the generic "Could not
  read usage." That endpoint's budget is shared with every Claude CLI using the same login, so a
  busy host can exhaust it without nodeterm.
- **The active organization is shown per account.** Each Claude account row shows
  "Organization: <name>" read from that account's own identity file. Type, rate-limit tier and
  organization id are in the tooltip. A personal organization whose name only repeats the email is
  shown in a quieter colour.
- **Each provider is one block.** In the single-account view the Claude meters, its account row
  and "⇄ Switch Claude Code account…" sit together in one block, ahead of any other provider. With
  managed accounts listed, the switch action belongs to the System row. The popover body scrolls,
  so every account stays reachable however many are configured.
- **Grok billing failures carry a safe reason.** A failed Grok billing view reports a category
  (authentication, rate limit, server error, timeout, network, unreadable response) per view. Two
  views that failed for the same reason print one line naming both views.
- **SSH hosts report Codex too.** On an SSH project the popover lists the host's Codex system
  identity and every managed Codex account pinned to that host, each with a host badge. The pill
  names a Codex row by its account identity, and a host's system row by that host's own Codex
  login (falling back to the host key), never by this machine's login.
- **The pill names a managed default account.** When the active project's "Use for new sessions"
  account is a managed account with data, the pill shows that account's limits and its label. The
  system identity stays unlabelled. A local managed default is re-read every five minutes while
  the popover is closed.
- **⟳ re-reads everything on screen.** On a local project the refresh button re-reads the system
  account, the managed default and the other providers past their debounce, each settled
  separately. On an SSH project it forces the host read, and a reply that arrives after a project
  switch or reconnect is dropped.

## Configuration

Settings → Usage keeps one switch per provider. Hiding Claude hides the local Claude rows, hiding
"Claude on SSH hosts" hides a host's Claude rows, and hiding Codex hides both the local Codex rows
and a host's Codex rows. The percentage mode (used or remaining) applies to every row. No new
setting was added.

## Failure modes

- A failed read with no earlier numbers shows the failure line, never a 0% bar.
- Kept numbers are dropped, not shown, when a different account answered, when the earlier read is
  older than one hour, or when one of its windows has reset since.
- An SSH host read that cannot run is an error, never "unavailable", so the row stays visible.
- A remote Codex read requires `node` and `curl` on the host. Without them the row reports an
  error; no other credential location is tried.
- On Windows the app-server fallback for local Codex usage resolves `codex` through PATHEXT and runs
  an npm `.cmd` install through the escaped cmd.exe path
  ([Windows CLI resolution and npm shim execution](../windows/cli-shim-execution.md)); a shape that
  path refuses declines the tier and the backend tier answers alone.

## Security considerations

- Remote Codex usage reads the host's `auth.json` and performs the HTTPS request on the host. The
  access token is passed to `curl --config -` on standard input, never in a command argument, and
  only sanitized quota windows return to the desktop. Response bodies, identity strings and
  unexpected fields are discarded on the host.
- Remote reads are refused when the connection or the host's home directory changed after the
  target was listed, so a replaced connection cannot answer for an earlier one.
- Grok diagnostics carry only a view name, a reason category and an HTTP status. Exception messages
  can contain proxy URLs or credentials and are never forwarded.
- Organization metadata is attributed to a token only when the identity file's email matches the
  token's email, or one of them is unknown.
- Provider names, HTTP statuses, host keys, organization names and ages are facts: they are
  interpolated after localization and are never rewritten by the local vocabulary.

## Surfaces

- **Desktop:** full, including SSH hosts over the project's ControlMaster.
- **Server Edition:** the same renderer and core service. The server has no SSH projects, so the
  remote rows are always empty there; a host's system Codex email lookup answers `E_UNSUPPORTED`
  and the row falls back to the host key.
- **Mobile companion:** not applicable. It does not render the usage popover.

## Accessibility and localization

The switch action is a Material 3 outlined button and the refresh action an icon button with an
accessible name. Every new sentence is in the localization catalogue (English, Hong Kong
Cantonese, bilingual) under `usage.*`. The popover keeps its existing keyboard path: the pill
opens it on focus, Escape closes it and returns focus to the pill.

## Verification

- `src/core/usage/usage-service.hold.test.ts`, `usage-service.identity.test.ts`,
  `usage-service.remote.test.ts`, `remote-codex-usage.test.ts`, `grok-diagnostics.test.ts` and
  `claude-usage-map.test.ts` cover the service rules.
- `src/renderer/components/UsageIndicator*.test.tsx` cover failure readouts, grouping,
  organization, Grok diagnostics, the provider refresh and remote Codex rows, including the host
  system identity.
- `src/renderer/styles.usage-popover.test.ts` guards the bounded, scrolling popover.
- `src/shared/i18n/catalog.usage.test.ts` pins every new catalogue id, its English text, matching
  Cantonese fact slots and its consumer.
- Built-artifact interaction and captures have not been run for this change.

## Suggested articles

- [Usage popover account defaults](./usage-popover-account-default.md)
- [Usage-threshold account rotation](./usage-account-rotation.md)
- [Remote and SSH](../remote/README.md)
