# AWS managers

The AWS manager nodes provide guided, reviewable access to AWS Resource Explorer and Cloud Control
through the locally bundled AWS CLI v2. They keep project intent portable while keeping profiles,
endpoints, request state, result pages, and credentials on the current computer.

## Articles

- [Resource Explorer](./resource-explorer.md)
- [Cloud Control](./cloud-control.md)
- [AWS core-service managers](../integrations/aws-core-services.md)
- [AWS CDK manager](../integrations/cdk-manager.md)

## Shared behavior

Each manager offers a local profile and region picker, an optional HTTPS endpoint override (or an
explicit loopback HTTP endpoint), a generated-operation preview, bounded output, manual pagination,
progress, cancellation, and a local result search with an anchored full regex builder. The node
stores only mode, region intent, query, and safe typed core-service fields in the portable project
projection. Core services are S3, EC2, IAM, STS, Lambda, CloudWatch, and CloudWatch Logs. STS is
limited to caller identity, so temporary credentials never reach the renderer or project data.

The server edition receives the shared node shape, but only a host exposing the typed AWS bridge can
execute operations. When that bridge is unavailable the node says so and keeps all controls honest.

## Verification boundary

This lane intentionally does not run tests, type checks, lint, builds, packaging, runtime
interaction, security or accessibility reviews, installer execution, or UI captures. Those remain
unverified until the owning integration lane runs them against the built application.

## Suggested articles

- [Portable schema 3](../projects/portable-schema3.md)
- [AWS Universe Shop](../integrations/aws-universe-shop.md)
- [Node Catalog](../canvas/node-catalog.md)
