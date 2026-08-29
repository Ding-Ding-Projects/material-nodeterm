# Home Assistant Control nodes

The Home Assistant Control node is a canvas node for discovering and operating a configured Home
Assistant instance. It is a guided control surface, not a raw HTTP editor or shell launcher.

## What it does

The node uses the trusted host bridge's multi-instance list, refresh and snapshot operations to
obtain a bounded catalog with connection state, instances, entities, domain services, field schemas
and permission explanations. A missing or disconnected credential is shown as a capability gap,
never as an empty instance.

Each instance, entity, domain and service picker has its own plain-text search and adjacent anchored
regex builder. Service fields become typed controls from their schema: booleans, bounded numbers and
durations, colours, enumerated choices, entity choices and text. Unknown selectors remain visible
through a bounded **Schema fallback value** control. Required fields, choices and numeric bounds are
validated again immediately before a call.

The selected entity's live state is shown with availability and last-change time. It refreshes on a
bounded interval and can be refreshed manually. Read-only entities and services stay visible but
disabled with the exact permission reason supplied by the host.

## Calls and recovery

**Review service call** opens an in-node confirmation surface showing the exact instance, domain,
service, entity and typed payload. Only **Confirm and call** invokes the host bridge. A result states
whether Home Assistant accepted the call and whether state changed. Errors remain visible with the
host's recovery detail, and a partial permission result never becomes a success message.

## Portability and privacy

Schema 3 project JSON carries only `homeAssistantIntent`, the safe domain and service intent. The
endpoint, opaque credential key, instance binding, entity binding, live state, permissions, caches,
tokens and host-specific identifiers remain in the machine-local node overlay. Import therefore
makes no network request or service mutation. On another computer, use Configure or Rebind to select
the local Home Assistant instance and entity.

The shared `HomeAssistantApi` accepts instance identifiers and structured service-call data. The
trusted host implementation owns URL checks, timeouts, response bounds, redirect policy and token
lookup. Token bytes never enter renderer state, project JSON, exports, logs or history.

## Verification boundary

This lane added the shared contract, normalization and final payload validation, the renderer panel,
local binding boundary and documentation. Host registration, generated offline-doc bundle refresh,
tests, packaging, runtime interaction and captures remain pending for the parent integration lane.

Suggested articles: [Service nodes](service-nodes.md), [Scheduled settings](../../scheduled-settings.md),
[Portable canvas projection](../projects/portable-canvas-projection.md).
