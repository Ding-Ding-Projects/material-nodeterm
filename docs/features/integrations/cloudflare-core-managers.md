# Cloudflare core managers

Status: implemented in source, with verification intentionally unrun in the ultra-speed lane.

The Cloudflare core manager node provides eight typed manager areas: accounts, zones, DNS, SSL/TLS,
rulesets, redirects, cache, and analytics. It uses the documented Cloudflare API v4 over HTTPS and
keeps the operation catalog in shared code so the Desktop and Server Edition host paths cannot
silently diverge.

## Guided operations

The node presents manager tabs and a bounded operation picker. Operations are fixed and typed rather
than a raw request editor or shell command:

| Manager | Operations |
| --- | --- |
| Account | List accounts, get account |
| Zone | List zones, get zone |
| DNS | List, create, update, and delete DNS records |
| SSL/TLS | List settings, get a setting, update a setting |
| Ruleset | List, get, create, update, and delete rulesets |
| Redirect | List, create, update, and delete redirect rules |
| Cache | Read and update cache settings, purge selected URLs or purge everything |
| Analytics | Read the dashboard or a bounded analytics event page |

Every operation is validated again in the host process. IDs, zone names, record types, TTL values,
setting names, rules, redirect status codes, analytics ranges, page numbers, and page sizes have
explicit bounds. Unsupported values remain unavailable with an actionable reason. A destructive
operation opens the existing two-key confirmation flow before the request is sent.

## Search and results

Account rows, zone rows, DNS records, SSL/TLS settings, rulesets, redirects, cache settings, and
analytics results each have an isolated plain-text-first search field. Every field has its own
adjacent anchored full regex builder. Regex state is not shared between result lists or credential
selection. Results are capped at 500 rows and response bodies are capped at 4 MiB. Pagination is
reported from Cloudflare's `result_info`; loading another page repeats the same typed request with
the next page number.

## Local credential and binding state

The API token is entered through the node's password field and sealed by the host's existing secure
store at `cloudflare/core-credentials.json`. The renderer receives only credential labels, account
metadata, and timestamps. Tokens never appear in project files, previews, result rows, logs, exports,
or the WebSocket bridge. A node binding is stored in the machine-local
`cloudflare/core-bindings.json` file and contains only the credential id, optional account id,
optional zone id, optional zone name, node id, and update time.

The shared schema 3 projection carries only `cloudflareCoreIntent`: manager, operation, optional
account or zone naming intent, and bounded scalar fields for the selected typed operation. It does
not carry tokens, credential records, API responses, provider sessions, local paths, process state,
request ids, or cache data. Import normalizes this intent and performs no network request, provider
mutation, credential read, process launch, or download. A destination computer opens the node with an
explicit local Configure or Rebind route; an unavailable credential or binding is never presented
as a connected account.

## Progress, cancellation, and unavailable states

Each request receives a local operation id, an `AbortController`, and a 90 second deadline. The host
broadcasts started, completed, cancelled, and failed progress. Cancel aborts the active request and
the renderer keeps the partial result out of the success state. The built-in HTTPS client is reported
as unavailable when the host cannot provide `fetch`; missing credentials, invalid bindings, malformed
responses, HTTP refusals, and response-limit violations retain their distinct messages and recovery
actions.

The Server Edition uses the same registered core service over its authenticated WebSocket bridge.
The node never asks the browser to store or transmit a token outside the host service. A shell that
cannot provide the Cloudflare manager namespace reports an explicit unavailable state rather than
showing a form that cannot work.

## Security boundaries

- The API base URL is a fixed HTTPS constant. Users cannot enter an endpoint, path, header, query
  fragment, shell command, or arbitrary request body.
- Authorization is added only in the host process, from a sealed local credential. Previews redact
  all credential material because they contain no credential fields at all.
- Inputs reject control characters, unsafe object keys, traversal-like ids, oversized strings,
  excessive rule fields, and unbounded arrays. Result sanitization redacts secret-shaped response
  keys before they cross IPC.
- Cache purge everything, record deletion, ruleset deletion, and redirect deletion are classified
  as destructive. They cannot execute without the two-key confirmation flow.
- Cancellation and timeout abort the request. The service does not retry an unknown mutation, so a
  user never receives a second write merely because the first response was slow.

## Surface records

The shared contract is in `src/shared/cloudflare-core-managers.ts`. The host implementation and IPC
registration are in `src/core/cloudflare-core-managers.ts`, with Desktop and Server Edition
registration in `src/main/index.ts` and `src/server/handlers/index.ts`. The preload and authenticated
WebSocket bridge expose the same typed members. The canvas node is
`src/renderer/nodes/CloudflareCoreManagersNode.tsx`; its safe intent is created and persisted by
`src/renderer/state/workspace.ts`, and the Node Catalog entry is in
`src/shared/node-catalog.ts`.

Verification boundary: this source-only ultra-speed lane did not run tests, type checks, lint,
reviews, security or accessibility checks, builds, packaging, installer execution, runtime
interaction, or UI captures. Those remain unverified until the owning integration lane runs the
appropriate checks against the exact integrated commit.

## Suggested articles

- [Shared provider services](provider-services.md)
- [Portable bindings](../projects/portable-bindings.md)
- [Portable schema 3](../projects/portable-schema3.md)
- [Material Design 3 audit](../appearance/material-3-audit.md)
