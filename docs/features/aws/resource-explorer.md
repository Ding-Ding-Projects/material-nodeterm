# Resource Explorer manager

The Resource Explorer manager searches AWS resources and lists configured Resource Explorer views.
It uses the AWS CLI v2 `resource-explorer-2 list-views` and `resource-explorer-2 search` operations,
with the profile, region, optional endpoint, query, view ARN, and result limit visible before a
request starts.

## Behavior

Choose a configured local AWS profile and region, then select **List views** or **Search resources**.
Search queries and optional view ARNs are validated and passed as separate argument values. The
generated argument vector appears in a reviewable preview. Results are bounded to 100 rows per
request, expose a next-page token when AWS returns one, and can be filtered locally with plain text
or the adjacent anchored full regex builder. Progress is shown in the node and a running operation
can be cancelled.

## Portability and local state

The project file stores only `mode`, `regionIntent`, and `resourceQuery`. Local profile names,
endpoints, CLI paths, account sessions, request tokens, result pages, and credentials are kept in
the application data binding store or in transient operation state. Reopening on another computer
therefore returns an explicit unbound state that can be configured locally.

## Failure and recovery

If the AWS CLI is missing, not bundled, or unavailable, the node reports the exact unavailable
state and does not offer a run action. Invalid endpoints, malformed queries, oversized output,
non-JSON responses, a timeout, and a refused AWS operation remain visible errors. Retry after
repairing the local profile, region, endpoint, or bundled CLI. A cancelled operation never reports
completed results.

## Security

The service invokes the CLI without a shell and keeps credentials in the CLI's local credential
mechanism. It rejects endpoint credentials, permits HTTPS or explicit loopback HTTP only, bounds
arguments and output, and never writes credentials, account sessions, or result pages to the
portable project file, logs, exports, or public records.

## Verification

This implementation lane did not run tests, type checks, lint, builds, packaging, runtime
interaction, security or accessibility reviews, installer execution, or captures. Built-artifact
behavior and the full focused Chut remain pending in the integration lane.

## Suggested articles

- [Cloud Control](./cloud-control.md)
- [AWS Universe Shop](../integrations/aws-universe-shop.md)
- [Portable schema 3](../projects/portable-schema3.md)
