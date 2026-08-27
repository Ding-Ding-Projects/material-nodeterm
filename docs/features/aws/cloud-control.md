# Cloud Control manager

The Cloud Control manager exposes guided list, inspect, create, update, delete, and request-status
operations through the AWS CLI v2 `cloudcontrol` service. It keeps the operation reviewable and
does not accept an arbitrary shell command.

## Behavior

Choose a local profile and region, select an operation, and enter the requested typed values. The
resource type uses the `AWS::Service::Type` form. Create accepts an object-shaped desired-state JSON
document, update accepts an array-shaped patch document, and get, update, and delete require an
identifier. The manager previews the exact service, operation, profile, region, endpoint, risk,
pagination, retry policy, and argument vector before execution.

Read operations return bounded result rows and manual next-page tokens. Create, update, and delete
return the AWS request token for a later status check. Long-running calls show started, completed,
cancelled, or failed progress, and a running call can be cancelled. Delete is routed through the
application's existing two-key destructive-action confirmation surface.

## Portability and local state

The project file stores only the manager mode, region intent, and selected Cloud Control type name.
Profiles, account and role sessions, endpoint bindings, request tokens, result rows, CLI paths, and
credentials remain machine-local or transient. A copied project shows an unbound manager and a
guided local Configure route.

## Failure and recovery

Missing AWS CLI, missing local binding, malformed type names, invalid JSON shape, endpoint policy
violations, bounded output overflow, timeout, AWS rejection, and cancellation produce explicit
recoverable errors. A write operation never reports success from the preview alone. Use request
status with the returned token when the service reports an asynchronous operation.

## Security

The core uses `spawn` with `shell: false`, validates all user-editable fields at the point of use,
rejects credentials embedded in endpoint URLs, bounds request and output sizes, and keeps provider
credentials outside project files and public records. Destructive deletion cannot start until the
two-key confirmation flow and its full-range action complete.

## Verification

This implementation lane did not run tests, type checks, lint, builds, packaging, runtime
interaction, security or accessibility reviews, installer execution, or captures. Built-artifact
behavior and the full focused verification remain pending in the integration lane.

## Suggested articles

- [Resource Explorer](./resource-explorer.md)
- [AWS Universe Shop](../integrations/aws-universe-shop.md)
- [Portable schema 3](../projects/portable-schema3.md)
