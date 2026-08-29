# Per-session icons

Each canvas session can carry a small identity mark beside its title. The picker accepts either a
short emoji or a local PNG, JPEG, or WebP picture. Pictures are read in the renderer only, decoded
before applying, and bounded to 400 KB and 512 by 512 pixels. Animated images, remote URLs, SVG,
unknown MIME types, malformed data, and oversized files are rejected without replacing the prior
mark. No image upload, URL fetch, analytics event, or network request is part of this feature.

The value is persisted with the session's shared canvas presentation and is passed through the
same hostile-input boundary as the rest of `.nodeterm/project.json`. A malformed or too-large
hand-edited value is omitted rather than rendered. Resetting returns to the existing colour mark.
The same mark appears in the canvas node header, the sessions sidebar, and the Kanban session card;
the text title remains the accessible name and the picture receives descriptive alternative text.

## Use and accessibility

Right-click a session and choose **Choose session icon…**. The dialog has a labelled emoji field,
a semantic local file picker, a preview, precise size/type limits, and **Reset to colour**. The
emoji route is keyboard-operable with Enter, errors are announced, and the image route reports
decode and validation failures in place. Icons are decorative when a title already labels the row,
while picture alternatives remain available to assistive technology in the picker and standalone
rendering.

## Failure and privacy boundaries

The feature intentionally has no remote-image or account-avatar route. A local picture is retained
as a bounded data URL only because the session presentation must survive a reload and travel with
the canvas. It is never interpreted as executable markup, used as a CSS URL, or accepted from a
network location. If processing fails, the prior valid icon remains active.

Suggested articles: [Node kinds](../canvas/node-kinds.md), [Session continuity](./session-continuity.md),
and [Projects and tabs](../projects/projects-and-tabs.md).
