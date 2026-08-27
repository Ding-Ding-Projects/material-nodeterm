# Guided GitHub API capabilities

The app exposes a typed, guided capability catalog for GitHub REST and GraphQL operations. The
catalog is available from the existing GitHub integration boundary, so source control, project,
issue, release, notification, and documentation surfaces can offer actions in context without
opening a detached request console.

## Capability catalog

The hand-written inventory in `src/shared/github-api.ts` covers repositories, branches, commits,
tags, contents, issues, pull requests, reviews, discussions, projects, Actions workflows and
runs, jobs, artifacts, caches, environments and runners, releases, packages, deployments,
organizations, teams, users, notifications, search, security alerts, rulesets, webhooks, apps,
account profile, and rate limits. Each row records its transport, HTTP method, scope, required
semantic values, pagination support, and whether the action is destructive.

`account.profile` uses a fixed GraphQL document against GitHub's documented schema. All other
operations use fixed REST routes from GitHub's official API. The operation id is the only route
selection input. There is no endpoint field, arbitrary query string, arbitrary GraphQL document,
request-header editor, shell command, or viewer-machine fallback.

## Guided values and safety

Inputs are semantic values such as a repository selected from the approved project, a branch,
commit SHA, issue number, release id, organization, or bounded message. The host validates every
segment, path, number, text value, and operation-specific body field immediately before use. The
renderer receives operation results and progress only. Credentials are resolved by the host from
the existing GitHub credential boundary and are never placed in renderer state or project files.

Repository-scoped actions require an approved project id. The host derives the repository from that
project's current configuration and origin, rather than trusting a repository supplied by a
renderer. Account and organization actions still require an authenticated account and are limited
to the permissions GitHub reports for that account.

Destructive operations, including archive, delete, close, merge, dismissal, and destructive
configuration changes, require a completed confirmation for the exact operation id. The API layer
does not collect or store confirmation keys. The app's native two-key confirmation surface owns
that interaction and passes only the completed semantic result.

## Pagination, progress, cancellation, and limits

List operations accept a bounded page and page size, defaulting to 50 and never exceeding 100.
GitHub's `Link` header is decoded only when it points back to `https://api.github.com` and carries
a valid bounded page. Results are capped to bounded item, field, string, and nesting limits. The
host strips credential-shaped fields from returned records and exposes only normalized result data.

Each request receives an operation id scoped to its calling UI. The host emits queued, requesting,
decoding, completed, cancelled, or failed progress states through the same platform bridge used by
the desktop and Server Edition. A UI can cancel only its own active operation. At most four
operations run for one UI at a time, and cancellation aborts the in-flight request rather than
pretending that a later response succeeded.

The existing client retains the fixed GitHub API version header, manual redirect policy, response
size limit, timeout, primary and secondary rate-limit detection, and retry timestamp. A rate-limit
result stays distinguishable from insufficient permission, malformed data, an oversized response,
an invalid request, and transport failure so the notification and recovery surfaces can offer the
right next action.

## Contextual use

The `githubApi` bridge is intentionally a capability surface, not a new detached console. Existing
repository, source-control, issue, board, release, notification, and documentation surfaces can
request the operation catalog, present only the relevant rows, and pass their own selected semantic
context. Every picker and list that consumes the catalog must keep plain text as its default search
mode and provide its own adjacent anchored full regex builder. The catalog itself remains stable so
new consumers do not invent a second operation registry.

Relay tabs do not receive account-wide GitHub bindings. Their API namespace refuses explicitly so a
remote tab cannot accidentally use the viewer's account or expose the host account's resources.
The Server Edition uses the same core service over its authenticated bridge, with its documented
host boundary.

## Official sources

- [REST API documentation](https://docs.github.com/en/rest)
- [GraphQL API documentation](https://docs.github.com/en/graphql)
- [REST API pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api)
- [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

## Verification boundary

This issue's implementation lane intentionally did not run tests, lint, type checks, builds,
packaging, runtime interaction, reviews, audits, or UI captures. Those checks belong to the
dedicated feature pull request. The source lane is therefore implemented but unverified until that
pull request drives the built desktop and Server Edition surfaces.

Suggested articles: [GitHub Issues sync](../../github-issues-kanban.md), [Shared provider services](provider-services.md), and [Notifications](../notifications.md).
