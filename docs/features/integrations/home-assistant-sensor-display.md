# Home Assistant sensor display nodes

Home Assistant sensor display nodes place selected entity observations directly on the canvas.
One node can present ordinary values, binary states, enum options, gauges, trends, event entities,
weather entities, calendar entities, and selected attributes. Observed history is bounded and
machine-local.

## Behaviour

Create **Home Assistant sensor** from the Node Catalog. A new node starts unbound and makes no
network request. Its binding section always provides these explicit routes:

- **Configure** and **Rebind** verify an instance URL and long-lived access credential before saving.
- **Adopt** binds an existing instance to an imported node on this computer.
- **Deploy** stays disabled because a sensor display does not install Home Assistant.
- **Locate Asset** stays disabled because this integration has no local runtime asset.
- **Leave Unbound** uses the existing two-key destructive confirmation and clears the local URL,
  sealed credential, cache, and observations while preserving portable display intent.

After binding, **Load entities** reads the real Home Assistant entity catalog. The picker supports
plain-text search and its adjacent anchored full regex builder. Each selected entity has a display
mode. Automatic mode uses domain and metadata facts, while an explicit mode never changes the
underlying entity value. Gauge minimum and maximum are user-reviewed. Attribute mode exposes an
explicit checklist rather than a raw response editor.

Refresh runs through the host-owned core service in both the desktop and Server Edition. The relay
viewer refuses these machine-local operations so it cannot contact a service on the viewing
computer by accident. Re-entry is disabled while a request runs. Success, partial results, and
errors use non-blocking notifications that remain in notification history.

## Portable schema 3 intent

The project file stores only:

- entity ids and optional display labels;
- display modes, reviewed gauge ranges, and selected attribute keys;
- refresh interval, history bound, and whether to show last-changed time;
- ordinary node identity, layout, grouping, color, and relationships.

The project file and portable export exclude the instance URL, access credential, provider
session, local paths, host identity, observed values, cache, and runtime request state. Importing a
node performs no network request, deployment, process launch, or download. On another computer it
opens unbound and offers Configure, Rebind, Adopt, Deploy, Locate Asset, and Leave Unbound with
truthful availability reasons.

## Persistence

Portable intent is carried by `CanvasNodeState.homeAssistantSensorConfig`. Machine-local bindings
are stored below the app data directory in `home-assistant-sensor-nodes/<node-id>.json`. The record
keeps the last successful selected-entity observation beside the bounded history, so a temporary
outage can show stale values without claiming that the live instance answered. Desktop uses the
platform secret-sealing hooks. A headless Server Edition host without a credential vault uses the
documented owner-only file fallback. The renderer never receives a stored credential.

Each machine-local record retains at most 720 observations. The configured per-entity history
limit narrows that further. Entity catalogs accept at most 10,000 entries and one response is
limited to 5 MB with a 12-second timeout. Requests reject redirects, embedded URL credentials,
unsupported schemes, and plain HTTP outside the explicit loopback development route.

## Display semantics

| Mode | Presentation |
| --- | --- |
| Value | Current state and Home Assistant unit |
| Binary state | Explicit on or active, off or inactive, or the exact unfamiliar state |
| Enum | Current option plus the declared option catalog |
| Gauge | Numeric state against the reviewed minimum and maximum |
| Trend | Bounded numeric observations, with an honest insufficient-history state |
| Event | Event state and event type attribute |
| Weather | Condition, temperature, and humidity facts when supplied |
| Calendar | State plus current message, start, and end attributes |
| Attributes | Only attributes selected by the user |

Unknown and missing values remain visible as unavailable facts. The node never guesses a unit,
event, forecast, calendar entry, or missing sample.

## Security and privacy

Network access exists only in the core service. It accepts a validated HTTPS URL, or HTTP only on
the supported loopback development route. The access credential exists only in the password field
during setup, the core request header, and sealed machine-local storage. It is never returned,
logged, exported, added to project state, or placed in a notification.

Entity attributes are reduced to bounded scalar values before crossing into the renderer. Nested
objects, arrays, control characters, unbounded strings, and unknown object keys are not reflected
into the display or notification text.

## Failure modes and recovery

| Situation | Result and recovery |
| --- | --- |
| Node imported on another computer | Opens unbound. Use Configure, Rebind, or Adopt. |
| Credential refused | Binding is not saved. Verify the credential and try again. |
| Redirect or unsafe URL | Request is refused without following it. Review the base URL. |
| Timeout or offline instance | The last successful selected-entity observation remains on screen, is marked stale, and the warning notification names the live failure. Refresh retries the instance. |
| Missing selected entity | Other returned entities remain visible and the partial result names the missing count. |
| Non-numeric gauge or trend state | The exact state stays visible, and no fabricated numeric sample is added. |
| Local binding cannot be read | The node reports binding unavailable rather than claiming it is unbound. |

## Verification boundary

This ultra-speed implementation lane intentionally did not run tests, type checks, lint, reviews,
security checks, accessibility checks, builds, packaging, installer execution, runtime interaction,
or UI captures. No verification result is implied by the source implementation.

## Suggested articles

- [Service nodes](service-nodes.md)
- [Scheduled settings](../../scheduled-settings.md)
- [Unified Node Catalog](../canvas/node-catalog.md)
- [Portable project schema](../../portable-project-v3.md)
