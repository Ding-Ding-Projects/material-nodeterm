# Service nodes (manager placeholders)

Status: **implemented as canvas objects; not yet connected to anything.** This is the honest
midpoint between "planned" and "working": the node exists, drags and resizes and persists like
any other node, and it stores where it would reach a service — but nothing dials that address yet.
Read this document alongside the "what does not work yet" section below before assuming a control
does more than it says.

## The seven kinds, and why one is called a manager and not a host

Seven service node kinds join the canvas's `NodeKind` union
(`src/shared/types.ts` `SERVICE_NODE_KINDS`): `minecraft`, `dockerhost`, `proxmox`, `gitlab`,
`homeassistant`, `freepbx`, and `nextcloud-aio`. Each shares the same service-node shell,
`src/renderer/nodes/ServiceNode.tsx` — one component with six callers, because the only thing that
varies between them is a label and a starting size, and this codebase's most repeated lesson is
that a duplicated rule drifts from its copies.

Every one of the six is a **manager for something that already exists elsewhere**, not a thing this
node hosts. That is deliberate and it is worth stating for Proxmox specifically, because it is the
kind most likely to be misread: **Proxmox is a bare-metal hypervisor distribution.** You install it
directly onto a physical machine's disk — it does not run inside Docker, and there is nothing for a
canvas right-click to spin up. A Proxmox node's whole job, once it does something, is to be a
window onto an installation that is already running somewhere. The same framing holds for the rest
of the family in softer form: a `dockerhost` node manages a Docker daemon that is already running on
some machine, a `gitlab` node manages a GitLab instance, `homeassistant` discovers a running Home
Assistant, and `freepbx` manages a running FreePBX box. `nextcloud-aio` manages a pinned official
Nextcloud AIO master container through an explicitly disclosed Docker socket, without privileged
mode. `minecraft` is the closest thing to an
exception — a Minecraft server is realistically something *this* app would help stand up in Docker —
but the node itself, as shipped, is exactly as inert as its five siblings; see
[`minecraft-server.md`](minecraft-server.md) for the researched design of the part that would
actually create one.

None of the original six kinds appear in `docs/features/integrations/README.md`'s old "planned, not yet
researched" list by accident of naming — they are the same six products that list already named.
What changed is that the canvas object for each now exists; the research and the real client work
for most of them has not started.

## Creating one

Right-click empty canvas → **Managers** → **New manager…** opens a submenu listing all six kinds by
their human-readable label (`SERVICE_NODE_LABELS`, e.g. "Docker host", "Home Assistant"). Picking
one calls `addService(kind, at)` in `src/renderer/canvas/Canvas.tsx`, which is the one handler for
every kind — the kind is data, not six copies of the same three lines. The **Managers** group is
folded into a single submenu row deliberately: six product names spliced directly into the pane
menu would have been exactly the clutter the menu's own search filter exists to avoid, and the
submenu still matches on its children's labels, so typing "prox" into the pane-menu filter reaches
Proxmox from the top level anyway (see the sectioned/filterable pane-menu behavior in the root
`CLAUDE.md`).

There is currently no other creation path — no command-palette entry, no dock button — only the
pane context menu.

### What you get, and its starting size

`createServiceNode(kind, index, center?)` (`src/renderer/state/workspace.ts`) mints the node:

- `id`: `<kind>-…` (e.g. `proxmox-a1b2-1`). This prefix is load-bearing, not cosmetic —
  `core/project-node-append.ts`'s `SAFE_NODE_ID` matches only `/^term-…/` to decide whether an
  incoming id may register as a real terminal session over the relay/mobile-append path. A service
  node's id can never pass that test, so a peer or the mobile companion cannot be tricked into
  treating a manager placeholder as a shell.
- `type`: the kind itself (`'proxmox'`, `'dockerhost'`, …), which is what routes it to
  `ServiceNode.tsx` in React Flow's node-type table.
- `data.title`: the kind's fixed product label (`SERVICE_NODE_LABELS[kind]`), shown as a small
  caption in the header — this is the product name, not the user's own name for the node (see
  "Label" below).
- `data.color`: the next palette swatch, same as every other new node.
- `data.serviceLabel`: `''` — empty until the user names it.
- **Starting size is per-kind, not the terminal fallback.** `minecraft`, `dockerhost` and `proxmox`
  start at 720×520 (`SERVICE_CONSOLE_SIZE` — sized as if something console-shaped will eventually
  live there); `gitlab`, `homeassistant` and `freepbx` start at 520×400
  (`SERVICE_SUMMARY_SIZE` — sized for a smaller status/summary surface). Both are deliberate table
  entries in `NODE_START_SIZE`, not a shared default: that table replaced an old nested-ternary
  chain whose failure mode was silent — a kind nobody added a branch for simply fell through to
  the 640×440 terminal size with nothing failing and nothing noticing. Making the table
  `Record<NodeKind, …>` turns "forgot to size a new kind" into a compile error instead of a quiet
  regression.

From there a service node behaves like any other canvas object: it drags, resizes down to a
320×220 floor (`NodeResizer minWidth={320} minHeight={220}`), collapses to a header strip, takes a
palette colour (including the animated rainbow colour — see below), can be grouped, duplicated and
deleted through the same context-menu and keyboard paths every node shares, and is included in
undo/redo and in the kanban board's session list like any other node. None of that is specific to
this feature; it comes for free from being an ordinary `NodeKind`.

### Colour, including rainbow

Like every node, a service node's header tint and border read `data.color` through
`nodeColorStyle` / `nodeBorderStyle` (`src/renderer/lib/nodeColor.ts`). Those two helpers are also
where the **rainbow** colour lives: `data.color` can hold the sentinel string `'rainbow'`
(`RAINBOW_COLOR`) instead of a real CSS colour, which the two helpers recognise and render as an
animated CSS class (`nt-rainbow` / `nt-rainbow-border`) rather than a static value — a sentinel is
never concatenated with an alpha suffix, because `${'rainbow'}33` is not an invalid CSS value, it
is a silently *ignored* one, and the surface would render with no background and no explanation.
The animation's speed is a single global 1–5 slider in **Settings → Appearance**
(`settings.rainbowSpeed`, default 3), mapped to a hue-rotation duration by
`rainbowDurationSeconds()` — 1 is a slow 24-second drift, 5 is a fast 1.5-second cycle. This is not
service-node-specific: any node's colour swatch can be set to rainbow from the colour picker, and
service nodes simply inherit it because they use the same colour helpers as everything else.

## What persists in the shared file, and what stays on this machine — and why

A service node's persisted record has exactly two fields beyond the ordinary node shape
(`id`, `kind`, `position`, `size`, `title`, `color`, `group`):

| field | where it lives | why |
| --- | --- | --- |
| `serviceLabel` | `.nodeterm/project.json` — the **shared**, git-committed canvas file | It is a display name the user typed for their own node (`"Home server"`, `"Home lab"`), with nothing about a machine or a credential in it. Sharing it is exactly as safe as sharing a terminal node's title. |
| `serviceConnection` (`{ endpoint, credentialKey? }`) | the **machine-local** `workspace.json` index, keyed by node id (`IndexEntryV3.localExec.serviceConnection`) | It names a real address — a host, a port, sometimes an internal-network name — and for some kinds it is *exec-adjacent* (see below). None of that is meaningful, or safe, to hand to everyone who clones the project. |

This split exists because `.nodeterm/project.json` is **hostile input**, not a private settings
file: it is git-shared, hand-editable, auto-adopted the moment someone opens the folder, and — for
an SSH project — it lives on the remote host rather than the local disk. The codebase already
treats a session's `shell` program and its raw SSH `extraArgs` this way (see the file header of
`src/shared/node-exec.ts`), because both can become a command line. `serviceConnection` joins them
for the same reason: a Docker host reached over `ssh://` turns the stored endpoint into the target
of a command the moment something dials it, so a project file that could set it would be a project
file choosing which machine *this* one talks to. Until a real connection lands, that risk is
theoretical — but the boundary is built now, before there is a launch path to protect, rather than
retrofitted after one exists.

The connection record is enforced at every boundary that could otherwise let a value in sideways
(`src/shared/node-exec.ts`):

- **`stripSharedNodeExec`** removes `serviceConnection` (along with `shell`, `terminalProfileId`,
  `pendingLaunch`, and SSH's `extraArgs`/`execTrusted`) from every node before it is written to the
  shared project file — a strip, not a wipe, so everything else about the node (title, colour,
  position, the label) is untouched.
- **`sanitizeInboundNode`** strips the same fields from a node arriving over the wire — a
  canvas-sync peer's mutation, or a relay client's. Without this half, the disk half alone would be
  worthless: a peer mutation is applied to the live node as-is, and the very next local save would
  harvest whatever the peer set into *this* machine's own trusted index, silently re-attaching a
  stranger's endpoint as this machine's own on every future load.
- **`localNodeExec`** — the collector that writes the machine-local index — re-validates the
  connection with `safeServiceConnection` on the way **in**, not just the way out, because the live
  node it reads from can itself have been touched by a peer mutation moments earlier.
- **`applyLocalNodeExec`** re-validates again with `safeServiceConnection` on the way the index is
  read back out at load time, because `workspace.json` is still a file: a hand edit, a partial
  write, or a record left behind by an older build can all reach this point, and a connection that
  would be refused today is not grandfathered in merely because it is already on disk.

### Endpoint rules

`safeServiceEndpoint` (`src/shared/node-exec.ts`) is the single predicate every layer above calls,
including the node's own input field (`ServiceNode.tsx` calls the exact same function the storage
boundary uses, so the form can never accept something the store would then silently refuse). An
endpoint is kept only when **all** of the following hold:

- It parses as a URL, is non-empty, and is no longer than 2048 characters.
- It contains no control characters (checked by a codepoint scan, not a regex — a bare hyphen in an
  ordinary hostname was once nearly rejected by a hand-written character-class that meant to match
  something else entirely; the scan makes that class of mistake impossible).
- Its scheme is `http:`, `https:`, or `ssh:`. Everything else is refused outright — `file:` reads
  local disk, `javascript:` is a script, and a scheme nobody has vetted is a scheme that does
  something nobody predicted.
- **It carries no password.** `https://user:pass@host` is refused unconditionally, on every scheme,
  with no exception. This is the rule the whole predicate exists to enforce: the record is written
  to a plain-text file, so a password embedded in the URL would be a password in `workspace.json`,
  in every backup of that file, and in any screenshot anyone ever takes of it. The node's own field
  explains this in place rather than just rejecting silently — "Remove the password from the
  address… the address itself is stored, the secret is not" — because a user who just pasted a URL
  with credentials in it has been refused *for their own benefit*, and without a reason they will
  reasonably assume the field is broken and go find somewhere worse to put the password.
- **A bare username is judged differently by scheme.** `ssh://docker@192.168.1.10` is accepted with
  its username intact, because `ssh://user@host` is the standard, ordinary way to name a Docker
  host reached over SSH — the username there is the *target*, not a secret, and refusing it would
  reject the single most likely endpoint this feature will ever be handed. The same bare username
  on `http://` or `https://` is refused, because there it is almost never anything but a
  half-pasted credential.
- It has a hostname at all (`https:///path` is refused).

A `credentialKey` may ride alongside the endpoint, but it is explicitly **not** a secret — it is an
opaque string naming an entry in the OS credential vault (matched against
`^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$`), so that a lookup can happen later without the secret itself
ever sitting in the plain-text record. `safeServiceConnection` keeps a whole connection or none:
a record with a malformed key but a valid endpoint keeps the endpoint and drops the key (a bad key
costs a lookup, not the connection), but a record with **no** usable endpoint is dropped entirely —
half a connection would render a node that looks configured and cannot connect, which is a worse
state to be in than an honestly unconfigured one.

The node's own address field commits on blur or Enter, discards an in-progress edit on Escape
(reverting to the last committed value), and is a **draft** until it parses — committing on every
keystroke would either flicker the node through a dozen invalid states while someone is mid-type,
or, worse, write a half-typed value into the machine-local index where a later read would find it,
refuse it, and silently drop the connection the user believed they had already set.

### "Use localhost" (`dockerhost` only)

The `dockerhost` node's address field carries one extra control beside the input: a **Use
localhost** button that fills the field with `ssh://localhost` and commits it through the exact
same `commitEndpoint`/`safeServiceEndpoint` path the input itself uses. It is disabled once the
field already holds that value, and it never becomes a "Connect" button — clicking it changes what
is *typed in the field*, nothing more, matching the honesty rule the rest of this document states.

`ssh://localhost` rather than a platform-specific socket path is a deliberate choice, not an
oversight. Docker's real local transports are a Unix domain socket (`/var/run/docker.sock`) on
macOS/Linux and a named pipe (`//./pipe/docker_engine`) on Windows — but `safeServiceEndpoint`
accepts only `http:`, `https:` and `ssh:` (see "Endpoint rules" above), so neither is a value this
field could ever store. `ssh://localhost` is: bare `ssh://` with no `user@` defaults, on every
platform and every OS the same way the plain `ssh` command does, to whoever is currently logged in
— there is nothing to branch on per platform and nothing to go and ask the OS for.

## What does not work yet

State this plainly, because CLAUDE.md's rule against decorative controls cuts both ways: it forbids
a control that *looks* wired and is not, and it equally forbids a document that implies more than
the control actually does.

- **Nothing dials the address.** The endpoint field validates and stores a URL; no code anywhere in
  this repository opens a connection to it, tests it, or does anything with it beyond keeping it
  around for a future feature to read.
- **There is no console.** `minecraft`, `dockerhost` and `proxmox` are sized as if a console will
  eventually live in their body (`SERVICE_CONSOLE_SIZE`), but the body today holds only the address
  field and two lines of static explanatory text — no terminal, no log tail, no command input.
- **There is no status.** No online/offline indicator, no health check, no version, no resource
  count. A service node cannot currently tell you whether the thing it names is even reachable.
- **There is no credential UI.** `credentialKey` exists in the data model and in the storage/
  validation boundary described above, but no control in `ServiceNode.tsx` sets one; there is
  nowhere yet to pick or create a vault entry from the node itself.
- **There is exactly one creation path** (the pane context menu's Managers submenu) — no
  command-palette entry, no dock button.

The body copy on every node says as much in place — "Talking to a real {product} is not built yet,
so this node stores where it would connect and nothing more. There is deliberately no button here
that looks like it would connect." — so a user reading the node itself gets the same honest answer
this document does.

## Surfaces

- **Desktop** — fully present: the node type, the pane-menu entry, the colour system including
  rainbow, and the endpoint field with its validation all work exactly as described above.
- **Server Edition** — the node kind, factory, colour helpers and the `safeServiceEndpoint`/
  `safeServiceConnection` trust boundary all live in `src/shared` and `src/renderer`, which the
  Server Edition's browser bridge shares with Desktop; nothing in this feature currently reaches
  into `src/main` or `src/core`, so there is no server-specific gap to call out yet. As soon as a
  real connection (dialing Docker, Proxmox's API, and so on) is added, that work will need a
  `CorePlatform`-backed service the Server Edition boots the same way Desktop does — see the
  three-surfaces rule in the root `CLAUDE.md`.
- **Mobile companion** — _nodeterm mobile_ (`nodeterm-ios`) is a separate, private repository, so a
  service node's mobile behaviour is a **follow-up to raise there**, not work done in this
  repository. Today a service node has no transport-level representation at all — the mobile
  companion attaches to tmux sessions over `TerminalTransport`, and a service node has no PTY and
  no tmux session to attach to — so the nearest-term mobile question, once this feature grows a
  real connection, is probably a read-only summary card rather than a live console.
