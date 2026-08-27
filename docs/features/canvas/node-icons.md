# Session icons

Terminal session nodes can carry one user-selected emoji or a local image icon. The mark is shown
consistently in the canvas header, Kanban card, card modal, and sessions sidebar, so a busy canvas
does not rely on colour and title alone.

## Choosing and clearing an icon

Open a terminal node's context menu and choose **Set icon…** or **Change icon…**. The same picker
opens from the icon in a node header and from the icon button in a terminal card modal. It offers a
small curated emoji palette, a field for the first grapheme of any user-entered value, and a local
image picker. **Remove icon** clears the current selection, while **Cancel** leaves it unchanged.
Only terminal nodes expose the action because other node kinds do not render a session icon.

Image bytes are copied into the durable canvas-image location through the existing file API. For a
local project, the stored path is `./`-relative so the image can travel with `.nodeterm/images/`.
An SSH or cwd-less project keeps the copied image in the local application data location and stores
an absolute path, so the icon remains a local presentation choice rather than pretending to be
portable.

## Validation and failure modes

The persisted value is validated when project data becomes live state and again when live state is
serialized. Emoji values are reduced to one grapheme, control characters are removed, and empty
values become no icon. Image paths must have an allowlisted image extension, must be absolute or a
safe `./` path, and may not traverse out of the project. An invalid or unreadable image renders no
icon and leaves the rest of the session usable. A failed copy reports the failure in the picker and
does not replace an existing icon.

Image reads are routed through the owning project session API and cached by project plus resolved
path. This keeps relay and server sessions on their own core and avoids repeatedly reading the same
image for the four session surfaces.

## Surface availability

- Desktop: the picker, persistence, and all four render surfaces are wired.
- Server Edition: the same core and browser file APIs are used; no new IPC channel is required.
- Mobile companion: not available in this version because its transport does not carry a per-node
  icon field. A future protocol update can add that field without changing the desktop file shape.

## Verification status

This source-only lane did not run tests, type checks, lint, builds, packaging, installer execution,
runtime interaction, security or accessibility checks, reviews, or UI captures. Those remain
integration work. The implementation is based on upstream PR #293 and issue #291, adapted to this
project's existing Material Design renderer, session API, and durable canvas-image writer.

Suggested articles: [Canvas and node lifecycle](./canvas-and-lifecycle.md),
[Node kinds](./node-kinds.md), and [Media and gallery nodes](./media-gallery.md).
