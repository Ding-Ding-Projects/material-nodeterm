# Browser Portal

The Browser Portal is a canvas node for opening a trusted HTTP or HTTPS destination in a dedicated
local browser session. It is intentionally distinct from the ordinary Browser node: every portal
gets a `persist:browser-portal-*` partition derived from the project, node, and local profile id.
It never falls back to the application's default browser session or to an ordinary project browser
profile.

## Behaviour

Create a portal from the empty-canvas context menu or the command palette with **New Browser Portal**.
The node starts at a guided setup state. A preset picker offers Blank portal, Local dashboard, and
Documentation. A user can then enter an HTTP(S) URL and activate **Open**. The URL is parsed again
at the navigation boundary, must have an `http:` or `https:` scheme and a hostname, and cannot
contain embedded username or password data or control characters. Invalid input leaves the current
page alone and explains the required format beside the field.

Popups are disabled for this node. The active webview is registered and unregistered with the main
process as it becomes ready and is released, so a closed or hidden portal cannot retain an orphaned
guest process. The lifecycle line reports idle, loading, ready, suspended, or error. Hiding a portal
uses the existing memory-saver path and restores the last successfully loaded URL.

## Profiles and portability

Portal profile names and the node-to-profile assignment live in the local browser storage record
`nodeterm.browser-portal-profiles.v1`. This record contains no cookies, passwords, tokens, or page
content. The webview partition is the local credential boundary: Chromium stores its site data in the
partition owned by this computer and this portal node.

The project file carries only safe intent: node identity, layout, title, color, preset id, and the
validated URL. The portable schema 3 projection carries the same safe portal fields. It never carries
profile metadata, cookies, local storage, credentials, process ids, host paths, or generated runtime
data. Opening an imported project does not launch a process, fetch a destination, or deploy anything.
The portal remains at its guided setup state until the user chooses a preset or explicitly opens a
validated URL on the destination computer.

## Failure modes and recovery

- A malformed, credential-bearing, non-HTTP(S), or control-bearing URL is rejected before it reaches
  the webview. The last valid page remains active.
- A failed page load is shown as an error lifecycle state with a recovery action to correct or
  replace the URL. It is not reported as a blank successful page.
- A local storage refusal leaves the current in-memory profile active and keeps the session isolated;
  profile metadata may need to be selected again after a restart.
- A hidden portal is suspended and later restored from its saved URL. The browser process is not kept
  alive merely because the node is off-screen.
- Portal popups have no automatic canvas-node route. This prevents an unbounded popup tree and keeps
  lifecycle ownership with the portal that created the page.

## Security considerations

Portal navigation accepts only HTTP(S), with no credentials embedded in the URL. It does not expose
arbitrary shell commands, a raw debugging target, or credential scraping. The existing browser guest
registry receives only the webview id and owning node identity, and the portal's `allowpopups` value
is false. Local profile metadata is bounded and normalized before storage. Project and portable
serialization do not read the local profile record.

## Surfaces

- **Desktop:** the full Browser Portal node and Electron persistent session partition are available.
- **Server Edition:** the shared renderer can display the node's safe metadata, while its browser
  runtime uses its own local browser storage and does not receive Electron profile credentials.
- **Mobile companion:** no portal runtime is shipped in the mobile companion. The node remains safe
  project metadata and should be presented as unbound until a compatible client is added.

## Verification status

The implementation is present in `src/shared/browser-portal.ts`,
`src/renderer/state/browserPortalProfiles.ts`, `src/renderer/nodes/BrowserPortalNode.tsx`, and the
shared BrowserSurface lifecycle options. This lane was delivered in the ultra-speed mode, so tests,
type checks, builds, packaging, runtime interaction checks, accessibility checks, security checks,
and UI captures were intentionally not run here. Those checks remain required before a release
claims the feature is verified.

## Suggested articles

- [Browser node tabs](./browser-tabs.md)
- [Canvas and lifecycle](../canvas/canvas-and-lifecycle.md)
- [Projects and persistence](../projects/README.md)
- [Portable project archives](../../plans/2026-08-26-portable-node-universes-and-hosting-program.md)

