# AWS container, database, network, DNS, and cost managers

Program 38 extends the shared AWS resource manager with guided operations for ECR, ECS, EKS, RDS,
database services, VPC, Route 53, and cost management. These are modes of the existing
`AwsResourceNode` and `AwsResourceManagerService`; they do not create a second AWS credential or
command stack.

## Behaviour

The node offers typed manager and operation choices, local profile and region binding, a reviewable
generated operation preview, bounded output and pagination, progress, cancellation, retry, and a
result list with plain-text search plus an adjacent anchored full regex builder. ECR covers
repositories and images, ECS covers clusters and services, EKS covers clusters and node-group
capacity, RDS covers database instances and snapshots, database mode covers DynamoDB tables, VPC
covers networks and subnets, Route 53 covers hosted zones and records, and cost mode covers usage
reports and budgets.

Destructive operations such as deleting repositories, services, clusters, databases, tables, VPCs,
or hosted zones pass through the existing two-key confirmation surface. The core rechecks the
confirmation before spawning a process. Numeric values and JSON fields are bounded and validated
before the command is assembled.

## Portable state

The project projection records the selected mode, manager, operation, region intent, and bounded
safe input values. Profiles, account and role sessions, endpoint overrides, credentials, request
tokens, live resource identifiers, result rows, and process state stay local to the machine. Import
performs no AWS request, deployment, process launch, or provider mutation.

## Security and failure modes

The core invokes the bundled AWS CLI through a fixed argument array with `shell: false`, a hidden
window, bounded stdout and stderr, and a timeout. It redacts credential-shaped response fields
before results reach the renderer. Missing CLI, missing local binding, invalid profile or region,
malformed JSON, out-of-range input, unavailable service capability, and failed requests remain
distinct visible states with recovery guidance. An empty result is never used to disguise a failed
read.

## Verification boundary

This issue lane intentionally did not run tests, lint, type checks, builds, packaging, reviews,
security or accessibility checks, runtime interaction, installer execution, or UI captures. Those
proofs remain unverified until the owning integration lane runs them against the built application.

## Suggested articles

- [AWS managers](../aws/README.md)
- [AWS core-service managers](aws-core-services.md)
- [AWS identity manager](aws-identity.md)
- [AWS CLI model documentation](aws-cli-model-documentation.md)
- [AWS Universe Shop](aws-universe-shop.md)
