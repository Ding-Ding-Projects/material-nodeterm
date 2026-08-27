# AWS resource managers

The AWS resource-manager node provides guided controls for Elastic Container Registry (ECR),
Elastic Container Service (ECS), Elastic Kubernetes Service (EKS), Relational Database Service
(RDS), the DynamoDB/ElastiCache/DocumentDB/Neptune database families, Virtual Private Cloud (VPC),
Route 53, and cost and usage operations.

## Behaviour

The node keeps one safe manager and operation intent in the portable project projection. The
manager catalog supplies typed fields, bounded numeric values, allowlisted choices, progress stages,
and a recovery action for every operation. Resource lists are queried through the trusted core
adapter and can be filtered with plain text by default or with the adjacent anchored regex builder.
Selecting resources and running an operation uses the typed request shape; there is no raw command,
arbitrary shell, or raw request editor.

Long operations expose queued, running, completed, failed, and cancelled progress, plus bounded
partial success lists and retry or cancellation actions where the adapter supports them. Destructive
operations remain subject to the application's two-key confirmation flow.

## Portable and local state

The project file carries only the manager id, operation id, selected safe field values, and an
optional region preference. AWS profiles, account and role sessions, credentials, endpoints,
pagination cursors, live resource identifiers, job state, and provider caches remain machine-local.
Importing a project therefore does not contact AWS or mutate a resource. On another computer the
node starts with its safe intent and reports the adapter's Configure or unavailable route until a
local AWS adapter is present.

## Failure modes and recovery

If the adapter is missing, the node stays visible and names the exact next action: install or enable
the local AWS adapter, then refresh. A failed health check is distinct from an empty resource list.
Invalid manager ids, operation ids, fields, numeric bounds, resource selections, searches, cursors,
and job ids are refused before an adapter call. An adapter error remains a visible error and never
becomes an invented empty result. Retry is limited to an adapter-reported job and does not delete a
resource that already succeeded.

## Security considerations

The renderer receives summaries and progress only. Credentials and account sessions stay in the
core adapter and are never placed in project JSON, logs, exports, history, screenshots, or request
arguments. The core validates all renderer input again, bounds list and progress payloads, and
routes job actions through the manager that created the job.

## Surfaces and verification boundary

The Desktop and Server Edition use the same core registration and typed bridge. The browser surface
uses the same guided panel and reports an unavailable adapter when no local adapter is configured.
The mobile companion has no direct implementation in this checkout and must use its host protocol
before it can expose these managers.

This issue is an ultra-speed implementation lane. Tests, lint, type checks, reviews, security and
accessibility checks, builds, packaging, installer execution, runtime interaction, and UI captures
were intentionally not run. Build production and runtime evidence must be recorded by the owning
integration lane rather than inferred from this source change.

## Suggested articles

- [Shared provider services](provider-services.md)
- [Portable project bindings](../projects/portable-bindings.md)
- [AWS Universe Shop](aws-universe-shop.md)
- [Service nodes](service-nodes.md)
