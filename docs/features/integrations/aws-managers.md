# AWS service managers

The AWS service manager node provides guided, typed workflows for Elastic Container Registry
(ECR), Elastic Container Service (ECS), Elastic Kubernetes Service (EKS), Relational Database
Service (RDS), database inventory, Virtual Private Cloud (VPC), Route 53, and Cost Explorer.
The node is created from the Managers menu and stays a normal canvas object: it can be renamed,
moved, resized, grouped, collapsed, and persisted with the project.

## Scope and portable state

The project file contains only safe intent: the selected service, operation id, region intent,
reviewed form defaults, and the node's label and layout. AWS profiles, SSO caches, role sessions,
MFA values, credential files, account bindings, CLI paths, host paths, process ids, response caches,
and generated runtime data remain on the local computer. Import never contacts AWS, runs an
operation, or changes provider state. On another computer the node offers a local Configure or
Rebind route and otherwise remains visibly unbound.

## Guided operations

The operation catalog is typed and explicit. It includes paginated inventory for repositories,
clusters, database instances, VPC resources, and hosted zones; typed EKS inspection; reviewed DNS
record batches; and bounded cost and usage date ranges. Forms use real controls for enums, booleans,
numbers, dates, and resource selections. A service or operation that is not available is shown
with the reason and a next action rather than an empty picker or arbitrary request editor.

Every new search field has plain-text matching as its default and an adjacent anchored Regex
Builder. The builder is bound to this inventory only, so its pattern and flags cannot leak into a
different list or picker.

## Execution, pagination, and waiters

The trusted core builds the AWS CLI v2 argument vector from the operation registry and validated
form values. It invokes the executable with `shell: false`, never accepts a shell command, and
never sends credentials to the renderer or puts them in arguments. The local AWS credential chain
and profile store remain the credential source.

Custom endpoints are accepted only for official `amazonaws.com` HTTPS hosts or bounded loopback
development endpoints. Embedded credentials are refused, which prevents a form value from turning
the manager into an arbitrary network request.

Inventory responses expose page number, continuation token, completeness, fetch time, and a
permission state. Access denied and partial responses are retained as explicit states with a
diagnostic rather than being converted into an empty successful list. Mutating operations expose
their pagination and waiter policy in the preview, and waiter progress is streamed as non-blocking
status events. A bounded page count, output size, and operation timeout keep a provider response
from consuming unbounded memory.

## Preview, bulk actions, and recovery

Before a write or destructive operation, the preview names the service, operation, region, profile
selection, generated arguments, pagination, waiter, output mode, warnings, and risk. The preview
does not include credential values. Delete operations use the app's existing two-key destructive
confirmation gate. Bulk selection is local to the visible inventory, deduplicated, and previewed
with the exact affected count. Completed and failed items remain separate so one permission error
cannot turn a partial result into a green batch.

Cancellation, retry, and recovery status are reported where the operation started. Informational,
progress, and permission notifications are non-blocking and remain reviewable in the app's
notification history.

## Permissions and unavailable states

The manager distinguishes an unavailable AWS CLI, missing profile, missing region, denied action,
partial permission response, malformed provider output, and a successful empty inventory. The
distinction matters: an empty list is data, while a denied list is a recovery instruction. The
status surface reports the detected AWS CLI version, selected profile and region when known, and
the exact diagnostic when the capability cannot be reached.

## Surfaces

- **Desktop:** uses the local AWS CLI v2 and credential chain through the trusted core executor.
- **Server Edition:** registers the same core manager and typed channels, so the server host's AWS
  environment is the one being described. No browser credentials are accepted.
- **Relay:** intentionally unavailable until a scoped host-routed AWS session exists. A relay view
  refuses the manager instead of silently running the viewer's local profile against the host's
  canvas.
- **Mobile companion:** the companion receives a follow-up contract for a read-only summary; it
  must not receive credentials, local profile data, or provider process state.

## Verification boundary

This ultra-speed lane did not run tests, type checks, lint, security checks, accessibility checks,
installer execution, runtime interaction checks, or UI captures. Build and packaging evidence,
when produced by the parent release lane, proves artifact production only. Full AWS API fixtures,
permission matrices, waiter timing, packaged interaction, and real captures remain required
follow-up evidence.

Suggested articles: [service nodes](service-nodes.md), [bulk actions](../../bulk-actions.md),
[destructive confirmation](../../destructive-confirmation.md), [scheduled settings](../../scheduled-settings.md).
