# Hosted-service Cloudflare Tunnel handoff

## Behaviour

Hosted service nodes can prepare a private-first Cloudflare Tunnel handoff after the local service
has answered a real health request. The panel is deliberately a handoff surface, not a full
Cloudflare manager. It discovers typed HTTP or HTTPS origins from the saved service endpoint,
shows the candidate and its health state, and keeps the handoff action unavailable until that
candidate has been checked successfully.

The handoff contract is typed around four values: the hosted service kind, the origin, a selected
Cloudflare account, and a selected Cloudflare zone. The hostname is validated as a DNS hostname.
Cloudflare Access is required and cannot be turned off by this lane. A future Cloudflare manager
supplies the account and zone catalog plus the mutation callback through the panel seam. Until that
manager is present, the panel says exactly why handoff is unavailable and does not claim to have
created a tunnel.

The visible state moves through `unbound`, `discovering-origin`, `checking-local-health`, `ready`,
`handing-off`, `connected`, `failed`, and `rolled-back`. A failed provider operation leaves the
local service untouched. A successful rollback clears only the selected handoff binding.

## Configuration and portability

The portable schema 3 projection records only this safe intent:

```json
{
  "provider": "cloudflare-tunnel",
  "exposure": "private-first",
  "access": "required",
  "healthPath": "/"
}
```

The account, zone, hostname, origin, tunnel identifier, connector state, process state, local
paths, and every credential remain in the machine-local service connection overlay. They are not
written to `.nodeterm/project.json`, schema 3 `project.json`, project archives, peer mutations,
logs, exports, or documentation. Importing a project therefore never makes a network call, starts
a connector, creates a tunnel, changes DNS, or changes an Access policy.

The account and zone surfaces are searchable list pickers. Each has its own plain-text search and
adjacent anchored regex builder. The origin list has the same controls. The default search mode is
plain text, and regex mode is explicit and scoped to that one list.

## Failure modes and recovery

- An absent or malformed service endpoint produces no candidate and explains that an HTTP(S) origin
  must be saved first.
- Credentials, fragments, queries, unsupported schemes, invalid ports, control characters, and
  malformed paths are refused by the typed origin parser.
- A health timeout or non-success response produces a failed state with a bounded, readable reason.
  It never enables handoff.
- Missing Cloudflare account or zone data keeps the picker empty and the handoff control disabled.
  The panel identifies the missing catalog rather than offering a blank free-form provider request.
- A handoff failure produces `failed`, preserves the local service, and keeps the previous binding
  available for review. Rollback is offered only for a real binding and reports a rollback failure
  separately.
- A project imported on another computer starts with private-first intent and no provider binding.
  The user must configure the local service origin and explicitly rebind the Cloudflare account,
  zone, hostname, and connector through the provider manager.

## Security considerations

The local health request uses `GET`, omits credentials, has an abort deadline, and does not mutate
the provider. The panel never accepts an arbitrary command, shell string, image, entrypoint,
Compose file, token, or raw API request. Account and zone identifiers are local binding metadata,
not credentials. Connector tokens belong in the operating-system credential store or protected
secret volume owned by the future Cloudflare connector lane, never in the project file or renderer
state.

The private-first sequence is intentional: local health is proof that the selected service is
reachable before any provider mutation is attempted, while Access remains required for the public
hostname. This lane does not implement Cloudflare API authentication, tunnel creation, DNS
routing, or connector processes. Those capabilities belong to the separate Cloudflare manager and
connector lanes.

## Surface availability

| Surface | Availability |
| --- | --- |
| Windows desktop | The GitLab service node renders the typed origin, health, picker, Access, handoff, and rollback seam. Provider mutation waits for the Cloudflare manager. |
| Server Edition | The shared typed contract is safe to consume, but no provider mutation is exposed from a browser-only host. |
| Mobile companion | Not changed by this repository lane. It must treat the portable intent as unbound and request explicit local configuration. |

## Verification

This ultra-speed implementation lane intentionally did not run tests, type checking, linting,
security checks, accessibility review, builds, packaging, installer execution, runtime interaction,
or screenshots. The typed contract and UI wiring are implementation evidence only. A later full
verification pass must exercise local health success and failure, malformed origins, picker search
and regex mode, account and zone binding, provider failure, rollback, import with no side effects,
and the packaged desktop surface.

## Suggested articles

- [Portable canvas projection](../projects/portable-canvas-projection.md)
- [Server Edition](./server-edition.md)
- [Scheduled settings](../scheduled-settings.md)
- [Status surface](../status-surface.md)
- [Cloudflare deployment guide](../../../deploy/cloudflared.md)

