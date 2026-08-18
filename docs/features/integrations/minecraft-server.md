# Minecraft server node — researched constraints

Status: **research, not implemented.** This records what was measured before any code was written,
so the design argues from cited facts rather than from what a server node "obviously" ought to do.

The goal: right-click the canvas, get a Minecraft server as a draggable, editable node — every
flavour, every plugin, every config, every command, through a GUI. It runs in Docker, reached over
SSH, and nothing about it may ever cost money.

## 1. Plugin and mod installation has three tiers, and only one is complete

This is the finding that shapes the whole feature, and it contradicts the way the limitation is
usually described.

| source | key needed | can a free app install end to end? |
| --- | --- | --- |
| **Modrinth** | none | **Yes** — no auth for read-only search and version fetch |
| **Spiget / SpigotMC** | none | **Mostly** — individual authors can refuse automated download |
| **CurseForge** | `CF_API_KEY` | **Only with a key** the user supplies |

**Modrinth** needs no token for the operations a browse-and-install GUI performs, and rate-limits per
IP at **300 requests per minute**. Its `User-Agent` header is **mandatory**, not advisory — the docs
say a uniquely-identifying agent must be provided, and generic library identifiers such as
`okhttp/4.9.3` are called out as more likely to be blocked. So the app sends its own name and a
contact, and a shared HTTP client must not be allowed to overwrite that header.

**The SpigotMC restriction is not what people say it is.** The claim in circulation is that *premium*
resources cannot be fetched programmatically. What is actually true is narrower and worse: the
refusal is **per resource, set by its author, and it applies to free plugins too**. The image's own
documentation names the case that matters most:

> "Some plugins, such as EssentialsX (resource ID 9089), do not permit automated downloads via
> Spiget. Instead, you will need to pre-download the desired file and supply it to the container"

EssentialsX is not an edge case; it is one of the most widely installed plugins there is. So a GUI
offering only API-driven installation has a hole exactly where a new operator looks first, and no
amount of better API integration closes it.

**Therefore a first-class "supply your own jar" route is not a fallback — it is the thing that makes
"no gaps" true.** Upload or point at a local jar and the node places it in `plugins/` or `mods/`
itself. Every source above is then a convenience layered on the one path that always works, the one
the user controls. Designing it the other way round, APIs first with upload bolted on later, produces
a feature that cannot install EssentialsX.

`CF_API_KEY` is a key the user obtains rather than a payment, but it is still a credential: OS
credential vault, never argv, a compose file, a log or a screenshot.

## 2. The image variable surface, and one warning about it

`itzg/minecraft-server` is the hosting mechanism. Confirmed variables relevant here:

- **`EULA`** — must be `true` or the server will not start.
- **`TYPE`** (default `VANILLA`) and **`VERSION`** (default `LATEST`) select flavour and version.
- Memory: **`MEMORY`** sets init and max together (default `1G`), or **`INIT_MEMORY`** and
  **`MAX_MEMORY`** independently. **`JVM_OPTS`**, and **`JVM_XX_OPTS`** which must precede `-X`
  options.
- JVM presets: **`USE_AIKAR_FLAGS`**, and **`USE_MEOWICE_FLAGS`**, described as updated flags for
  Java 17+. Worth noting because "use Aikar flags" is repeated everywhere as current advice while the
  image itself now ships a newer alternative — a GUI offering only Aikar is offering 2020 answer.
- Whitelist: **`ENABLE_WHITELIST`**, **`WHITELIST`** (comma-separated names or UUIDs),
  **`OVERRIDE_WHITELIST`** which regenerates on every start and so destroys hand edits, and
  **`WHITELIST_FILE`**.
- RCON: **`ENABLE_RCON`** defaults to **true**; **`RCON_PASSWORD`** is randomly generated and the
  docs say it must be changed; **`RCON_PORT`** 25575; **`BROADCAST_RCON_TO_OPS`**.
- Idling: **`ENABLE_AUTOPAUSE`** and **`ENABLE_AUTOSTOP`** are explicitly **incompatible with each
  other**, so a GUI must make them mutually exclusive rather than let both be ticked.
- **`UID`** and **`GID`** default to 1000, so the container is not root.
- Plugins and mods: **`MODS`** / **`PLUGINS`** and **`MODS_FILE`** / **`PLUGINS_FILE`** accept URLs,
  container paths, or a directory. **They do not resolve dependencies.** Removing an entry from the
  list **deletes that jar** from the directory — a destructive side effect of an edit that looks like
  a list change, so it belongs behind a confirmation.
- **`SPIGET_RESOURCES`** takes comma-separated SpigotMC resource IDs.

**The variables page carries its own disclaimer** that it is manually maintained and may be out of
date. So the GUI must not hard-code this surface as truth: treat the flavour and option list as data
that can be refreshed, and let an unknown value pass through rather than be rejected by a stale
allowlist.

## 3. What is still unknown

Recorded rather than guessed, because each one changes a decision:

- **The EULA gate.** Whether an app may write `eula=true` for the user or must make the human accept
  it. Unresolved, and it is the difference between one-click create and a required consent step.
- **The full `TYPE` enumeration** (Paper, Purpur, Fabric, Forge, NeoForge, Quilt, Bukkit, Spigot,
  Bedrock, modpack platforms). The docs split these across pages that could not be read in one pass.
  Given the staleness disclaimer above, the honest design reads the list as data anyway.
- **Dependency resolution** — whether Modrinth version metadata is rich enough to resolve a graph
  automatically or only to warn. `MODS` and `PLUGINS` definitively do not resolve.
- **Hot-reload limits** — which config changes take effect without a restart and which *silently* do
  not. This is the commonest source of "I changed it and nothing happened", and getting it wrong
  teaches the user to distrust the GUI.
- **Observability** — reading TPS and MSPT, entity and chunk counts natively versus needing `spark`.
- **Backup safety** — whether a hot copy is restorable or requires `save-off` then `save-all`.

## 4. Why this document exists

Four attempts to research this with an agent fleet returned nothing: each died with
`API Error: 529 Overloaded` at its scope agent, so each reported a scope failure rather than partial
findings. Everything above was gathered directly instead. Worth recording, because the next person
will be tempted to re-run the fleet and conclude the topic is hard, when the topic is fine and the
dispatcher was busy.

## Sources

- <https://docker-minecraft-server.readthedocs.io/en/latest/variables/>
- <https://docker-minecraft-server.readthedocs.io/en/latest/mods-and-plugins/>
- <https://docker-minecraft-server.readthedocs.io/en/latest/mods-and-plugins/spiget/>
- <https://docs.modrinth.com/api/>
