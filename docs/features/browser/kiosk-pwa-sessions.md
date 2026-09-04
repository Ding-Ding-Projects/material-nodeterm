# Kiosk and PWA sessions

Kiosk sessions are canvas nodes for keeping one web application open in a focused, bounded
surface. They are intended for installable progressive web applications, dashboards, and other
web destinations that benefit from a dedicated session without mixing their cookies or site data
with ordinary browser nodes.

## Behaviour

Choose **New Kiosk or PWA session** from the canvas menu or the command palette. The node starts at
its safe start page and accepts only absolute `http` and `https` URLs without embedded usernames or
passwords. Navigation is kept in the node and can be switched between bounded and full-screen
presentation. Full-screen mode uses the platform Fullscreen API, keeps an explicit **Exit
full-screen** control in the node chrome, and also honours Escape and the platform's own exit route.

The node looks for a page-declared web app manifest after each document becomes ready. A bounded,
sanitized summary shows the manifest name, start URL, display mode, and first usable icon URL when
available. A missing, oversized, malformed, or unreachable manifest is reported as unavailable;
the page remains usable as a normal kiosk session. No guessed install button is shown.

The **Rebind** action creates a fresh isolated profile for this node and says that any sign-in must
be performed again. Closing a node removes only its view. A failed navigation, rejected full-screen
request, or unavailable manifest leaves the existing page and profile untouched and exposes a
nearby recovery or dismiss action.

## Portable and machine-local state

The shared `.nodeterm/project.json` projection carries the node kind, safe URL, title, bounded or
full-screen preference, optional profile label, and sanitized manifest summary. It never carries a
partition identifier, cookie, service worker, local storage, cache, browser profile directory,
process identifier, proxy setting, credential, or provider session. The renderer keeps an opaque
profile key in machine-local browser storage and derives a persistent Electron partition from the
project and node identity. A project opened on another computer therefore gets a new isolated
profile and a visible rebind path instead of silently borrowing another browser identity.

Import is declarative: loading a project does not navigate, install, download, deploy, or reconnect
anything. The first page load happens only when the user opens the node. Manifest inspection runs in
the already-open guest and uses a bounded response with redirects and embedded credentials refused.

## Accessibility and appearance

The node uses the same Material Design 3 tokens, focus rings, resizer and webview chrome as other
canvas nodes. The mode, Rebind, exit, recovery, and close actions are real keyboard-focusable
controls with accessible labels and visible status text. The bounded node has a 420 by 280 minimum
surface and the full-screen state uses the viewport without clipping the controls. Reduced motion
removes transition work. The page itself remains the page's own content and is not granted access
to the host application or its local profile data.

## Surfaces

| Surface | Availability |
| --- | --- |
| Desktop | Full Kiosk node with an isolated Electron partition and platform full-screen control. |
| Server Edition | The node type and portable fields are shared, but browser profile isolation is owned by the browser session hosting the Server Edition. |
| Mobile companion | Not implemented in this lane. The companion can preserve the portable declaration only after its protocol gains a Kiosk node representation. |

## Verification

The implementation is in `src/renderer/nodes/KioskNode.tsx`, `src/shared/kiosk-sessions.ts`, and
the workspace/projection tables in `src/renderer/state/workspace.ts` and
`src/core/portable-canvas-projection.ts`. Built-artifact interaction, package production, and UI
capture are intentionally pending for the ultra-speed lane. They must verify separate partitions,
safe URL refusal, manifest discovery and bounds, full-screen entry and Escape exit, Rebind, import
without external side effects, narrow layouts, and profile reset before this roadmap item is ticked.

## Suggested articles

- [Browser node tabs](./browser-tabs.md) — shared browser tabs and profile partitions.
- [Extensions and WebAuthn](./extensions-and-webauthn.md) — the limits of the embedded browser session.
- [Canvas and lifecycle](../canvas/canvas-and-lifecycle.md) — node persistence and deletion behaviour.
- [Portable canvas projection](../projects/portable-canvas-projection.md) — safe project intent and local bindings.
