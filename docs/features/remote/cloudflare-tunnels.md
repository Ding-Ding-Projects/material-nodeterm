# Cloudflare tunnel manager

The Cloudflare tunnel manager inspects accounts, zones, tunnels, connections, routes, and DNS records through the privileged core. It controls the Cloudflare API only and does not start or supervise a connector runtime.

## Behaviour

Settings → Cloudflare tunnels has Inventory, Configuration, and DNS adoption tabs. Token state is presence-only. Account, zone, and tunnel pickers use verified API data. Route configuration uses typed hostname and HTTP(S) service fields, with plain search and an adjacent anchored regex builder.

Every configuration write has a reviewable preview. It lists desired managed routes, unmanaged routes that will be preserved, and hostname conflicts. Conflicts block Apply. DNS adoption requires an existing CNAME in the selected zone pointing to a Cloudflare tunnel hostname; the ownership proof is shown before the existing record is adopted locally. No unmanaged DNS record is replaced or deleted.

## Persistence and security

The token is write-only in the UI and stored below local application data. Desktop builds seal it with the operating-system store; a headless Server Edition uses a restricted local file when sealing is unavailable. The renderer receives only `tokenPresent`. Machine-local account, zone, tunnel, and hostname binding is stored separately from portable project data. Credentials, provider sessions, machine identity, caches, and connector process state are never exported.

HTTP 401, HTTP 403 partial permissions, HTTP 429 rate limits, and network failures remain distinct and include the affected operation and recovery action.

## Verification status

This ultra-speed implementation lane did not run tests, type checks, linting, security checks, accessibility checks, builds, packaging, installer execution, runtime interaction checks, or UI captures. Connector runtime support is deliberately outside this lane.

## Suggested articles

- [Remote & SSH](./README.md)
- [Portable project schema 3](../projects/portable-schema3.md)
- [Scheduled settings](../../scheduled-settings.md)

