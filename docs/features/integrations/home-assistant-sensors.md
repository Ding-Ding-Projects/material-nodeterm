# Home Assistant sensor display nodes

Home Assistant sensor display nodes are live canvas nodes for a single selected entity. The node
supports numeric, binary, enum, gauge, trend, event, weather, calendar, and attributes views. It
loads the entity catalogue from Home Assistant, reads the current state, and then subscribes to
Home Assistant's `/api/websocket` `state_changed` stream so the value updates without polling.

## Configure

Create **Home Assistant sensor display** from the canvas **Managers** menu. Enter an `https://`
Home Assistant address, save a long-lived access token, and choose an entity from the populated
picker. The picker has plain-text search by default and an adjacent anchored regex builder for
deliberate regex filtering. The endpoint, entity id, view mode, history window, and display options
are safe project intent. The access token and endpoint binding remain machine-local, with the token
stored in the host credential store and never exported to `project.json`.

The entity picker is a bounded read-only catalogue, not an owned record collection: bulk mutation,
bulk export, and local history of remote entity metadata do not apply. A sensor-specific export
surface is not yet implemented and remains an explicit follow-up; the credential and its value are
never exported.

The import path is side-effect free. Opening a project that contains the sensor intent does not
connect, fetch, deploy, or mutate Home Assistant. The node shows an unconfigured state until the
person explicitly supplies a local endpoint and token.

When the shared School mode is enabled, this optional integration is omitted from the Managers
menu and its canvas node surface. Turning School mode off restores the node without changing its
saved intent; no Home Assistant copy, credential, or endpoint is revealed while it is omitted.

## Views and state

| View | Behaviour |
| --- | --- |
| Numeric | Formats the current state with the entity unit and device class. |
| Binary | Preserves Home Assistant's current on/off, open/closed, or detected/clear state. |
| Enum | Shows the state string without guessing an enumeration. |
| Gauge | Shows a range-backed progress gauge only when a numeric minimum, maximum, and unit come from the config or entity; otherwise it says unavailable. |
| Trend | Shows a bounded numeric range with a keyboard-focusable text table of retained points; null and non-numeric states remain unavailable. |
| Event | Shows the latest state and timestamp. |
| Weather | Shows the weather entity state and its bounded attributes. |
| Calendar | Shows the calendar state, timestamp, and bounded attributes. |
| Attributes | Shows a scrollable, bounded attribute list while preserving validated nested arrays and objects. |

Each update includes an explicit available, unknown, unavailable, stale, invalid-timestamp, or
offline state. A state is stale when its valid `last_updated` timestamp exceeds the configured
threshold. A malformed timestamp is reported as invalid-timestamp rather than treated as fresh. A
socket error never replaces the last known value with a guessed value; it retains that snapshot,
marks it offline and stale, and retries a bounded number of times with exponential backoff while
refreshing over HTTP.
Updates are routed only to the client that opened the watch, and a newer watch or an unwatch
invalidates every older in-flight read before it can republish.

Numeric states use a strict numeric grammar, so surrounding whitespace, hexadecimal text, and empty
strings do not become readings through JavaScript coercion. Gauge values outside their declared
range are reported unavailable and never produce out-of-range ARIA values.

## Limits and recovery

Entity responses are capped at 2 MiB, WebSocket frames at 512 KiB, requests time out after 10
seconds, JSON depth/keys/arrays/strings are bounded, the entity catalogue is explicitly limited to
200 records per refresh, validated attributes are limited to 100 entries, and history is limited
to 500 points. WebSocket authentication and subscription each have a ten-second deadline.
Redirects, credential-bearing or unsafe endpoint
URLs, unsupported schemes, malformed state responses, missing entities, rejected tokens, invalid
configuration, and oversized responses fail closed with a localized error. Replacing or explicitly
clearing a token first closes every watch using that credential, then saves and re-checks the
credential state; the panel reloads the entity catalogue after a successful replacement. No raw response body or
token is copied into notifications, logs, history, exports, or the shared project file.

Trend history is an in-memory watch cache only. It is bounded by the configured hours and point
limit, is not written to project files or credentials, and is discarded when the watch or app closes.

## Surfaces

The Desktop and Server Edition use the same shared sensor contract and the same core service. The
Server Edition mediates all requests through its authenticated WebSocket RPC bridge and closes the
sensor service during shutdown. Relay clients are deliberately not allowed to proxy this
machine-local Home Assistant credential or socket. A mobile companion has no sensor transport in
this repository; it should consume the portable sensor intent as an unbound card until its own
protocol lane is implemented. These are explicit limitations, not silent fallbacks.

## Suggested articles

- [Service nodes](service-nodes.md)
- [Scheduled settings](../../scheduled-settings.md)
- [Server Edition](../remote/server-edition.md)
