# AWS Resource Explorer and Cloud Control managers

The AWS managers provide two guided, typed views of resources without opening a shell or asking
the user to construct an AWS CLI command. The panel is available from Tools in the canvas and is
also discoverable through the command palette.

## Resource Explorer discovery

Resource Explorer 2 is queried with a bounded, paginated `Search` request. Each row keeps
the ARN, service, resource type, region, owning account, and properties returned by AWS. Pagination
stops at a documented maximum and reports `complete: false` with the last token when the limit is
reached. A failed page is never converted into an empty success.

When Resource Explorer is unavailable or permission is denied, the manager makes a clearly labeled
read-only request through the Resource Groups Tagging API. Fallback rows are marked
`tagging-api-fallback`, preserve their tags, and explicitly say that resource-type metadata may be
unavailable. A fallback result is partial when its own page fails.

## Cloud Control

Cloud Control lists the available resource types and then lists resources for a selected type.
Read, create, update, and delete operations use typed fields and a reviewable preview before the
operation is enabled. The preview names the service, operation, region, resource type, identifier,
desired properties, and whether the action is destructive. The preview excludes credentials and
signed headers.

The manager accepts resource type names and identifiers only within bounded, control-character-free
schemas. Desired state is parsed as a JSON object and sent as Cloud Control's `DesiredState`; no
raw shell, command concatenation, or arbitrary executable path is accepted. The delete action is
marked destructive so the app's native confirmation flow can gate it.

## Context and security

Every request produces an `AwsRequestContext` containing a UUID, service, operation, region,
profile, account when known, role when known, endpoint, page size, page token, timestamp, and
redacted parameters. The context is intended for an execution preview and troubleshooting. Secret
keys, session tokens, authorization headers, and response bodies are never placed in it.

The core uses SigV4 over HTTPS with credentials supplied by the local identity boundary. The
renderer and browser bridge receive only typed results. Credentials are not logged, exported,
persisted in project data, or sent through the renderer. Missing credentials produce a distinct
`missing-credentials` state. HTTP 401/403 and AWS authorization errors produce
`permission-denied`; a successful first page followed by an error remains `partial`.

## Failure and recovery states

| State | Meaning and next action |
| --- | --- |
| Missing credentials | Configure a local AWS profile in the identity settings. |
| Permission denied | Review the required Resource Explorer, Tagging API, STS, or Cloud Control permissions. |
| Partial results | Inspect the detail and use the returned page token after correcting the provider issue. |
| Error | The request could not complete; the exact bounded error is shown and no mutation is assumed. |

The AWS manager does not claim that a failed read means no resources exist. It reports the source,
page, token, permission state, and exact failure detail separately.

## Verification status

This implementation lane did not run tests, type checking, linting, builds, packaging, runtime
interaction, or captures. Those checks remain an explicit follow-up for the integration owner.

## Suggested articles

- [Portable project schema 3](../projects/portable-schema3.md)
- [Service nodes](./service-nodes.md)
- [In-app documentation](../help/in-app-documentation.md)
