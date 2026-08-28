# UniGetUI Global Universe

The UniGetUI Global Universe is one machine-owned destination for the installed-app inventory and
package operations exposed by UniGetUI's public local automation interface. It is independent of
the active project. A project may contain a small portal node, but project files never contain
installed package rows, manager executable paths, operation output, credentials, or IPC session
tokens.

## Destinations

The destination keeps a fixed, searchable set of sections: Overview, Discover, Installed, Updates,
Operations, Managers, Sources, Bundles, Settings, Shortcuts, Logs, Backups, and Help. The selection,
plain-text or regular-expression search state, and the last refresh time are saved to
`unigetui-global-universe.json` under application data. The store is versioned, bounded, and safe to
discard. It does not cache package-manager payloads.

## Automation boundary

The host invokes the official `unigetui` executable with a fixed argument array, `shell: false`, a
hidden process window, bounded output, and deadlines. The CLI discovers UniGetUI's local named-pipe
session and handles its authentication internally. This application never reads, copies, logs, or
persists that authentication value. Direct calls to WinGet, Chocolatey, Scoop, npm, pip, Cargo, or
other package managers are not used.

Read-only sections expose status, search, details, versions, installed items, updates, ignored-update
rules, operations, managers, sources, settings, shortcuts, logs, backups, and bundles. Mutating
operations are typed and explicit: install, download, update, reinstall, uninstall, repair, update
all, manager update, ignored-rule add/remove, source changes, bundle changes, manager enable/disable/
reload/maintenance/executable override/notification controls, and operation cancel, retry, reorder,
wait, and forget. Elevation is passed only when the user explicitly selected it. The host never
retries a non-elevated operation silently with elevation. Bundle imports require a local file pick,
so raw package content is never placed in a process argument.

The panel also provides native folder browsing for install locations, manager executable selection
and clearing, notification toggles, source creation and removal, bundle add and remove, cloud backup
list/create/download/restore, and the official backup device-flow start/complete/logout commands.
Actions that remove or reset data use the application's existing destructive confirmation surface.

## Honest states and privacy

The surface distinguishes not-installed, stopped, unavailable, malformed response, elevation
required, and operation-failed states. A missing executable is not reported as an empty package
list. A malformed JSON response is retained as an error state, not converted into a successful
empty result. Response fields are bounded and credential-shaped fields are removed before data can
reach the renderer.

Server Edition runs the same core against the server host's local UniGetUI session. Relay and mobile
surfaces do not reinterpret this machine-global state, and a relay connection receives an explicit
unsupported response rather than a view of the viewing machine's package inventory. A headless
UniGetUI session can report status and operations, while UI-only navigation reports its documented
unavailable reason.

## Verification boundary for issue #212

This accelerated implementation lane intentionally runs no tests, type checks, lint, reviews,
security or accessibility audits, runtime interaction, or screenshots. The coordinating owner must
run the supported build and Squirrel.Windows packaging paths against the exact candidate commit and
then perform the broader verification required by the project policy.

## Related articles

- [Ollama suite manager](../ollama-manager.md)
- [File converter](../file-converter.md)
- [Node Catalog](../canvas/node-catalog.md)
