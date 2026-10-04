# Markdown link navigation guard

A link inside rendered markdown never navigates the application window. Agents write relative
links constantly (`[pty-manager.ts](src/core/pty-manager.ts:4100)`), and the shared markdown
renderer keeps an anchor's `href` exactly as written. Before this guard, a click resolved that
`href` against the application document: on the desktop it became another `file://` path, the old
navigation check allowed every `file://` URL, and the main window replaced the whole canvas with a
missing file until a reload. In the Server Edition any link click navigated the browser tab away
from the application.

## Behavior

Two layers apply, and each one is enough on its own for the surface it covers.

**Renderer, every surface.** One delegated document-level listener is installed at boot
(`src/renderer/lib/markdownLinks.ts`, wired in `src/renderer/boot.tsx`). It acts only on anchors
inside a rendered-markdown container and decides on the raw `href` attribute, never on the resolved
URL:

| Raw `href` | Result |
| --- | --- |
| `http:`, `https:`, `mailto:` (absolute) | Opened outside the application: the system browser on the desktop, a new browser tab in the Server Edition. |
| Empty or a `#fragment` | Swallowed; nothing happens. |
| Anything else: relative paths, `/absolute/paths`, `//host/path`, `file:`, `vscode:`, `javascript:` | Swallowed, and an error notice says local file links cannot be opened from rendered markdown. |

A primary click and a middle click (`auxclick`, which a browser would otherwise turn into a new tab)
get the same decision. Modifier clicks are handled the same way. A right click is left to the
context menu, and a click that a closer handler already cancelled is left alone.

Local links deliberately do not open a file. Resolving one needs the owning node's working
directory and its filesystem dialect (local, Server Edition host, SSH or relay), which a
document-level handler cannot see; a wrong guess would open the wrong file on the wrong machine.

The containers are listed in `RENDERED_MARKDOWN_CONTAINERS`:

| Container | Surface |
| --- | --- |
| `.term-md__content` | Terminal markdown view and the editor's Markdown preview |
| `.term-chat__text` | Transcript chat bubbles |
| `.sticky-node__md` | Sticky notes on the canvas and in the kanban card modal |
| `.md3-changelog-item__text` | Release notes in the changelog |
| `.github-work-item-node__description` | A GitHub issue or pull request body on its canvas node |
| `.github-work-item-detail-dialog__body` | The same body in its detail dialog |
| `.md3-docs-article__body` | The offline documentation browser, which already resolves and cancels its own link clicks; listed as a backstop |

**Main process, desktop backstop.** `decideMainFrameNavigation` (`src/main/navigation-guard.ts`)
allows a main-frame navigation only back to the entry document itself, compared on scheme, host
and decoded path with hash and query ignored, so a reload and development hot reload keep working.
A safe external scheme goes to the operating system; everything else, including any other
`file://` path and any other development-server path, is blocked. The main window applies it
through `will-navigate`. The canvas widget window loads the same renderer entry with a `?widget=`
query and renders the same markdown surfaces, so it applies the same policy through
`guardMainFrameNavigation`, which also denies every new window request and hands only a safe
external URL to the operating system. Before this change the widget window had no navigation
guard at all.

## Configuration

There is nothing to configure. The guard is always on. The local-link notice follows the
language mode, both playfulness levels, School mode and the personal vocabulary at the moment of
the click (`localizedTextNow`, catalogue row `markdownLinks.localLink`).

## Surfaces

- **Windows desktop:** both layers. The notice appears in the canvas window's error banner.
- **Server Edition:** the renderer layer is the only line, because nothing sits above a browser
  page. Web links open in a new tab with `noopener`; local links are swallowed with the notice.
- **Mobile companion:** not applicable. It renders no markdown surface from this renderer.

No new IPC channel or bridge member was added, so the relay method allowlist is unchanged.

## Failure modes

- A bridge whose `openExternal` returns a rejected promise or throws synchronously cannot surface
  an unhandled rejection: `openExternalQuietly` adopts the result with `Promise.resolve` and
  swallows a throw. The link simply does not open.
- In the canvas widget window there is no error banner, so a local link is swallowed silently.
- On a case-sensitive Linux filesystem, a deliberately mis-cased link to the entry `index.html`
  is allowed by the case-insensitive `file:` comparison (which exists so a drive-letter spelling
  difference cannot block a reload) and shows a missing page until reload.

## Security considerations

- The decision is made on the raw attribute, so resolution against the application document can
  never turn a relative path into a navigation, and a protocol-relative `//host` URL is never
  treated as a web link.
- Only `http:`, `https:` and `mailto:` ever reach the operating system or a new tab. `file:`,
  `smb:`, `javascript:` and custom protocol handlers are refused by both layers, and
  `isSafeExternalUrl` is the one definition shared by `will-navigate`, the window-open handler and
  the `shellOpenExternal` IPC handler.
- Markdown HTML is still sanitized by DOMPurify in `src/renderer/lib/markdown.ts`; this guard
  covers what sanitizing does not, which is where a kept `href` goes when clicked.
- A new markdown surface must render inside a listed container. The contract test inspects every
  `dangerouslySetInnerHTML` in `src/renderer` and fails when the same element does not carry a
  listed class, so an unguarded surface cannot be added silently.

## Verification

- `src/renderer/lib/markdownLinks.test.ts` proves a click on a relative link inside rendered
  markdown is cancelled and only raises the notice, a web link in every container goes to
  `openExternal`, fragments are swallowed, middle clicks are guarded, anchors outside the
  containers are untouched, the guard uninstalls cleanly, the per-sink contract holds for all seven
  containers, and `openExternalQuietly` never leaks a rejection.
- `src/main/navigation-guard.test.ts` proves the entry document is allowed with hash and query
  ignored, other `file://` and development-server paths are blocked, safe schemes go out, and
  `guardMainFrameNavigation` cancels the exact URL a relative markdown link resolves to without
  opening anything.
- `src/renderer/lib/i18n.now.test.ts` proves the notice resolves the live language and level,
  fails closed under unknown School mode, and applies the personal vocabulary only when allowed.
- Mutation checks: removing a container from the list turns the per-sink contract red; making
  `guardMainFrameNavigation` allow every URL turns the relative-link test red.
- Not verified here: a click in the packaged desktop build and in a live Server Edition browser.

## Suggested articles

- [Markdown preview on open](./markdown-preview.md)
- [In-app documentation browser](../help/in-app-documentation.md)
- [Upstream sync and the port ledger](../development/upstream-sync.md)
