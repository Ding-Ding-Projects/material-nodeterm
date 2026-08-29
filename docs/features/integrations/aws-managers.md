# AWS service managers

The AWS Universe exposes seven typed managers: S3, EC2, IAM, STS, Lambda, CloudWatch, and Logs.
They are backed by `src/core/aws/schema-executor.ts` and the shared operation catalog in
`src/shared/aws-managers.ts`. The catalog is the source for the guided form, the operation label,
the required IAM permissions, the paginator, the waiter, streaming bounds, and whether an action is
destructive.

## Guided operation flow

The manager surface lists every operation by service and supports plain-text search with an adjacent
anchored regex builder. An operation opens a typed form, not a shell or a raw request editor:

- enums are searchable pickers, booleans are switches, bounded numbers are steppers, date-times
  use date and time controls, and local files use a native file picker;
- unknown fields, malformed JSON, invalid regions, unsafe map keys, oversized values, and missing
  required values are rejected before the transport sees them;
- the form shows the operation description, the exact IAM permissions, the selected account and
  region context, and the disabled reason plus next action when a permission is missing;
- the operation's request id is stable for its run, so progress and cancellation can be associated
  with one visible row and a retried call cannot masquerade as a second action.

The trusted transport accepts typed service, operation, input, target, and cancellation data. It
does not accept shell source, an executable path, a profile file path, or credentials. Resolving the
bundled AWS CLI and the operating-system credential vault belongs in that transport boundary.

## Service coverage

| Manager | Operations | Long-operation support |
| --- | --- | --- |
| S3 | buckets, object listing, download, upload, single and bulk delete | continuation pagination, transfer streams, progress, cancellation, destructive preview |
| EC2 | instance description, start, stop, terminate, reboot | pagination, running/stopped waiters, progress, cancellation, destructive preview |
| IAM | users, roles, policy inspection, create and delete user | marker pagination, permission reporting, destructive preview |
| STS | caller identity and assume role | typed duration, local-only credential handoff, no portable credentials |
| Lambda | functions, invoke, update code, delete function | marker pagination, bounded payload stream, update waiter, destructive preview |
| CloudWatch | metrics, metric data, alarms, bulk alarm delete | continuation pagination, bounded date range, destructive preview |
| Logs | groups, filtered events, tail, delete group | continuation pagination, bounded event stream, cancellation, destructive preview |

All retries are bounded exponential retries for transient throttling, timeout, connection-reset, and
service-availability errors. A retry never retries validation or permission failures. A cancellation
returns the completed pages or records as a partial result and emits a cancelled progress event.
Bulk operations are sequential and resumable at item boundaries, with per-item completed, failed,
cancelled, and skipped outcomes.

## Destructive operations

S3 object deletes, EC2 stop and terminate, IAM user deletion, Lambda function deletion, CloudWatch
alarm deletion, and Logs group deletion require `previewDestructive()`. The preview records the exact
affected resource labels, required permissions, operation id, and a single-use expiring nonce. The
executor rejects a missing, expired, reused, or mismatched nonce. The UI supplies the existing two-key
confirmation surface before passing the nonce to the operation.

## Portability and privacy

`toPortableIntent()` keeps only schema-declared safe intent such as service, operation id, region,
resource labels, and non-secret settings. It omits profile bindings, role sessions, endpoint
identity, local file handles and names, credentials, session tokens, caches, process state, and host
paths. Importing a portable project therefore performs no AWS request or other external mutation.
The destination computer shows Configure or Rebind when a local AWS binding is absent.

## Verification boundary

The implementation contract is represented by the typed catalog and executor. This lane intentionally
did not run tests, type checks, lint, security checks, builds, packaging, installer execution,
runtime interaction, or captures. Those Chuts and built-artifact evidence remain required by the
release workflow before this feature can be described as runtime-verified.

Suggested articles: [service nodes](service-nodes.md), [portable project archives](../projects/project-history-and-archives.md), [bulk actions](../../bulk-actions.md), and [destructive confirmation](../../destructive-confirmation.md).
