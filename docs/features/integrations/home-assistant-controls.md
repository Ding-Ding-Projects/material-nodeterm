# Home Assistant control nodes

Status: **implemented, with source verification intentionally unrun in this delivery lane.**

## Behaviour

A Home Assistant control node binds to one connection stored on the computer running the shell,
discovers the instance's real entity registry and service catalog, and renders controls from those
facts. Switches, lights, fans, media players, automations, covers, locks, climate devices, numeric
entities, buttons, scenes, scripts, vacuums, alarm panels, humidifiers, and water heaters receive
domain-specific controls. Every other domain falls back to a service picker generated from Home
Assistant's reported field schemas. Schema selectors become matching local controls: booleans use
checkboxes, bounded numbers use a range plus numeric entry, options use a picker, entity and target
selectors use the discovered entity list, date and time selectors use native date/time controls,
and multiline text uses a bounded text area. Unknown selectors remain visible as bounded text with
the schema description. There is no raw request editor and no guessed service.

Connection, entity, and service collections each have their own plain-text-first local search and
adjacent anchored regex builder. Disabled controls state the missing condition. Discovery and
service calls report their real state, can be cancelled, retain the last valid result on a failed
retry, and never turn a failed response into an empty-success claim.

## Configuration and rebinding

Create **Home Assistant control** from the Node Catalog. A new node starts unbound and performs no
network operation. Choose an existing local connection or open **Configure a connection**, enter a
display name, HTTPS origin, and long-lived access token, then choose **Save and bind**. Plain HTTP
is accepted only for loopback. Origins containing credentials, queries, fragments, or redirects are
refused.

On another computer the portable node keeps its entity, domain, and service hints but is unbound.
The available actions are Configure, Rebind, and Leave unbound. The saved hints make the intended
control recognizable without claiming the new machine has the old machine's credential or host.

## Portability and privacy

The schema 3 project projection carries only node identity, layout, relationships, display state,
and these safe intent fields:

- entity hint;
- domain hint;
- service hint;
- automatic, domain, or schema control mode.

The following stay in the shell's machine-local application data and are omitted from project
files, imports, exports, canvas sync, and mobile transport: connection ids, origins, bearer tokens,
discovery caches, attributes, host identity, active requests, and process state. Tokens are sealed
through the platform credential boundary where available and are never returned to the renderer.
Server Edition uses its documented owner-only local storage fallback when no operating-system
credential vault exists.

Importing a node never contacts Home Assistant, creates a connection, deploys anything, downloads
anything, or mutates a provider. Only an explicit Discover or control action performs a bounded
request.

## Failure modes and recovery

- **Unbound:** choose or configure a connection on this computer.
- **Binding missing:** the local connection was removed or belongs to another machine. Rebind it.
- **Authentication refused:** replace the local token. The previous token is never displayed.
- **Offline, timeout, redirect, oversized, or malformed response:** no control result is claimed;
  retry, cancel, or rebind.
- **Unknown domain:** use the verified schema fallback. Unsupported fields remain ordinary bounded
  inputs whose final validation belongs to Home Assistant.
- **Unsupported selector details:** the schema description stays visible and the field remains
  bounded. Selector metadata is limited to a finite object and list shape before it reaches the
  renderer, so a malformed or oversized service response cannot create an unbounded control.

## Surfaces

- **Desktop:** complete source wiring through the shared core service and desktop preload.
- **Server Edition:** the same core registrar and renderer run on the server host, so local means
  the server computer.
- **Mobile companion:** no credential or connection is transported. A companion may display the
  portable unbound intent, but live controls require a separately approved implementation in its
  private repository.

## Verification boundary

This ultra-speed implementation lane intentionally ran no tests, type checks, lint, reviews,
security checks, accessibility checks, builds, packaging, installer execution, runtime interaction,
or captures. The implementation and documentation are present; those verdicts remain unverified.

## Suggested articles

- [Unified Node Catalog](../canvas/node-catalog.md)
- [Service nodes](service-nodes.md)
- [Scheduled settings](../../scheduled-settings.md)
- [Portable project schema](../projects/portable-project-schema.md)
