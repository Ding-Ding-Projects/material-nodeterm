# Cloudflare manager

The Cloudflare manager is a guided, local-control surface for accounts, zones, DNS records,
SSL/TLS settings, rulesets, redirects, cache purge, and bounded analytics. It uses the documented
Cloudflare v4 REST API only. There is no arbitrary URL, HTTP method, request body, shell command, or
GraphQL editor.

## Behaviour

The manager discovers accounts and zones from Cloudflare, follows the API's page metadata, and
keeps each successful category in a local partial snapshot. DNS, ruleset, and redirect lists can be
searched with plain text by default, with the anchored regex builder available beside the search
field. A zone picker is populated from discovered zones instead of accepting a free-form target.
Analytics accepts an explicit bounded date range and returns request, bandwidth, threat, and cache
points without claiming data that was not returned by the API.

Mutations are typed by resource. DNS records, rulesets, and redirect rules have create and update
operations, while destructive deletion first creates a preview naming the resource and id. Cache
purge also requires a preview, with either a deliberately selected URL set or the explicit
everything scope. The UI's confirmation is separate from the core preview check, so a renderer
cannot turn an ordinary list call into an unreviewed destructive request.

## Configuration and local persistence

The token field is a password control. The token is stored at `cloudflare/token.json` below the
application data directory, sealed by the desktop credential facility when available. A headless
Server Edition without that facility uses a restricted local file and reports that storage mode.
The token never enters the portable project projection, project history, logs, exports, snapshots,
or renderer state. The manager's partial snapshot is non-secret account, zone, and resource data
only, stored separately at `cloudflare/snapshot.json`.

## Failure modes

Missing configuration, invalid credentials, forbidden permissions, rate limiting, unreachable API,
invalid JSON, oversized responses, and missing resources remain distinct outcomes. Rate-limit
responses preserve a bounded retry-after value. API error text is redacted and capped before it can
reach the UI. A failed refresh leaves the last successful category in the partial snapshot rather
than replacing it with an empty result.

Token permissions are checked through Cloudflare's token verification endpoint. A valid verification
does not prove that every write scope is present, so individual mutations still surface the API's
real forbidden response and the UI keeps the affected action disabled or reports the exact refusal.

## Portability

Cloudflare credentials, provider sessions, account identifiers, local caches, and runtime state are
machine-local. A project export carries no Cloudflare binding or credential. Reopening a project on
another computer therefore presents Configure and Leave Unbound choices rather than silently using a
different account or making a network mutation during import.

## Security

All provider requests are made by the privileged core boundary to the fixed HTTPS API origin. The
renderer receives typed data and never receives the token. Resource ids and user-entered values are
bounded and validated at the core boundary. No request can select a different origin, method, or
body shape. Destructive operations require a fresh core-generated preview, and cache purge is never
implicitly expanded from one URL to an entire zone.

## Verification boundary

This implementation lane intentionally did not run tests, type checking, linting, security checks,
builds, packaging, installer execution, runtime interaction, or UI captures. Those checks remain
required before a release claim. The code establishes the typed transport, vault, pagination,
redaction, partial snapshots, and preview boundaries for that later verification.

## Suggested articles

- [Service nodes](service-nodes.md)
- [Scheduled settings](../../scheduled-settings.md)
- [Portable project archives](../projects/portable-schema3.md)
