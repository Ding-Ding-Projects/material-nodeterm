# AWS core-service managers

The AWS core-service node is a guided canvas manager for S3, EC2, IAM, STS, Lambda, CloudWatch, and
CloudWatch Logs. It uses the installed AWS CLI v2 through the privileged core boundary. The renderer
never accepts a shell command, raw argument vector, or credential value.

## Behaviour

Create **AWS core services manager** from the Node Catalog inside an AWS Universe. Choose a service
tab, then choose one of the operations supplied for that service. Operations are typed and validate
their fields before the CLI is started. Read-only operations show a preview and then run. Create,
start, stop, and other mutating operations state their risk; destructive operations use the existing
two-key confirmation surface. Results are JSON rows with bounded pagination, searchable with plain
text by default and an adjacent anchored full regex builder. Long requests expose started,
completed, failed, cancelled, and timeout state at the node that started them.

The current operation set is:

| Service | Guided operations |
| --- | --- |
| S3 | List buckets, list objects, create bucket, delete bucket |
| EC2 | Describe instances, describe security groups, start, stop, terminate instances |
| IAM | List users, list roles, get user, get role, create user, delete user |
| STS | Get caller identity |
| Lambda | List functions, get function, delete function |
| CloudWatch | List metrics, get metric data |
| CloudWatch Logs | Describe log groups, describe log streams, get log events, filter log events |

## Local binding and portability

The node's project data contains only service, operation, region intent, and safe operation fields.
The selected AWS profile, account session, endpoint, CLI path, output, request tokens, process state,
and credentials live under the local application data directory in
`aws/core-service-bindings.json`. Importing a project never invokes the CLI, contacts AWS, starts a
process, or changes a provider. A new computer shows an unbound manager until the user chooses a
local profile and region. Endpoint URLs must use HTTPS, except for an explicit loopback development
endpoint, and may not contain credentials.

## Security and failure modes

The core uses `execFile` with an argument array and never invokes a shell. The runtime resolver
prefers a packaged AWS CLI, then a user-scoped application-data copy, then the system executable;
the visible status names the selected origin. Missing or unhealthy CLI state disables execution and
names the next action. Profile and region input is bounded and revalidated at the host boundary.
Provider refusal, malformed JSON, timeout, cancellation, and unavailable credentials are reported
without exposing command output as a secret or storing credentials in the project file.

## UI and accessibility

Service tabs are real keyboard-operable tabs with visible focus and a selected state. Profile choices
are a listbox populated from the local CLI rather than a blank free-text field. Operation fields are
created from the operation's typed schema. Results have an independent search field and anchored
regex builder, internally scroll at narrow widths, and expose a live status message for progress.
The node uses project Material Design 3 tokens and the existing destructive confirmation component.

## Verification boundary

This implementation lane intentionally ran no tests, type checks, lint, review, security or
accessibility checks, builds, packaging, installer execution, runtime interaction, or UI captures.
Those are follow-up Chuts for the integration and release lane. The source changes are therefore
implemented but not runtime-verified.

## Suggested articles

- [Special-universe Shop nodes](./aws-universe-shop.md)
- [Portable canvas projection](../projects/portable-canvas-projection.md)
- [Node Catalog](../canvas/node-catalog.md)
- [Portable Node Universes and Hosting Program](../../plans/2026-08-26-portable-node-universes-and-hosting-program.md)
