# Generic AWS all-service interface

The AWS Universe Shop exposes an all-service operation route generated from the model files shipped
by the installed AWS CLI. It does not contain a hand-maintained list of service forms. When a newer
CLI adds a service, command, or input shape, refreshing the inventory exposes it through the same
typed controls.

## Behavior

The Shop presents independently searchable service and command pickers. Each picker keeps plain
text search as its default and has an adjacent anchored regex builder. The command model produces
the appropriate control for each input shape: enums use searchable choices, booleans use switches,
numbers use bounded numeric fields, timestamps use date and time fields, files use a native browse
route, and structures, lists, and maps are editable repeatable groups. Unsupported or malformed
model shapes are refused instead of becoming a raw request editor.

The shared AWS resource manager receives the selected operation and validated wizard value. Its
execution preview shows the selected service, command, profile, account, role, region, endpoint,
pagination, retry, output mode, generated argument vector, risk, and portable omissions. Read
operations execute directly. Destructive operations use the application's existing two-key
confirmation flow. Long operations report running, complete, cancelled, partial, and error states
in the Shop and support cancellation.

## Portability and local state

The project projection stores only the wizard's safe portable intent. Profiles, accounts, roles,
endpoints, selected files, CLI paths, credentials, sessions, and command results remain in the
machine-local AWS resource-manager binding store. Import therefore performs no AWS call and leaves
the destination with an explicit local configuration step.

The privileged core reloads the installed model source before execution and regenerates the argument
vector. It invokes the bundled CLI with `spawn` and `shell: false`; arbitrary shell text, credential
arguments, and renderer-supplied argument vectors are not accepted. Output rows are bounded and
redact credential-shaped fields before they reach the renderer.

## Failure modes and recovery

If the bundled CLI is missing, unhealthy, or exposes no readable model files, the Shop reports the
exact unavailable state and offers the dependency repair route. If a selected command disappears
after a CLI refresh, execution is refused and the user can refresh and choose again. Invalid model
metadata, duplicate service or command identities, unsupported field kinds, invalid numeric bounds,
oversized values, and unsafe local binding values fail closed with an actionable message.

## Surfaces

| Surface | Behavior |
| --- | --- |
| Windows desktop | Full model discovery through the AWS Shop, typed controls, shared local bindings, preview, confirmation, and execution. |
| Server Edition | The same shared manager over authenticated WS-RPC, operating on the server host's bundled CLI. |
| Relay tab | Explicitly unavailable until a scoped relay AWS manager route exists, preventing execution on the viewer's machine. |
| Mobile companion | Follow-up in the companion project, which has no AWS CLI host boundary. |

## Verification boundary

This implementation lane intentionally does not run tests, type checks, lint, security or
accessibility checks, builds, installer execution, runtime interaction, or UI captures. The source
implementation and documentation are present, but those checks remain open for the release lane.

Suggested articles: [AWS Universe Shop](aws-universe-shop.md), [provider services](provider-services.md),
and [service nodes](service-nodes.md).
