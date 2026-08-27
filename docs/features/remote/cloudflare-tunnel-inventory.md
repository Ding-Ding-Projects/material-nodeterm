# Cloudflare Tunnel inventory and DNS adoption

The Cloudflare Tunnel manager reads a bounded inventory of tunnels, public hostnames, ingress
routes, and DNS records through the documented Cloudflare API. It is a manager node with typed
choices, not a raw API client or a shell wrapper.

## Guided route configuration

Choose a configured Cloudflare credential and account in the existing Cloudflare manager, choose a
zone from the bounded zone list, refresh the inventory, then select a tunnel from the returned list.
Enter the hostname, path, and origin service in the route form. The host process validates the
hostname, path, protocol, and service again immediately before sending the provider request. Existing
ingress routes are read and sent back together with the new route, so a new route never replaces
unrelated routes.

The tunnel, route, and DNS lists each have their own plain-text-first search field and adjacent
anchored regex builder. Invalid patterns remain visible with the builder's engine error. A bounded
inventory reports when the account, route, or DNS record limit was reached instead of pretending the
list is complete.

## Hostname conflicts

Before a route is saved, the manager checks the refreshed route and DNS inventories. A route already
owned by another tunnel is a conflict and remains unchanged. A hostname with an existing CNAME is
also a conflict until the person explicitly selects an adoption action. No wildcard hostname is
accepted, and a hostname is always normalized to lower case before comparison.

## DNS record adoption

The DNS panel lists the exact record that matches the selected zone and hostname. **Adopt existing**
keeps its content and proxy state while recording that the record is associated with the reviewed
route. **Leave unmanaged** keeps the provider record and route separate. **Replace after
confirmation** is limited to one exact record, requires typing `ADOPT <hostname>`, and then uses the
application's two-key destructive confirmation flow. Other records in the zone are never touched.

## Local and portable state

API tokens are selected from the existing Cloudflare core manager's local credential list and are
sealed with the host's credential boundary. The tunnel manager never accepts or stores a second
copy of a token and no token crosses the renderer bridge. Local route metadata is bounded and kept
below the application data directory.

Schema 3 portable intent stores only the display label, hostname, path, origin service, protocol,
and the required preserve-existing-routes choice. Account ids, zone ids, tunnel ids, DNS ids, token
material, provider sessions, host paths, caches, and live health are not portable. Importing the
intent performs no network request, provider mutation, deployment, process launch, or download. On
another computer the node must be configured or rebound explicitly, or left unbound.

## Failure and recovery

| Situation | Result |
| --- | --- |
| Missing token | The inventory remains unavailable and asks you to configure a credential in the existing Cloudflare manager. |
| Invalid or expired token | The provider refusal is shown without exposing the token. |
| Redirect or non-success API response | The request stops; no route or DNS mutation is reported. |
| Malformed or oversized response | The response is refused at the bounded parser. |
| Existing route or hostname | A conflict plan is shown and the existing route is preserved. |
| Existing DNS record | Adoption action is required; replacement is separately confirmed. |
| Account or zone unavailable on another computer | The portable route opens unbound with Configure, Rebind, Adopt, or Leave Unbound choices. |

## Security boundary

The privileged core builds the fixed Cloudflare API paths and request shapes. The renderer submits
typed ids and route fields only. Requests use HTTPS, reject redirects, carry the token only in the
core process, and enforce response and page bounds. No arbitrary URL, shell command, request body,
header editor, credential export, or provider payload passthrough is available.

## Verification boundary for issue #59

This ultra-speed implementation lane intentionally did not run tests, type checks, lint, reviews,
security or accessibility checks, builds, packaging, installer execution, runtime interaction, or
UI captures. The source and documentation are therefore not a runtime or packaged verification
claim. The parent integration lane must run its own checks against the exact merged commit.

## Suggested articles

- [Server Edition](./server-edition.md)
- [Remote and SSH projects](./README.md)
- [Project history and archives](../projects/project-history-and-archives.md)
