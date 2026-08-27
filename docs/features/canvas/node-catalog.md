# Unified Node Catalog

The Unified Node Catalog is the single guided creation surface for canvas nodes. The FAB, the
empty-canvas context menu, and the command palette all open the same registry and creation
coordinator. Existing keyboard shortcuts, file drops, and paste gestures remain fast paths, but
their resulting node intents use the same typed factory contract.

`src/shared/node-catalog.ts` is the canonical registry for this program and its follow-on lanes.
Lane 6 must import this registry and extend it with its universe scope adapters, rather than
creating a second catalog with overlapping ids. A registry id is stable across lanes and is the
identity used for documentation, availability, and creation-event routing.

## Behaviour

Each registry entry has a stable id, node kind, category, keywords, documentation path, dependency
ids, and safe defaults. The catalog currently groups terminals, agents, canvas objects, files,
media, managers, automation, and tools. Rows that cannot be created in the current session stay
visible and explain the exact missing capability and the next action. An editor or diff row, for
example, waits for a project file picker instead of accepting an arbitrary path.

The registry also carries explicit disabled blueprint rows for planned Home Assistant sensor,
Calendar, Planner,
Multiverse, AWS Universe, AWS service, Cloudflare hosting, Nextcloud hosting, and Open WebUI
hosting nodes. GitLab hosting is available as a guided private Server node with a pinned official
image and local Configure and Deploy flow. A planned row is never mistaken for an available feature. Remote terminal
creation remains disabled until the dedicated saved-connection picker supplies a concrete binding.
Alarm Clock is active and creates the same paused, timezone-aware node used by the canvas add menu.
Wild dim sum is also active: it creates a guided public-catalog node whose live network state stays
outside schema 3 while the validated selected dish remains portable.

Selecting a row creates one immutable `creationEventId`. Retries carrying that id are idempotent and
return the existing node rather than creating a second node. The coordinator searches a deterministic
square spiral when the requested rectangle overlaps an existing node, so rapid clicks and restored
layouts do not stack new nodes on top of one another. A group context keeps the captured cursor and
parents the created node into that group.

The same append boundary stamps fresh ids for keyboard shortcuts, profile-aware terminals, remote
and Explorer drops, image paste, board creation, source-control diff nodes, account-login nodes,
automation commands, and peer-created nodes. Import and undo/redo are explicit exceptions: they
restore an existing persisted identity and therefore do not mint a new user creation event.

## Configuration and portability

Safe defaults such as an empty note, a paused schedule, or a blank browser URL are portable project
intent. Credentials, account sessions, process state, host identifiers, and absolute machine paths
are never stored in the registry or its defaults. Local bindings are resolved only when the user
chooses the relevant configure, rebind, adopt, or locate action.

The immutable event id is persisted with the node in `CanvasNodeState.creationEventId`. Hydrating a
project remembers existing ids and never emits a new creation event. The field is presentation and
intent metadata only, not a credential or a runtime handle.

## Interaction and accessibility

The picker is a Material Design 3 dialog with a bounded, keyboard-navigable listbox, category chips,
result counts, visible focus, disabled-state explanations, and a documentation link on each row.
Plain text search is the default. The `.*` affordance is anchored beside the catalog search field
and opens the full regex builder for guided literals, classes, groups, alternation, quantifiers,
flags, sample text, matches, and capture groups. Up and Down move the active row, Enter creates it,
Escape clears the query before closing, and focus returns to the FAB or context-menu origin.

The dialog follows the active English, playful Cantonese, or bilingual mode and the independent
funny-level controls. Node names, dependency ids, paths, and capability facts remain exact while
surrounding copy changes tone. The layout scrolls internally at narrow widths and retains a usable
touch target at high display scales.

## Failure modes and security

An unavailable session, missing project folder, absent remote binding, or unselected file is a
disabled catalog row with a reason, never an empty list and never a guessed fallback. A failed
factory returns no node and leaves the canvas unchanged. A duplicate event is a no-op. Placement
search is bounded and falls back to a deterministic offset if every candidate is occupied.

The bounded placement search now refuses when all candidates are occupied, leaves the canvas
unchanged, and raises a visible notification naming the placement failure. It never publishes an
overlapping fallback. Group placement compares only nodes in the same parent coordinate space.

The hand-written `NODE_CATALOG_COMPLETENESS` inventory covers every current registry row, the two
render-only card exceptions, and every planned family. Its negative cases are exact: removing a
current or planned row reports `missing catalog id`, duplicating an id reports `duplicate catalog
id`, and adding an unlisted row reports `unscoped catalog id`. Scope mismatch and planned rows that
become enabled are also red cases. These are registry data checks, not discovery-only assertions.

The registry contains no shell text, network request editor, credentials, secret-derived value, or
machine path. Kind-specific factories add local execution details at the trusted boundary. Import
of a portable project only hydrates safe data and does not launch a process or call a provider.

## Verification

Focused verification belongs to the release lane. The implementation exposes pure catalog lookup,
availability, search, event stamping, idempotence, and collision-free placement seams for focused
checks. The ultra-speed implementation pass intentionally did not run tests, type checks, lint,
security checks, accessibility checks, builds, packaging, installer execution, runtime interaction,
or UI captures. Build and packaging evidence therefore proves artifact production only.

## Suggested articles

- [Node kinds](./node-kinds.md)
- [Canvas and node lifecycle](./canvas-and-lifecycle.md)
- [Portable canvas projection](../projects/portable-canvas-projection.md)
- [Command palette](../../command-palette.md)
