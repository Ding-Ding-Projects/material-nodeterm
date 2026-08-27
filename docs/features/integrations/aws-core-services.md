# AWS core-service managers

The AWS core-service routes mount on the existing AWS Resource Explorer manager node and shared AWS
CLI service. The AWS Shop exposes one entry each for S3, EC2, IAM, STS, Lambda, CloudWatch, and
CloudWatch Logs. There is no second profile store, credential stack, or raw command editor.

## Guided operations

Choose **Core services** in the manager, then select the service and an operation. The typed routes
are:

| Service | Operations |
| --- | --- |
| S3 | List buckets, list objects, create bucket, delete bucket |
| EC2 | Describe instances and security groups, start, stop, terminate instances |
| IAM | List users and roles, inspect a user or role, create or delete a user |
| STS | Get caller identity only. Session credentials are never returned to the renderer. |
| Lambda | List, inspect, or delete a function |
| CloudWatch | List metrics or request metric data |
| CloudWatch Logs | Describe groups or streams, read events, or filter events |

Every request is previewed with its service, operation, profile, region, endpoint, generated
argument vector, pagination, retry policy, and risk. Write operations are labelled. Destructive
operations use the existing two-key confirmation surface. Results are bounded and paginated where
the AWS CLI supports a continuation token. Started, completed, failed, cancelled, and timeout
states are sent through the existing AWS progress channel and rendered at the node that started the
operation.

The result list has a plain-text-first search and its own adjacent anchored full regex builder.
Service and operation choices are real keyboard-operable tabs with visible focus. Empty, missing,
unavailable, invalid, and provider-refused states retain their exact reason and next action.

## Portable and local state

The node projection stores only AWS mode, service, operation, region intent, and bounded safe input
fields. Profile names, account bindings, role sessions, endpoints, request tokens, CLI paths,
provider results, process state, and credentials stay in the machine-local
`aws/resource-manager-bindings.json` and transient operation state. Importing a project does not
contact AWS, invoke the CLI, launch a process, or mutate provider state. Reopening on another
computer presents the explicit local profile and region binding path.

## Failure and security behaviour

The shared core resolves the verified bundled AWS CLI first, then its declared host resolver and
system fallback. A missing runtime remains visibly unavailable with a repair action. All commands
use `spawn` with `shell: false` and an argument array. Inputs are bounded and revalidated in the
core. Output is capped and must be valid JSON. Endpoint URLs reject embedded credentials and allow
HTTP only for loopback development. STS never exposes temporary credentials.

## Verification boundary

This PR-preparation lane intentionally ran no tests, type checks, lint, builds, packaging, runtime
interaction, reviews, security or accessibility audits, or UI captures. The source is mounted and
pushed for the parent integration lane, where those checks and built-surface checks remain pending.

## Suggested articles

- [AWS managers](../aws/README.md)
- [AWS identity manager](./aws-identity.md)
- [AWS CLI model documentation](./aws-cli-model-documentation.md)
- [Special-universe Shop nodes](./aws-universe-shop.md)
- [Portable canvas projection](../projects/portable-canvas-projection.md)
