# Home Assistant multi-instance client

The Home Assistant service node is a real machine-local client for more than one Home Assistant
instance. It discovers current entities through either the REST API or Home Assistant's WebSocket
API, then provides local domain and entity filters. It does not expose a raw request editor or an
arbitrary command field.

## Configure and bind

Use **Add instance** in a Home Assistant node. Enter a display name, an HTTPS base address, and a
long-lived access token. Plain HTTP is accepted only for an explicit loopback address. Addresses
with embedded credentials, query strings, fragments, control characters, or unsupported schemes
are refused with a recovery message.

The instance picker lists every instance configured on this computer. Its local filter starts in
plain-text mode and has an adjacent anchored full regex builder. Binding is explicit. A node
opened on another computer remains unbound and offers the same Configure or Rebind route instead
of making a network request during import.

## Discovery

Choose **REST snapshot** or **WebSocket snapshot**, then choose **Discover entities**. Both routes:

- authenticate only inside the privileged host process;
- impose a 20-second deadline and a 5 MB response bound;
- cap one discovery result at 20,000 entities;
- validate entity identifiers and bounded display metadata before returning it to the renderer;
- report connecting, authenticating, discovering, completed, failed, and cancelled progress;
- keep the previous visible result when a retry fails or a discovery is cancelled.

The domain picker and entity list each have independent local searches and adjacent anchored full
regex builders. Entity rows show the factual entity id, friendly name, current state, and unit when
Home Assistant supplied one. Program 16 and Program 17 add control and dedicated sensor-display
nodes; this lane provides their shared instance and discovery foundation.

## Persistence and portability

| Data | Location | Portable |
| --- | --- | --- |
| Instance name and base address | application data under `home-assistant/instances.json` | no |
| Access token | dedicated sealed Home Assistant credential store under application data | no |
| Active requests, sockets, entity results, progress | memory only | no |
| Node label, layout, relationships, REST or WebSocket preference, domain preference | schema 3 project projection | yes |
| Selected instance binding | machine-local service binding overlay | no |

Schema 3 import validates and stages project content without calling Home Assistant. It does not
restore a credential, provider session, host-specific identifier, cache, request, socket, or
process. The imported node explains that the local binding was omitted and waits for an explicit
Configure or Rebind action.

## Security and failure behavior

The token is write-only from the renderer's perspective. It crosses the privileged boundary only
when the user saves it, is stored through the core platform's sealed credential seam, and is never
returned to the interface, project file, export, logs, cache, documentation, or issue records.
Removing an instance uses the existing two-key destructive confirmation and clears both metadata
and the stored token before reporting completion.

Redirects are refused. HTTPS is required except on loopback. Authentication refusal, malformed or
oversized responses, timeouts, unavailable local metadata, and WebSocket failures remain distinct
messages with a retry path. A failed read is not reported as an empty instance list.

## Verification boundary

Issue #26 was implemented under the active ultra-speed boundary. No tests, type checks, lint,
builds, packaging, reviews, security checks, accessibility checks, installer execution, runtime
interaction checks, or UI captures were run in this implementation lane. Source implementation is
not runtime verification.

## 廣東話摘要

呢個 Home Assistant client 可以喺同一部電腦記住多個 instance，用 REST 或 WebSocket 搵
entity，仲有獨立 domain 同 entity search。Token 只會交畀 privileged host 儲存，唔會返
畀畫面，更加唔會跟 project export 周圍旅行。Project 搬去另一部電腦之後會老老實實顯示
未綁定，等你自己 Configure 或 Rebind，唔會一 import 就偷偷打電話返屋企。
