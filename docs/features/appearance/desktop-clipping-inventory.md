# Desktop layout safety inventory

This inventory records the source-driven clipping sweep for the Windows desktop renderer at
commit `3b7a846902bd762cf50a61c36a795af3a0f032ba`. It covers application surfaces that can grow
with localized copy, user-renamed values, dynamic collections, or long-running progress. The
Sweep changed only renderer layout behavior. The landing page remains outside this inventory.

## Implemented in this lane

| Surface | Concrete risk | Repair | Verification still required |
| --- | --- | --- | --- |
| Context menus with flat or filterable collections | A menu without the opt-in scroll class could grow past the viewport, leaving its final actions unreachable. | `ContextMenu` now gives every root menu a bounded scroll body. The new layout sheet caps the scrollable menu and keeps each row from shrinking. | Open a long context menu near every viewport edge at 100%, 125%, 150%, and 200% scale. Confirm keyboard traversal reaches the final row. |
| Context-menu flyouts | A long root menu containing a submenu was previously unbounded, while scrolling that root directly would clip its flyout. | The root menu scrolls, and the open flyout is portaled to `document.body`, positioned from its trigger rectangle, and bounded independently. The long-root-with-submenu case is covered by `src/renderer/components/ContextMenu.viewport.test.tsx`. | Open a long profile or account flyout from rows near all four edges. Confirm the root tail, parent anchor, and last child remain reachable. |
| Anchored regex and picker popovers | `AnchoredPopover` forced a 120px minimum height even when fewer than 120px were available beside the anchor, so a popover could escape the viewport. | Available height is now calculated from the larger side of the anchor and clamped to the actual viewport space. The inner region scrolls instead of exceeding that bound. | Drive anchored builders from controls at the bottom and right edges in narrow and short windows. Confirm the anchor remains visible and focus returns after Escape. |
| Tab, dock, label, branch, and board menus | Several data-driven menus had fixed or content-sized height with no shared viewport cap. | The layout sheet adds a shared max-height, internal vertical scrolling, horizontal clamping, and overscroll containment for these menus and their list children. | Exercise long lists, disabled rows, and dynamic additions at narrow widths. |
| Full-screen dialogs and modal surfaces | Centered flex alignment combined with overflow could place a taller-than-viewport child at a negative top, hiding its heading and actions. | Overlay catchers align from the padded top. Auto vertical margins keep ordinary cards centered, but resolve to zero for oversized cards. The taller-than-viewport geometry case is covered by `src/renderer/components/ContextMenu.viewport.test.tsx`. | Open long error, preview, publish, history, destructive-confirmation, and issue content in a short window. |
| Command palette | Palette labels used one-line ellipsis, hiding long feature names and bilingual labels. | Palette labels wrap at safe word boundaries; hint and secondary columns can shrink without horizontal overflow. | Search for the longest setting and feature labels in bilingual mode and at high display scale. |
| Project switcher and theme picker | Names were one-line ellipsized and the switcher width was not explicitly clamped to the viewport. | Rows grow to fit wrapped names, and switcher, FAB, and theme menus clamp to the available width. | Use long project and theme names at a narrow window. Confirm active and disabled rows remain fully legible. |
| Settings rows and settings surface | A fixed sidebar and side-by-side row controls could force content outside a narrow settings window. | Settings switch to a stacked surface below 720px, row bodies and controls become shrinkable, and controls remain keyboard-focusable. | Open every settings section below 720px and at 200% scale. Confirm the search and close controls remain reachable. |
| Appearance editor | Fixed row labels and one-line headings could squeeze controls or hide the edited element name. | The editor gains a narrow stacked row layout, wrapped target names and preview text, and horizontally scrollable tabs. | Open the editor for a long target and inspect every property group at narrow widths. |
| Onboarding | The two-pane card had a fixed minimum height and could lose its action row on a short window. | Short and narrow windows use a stacked card with a scrollable outer surface and no fixed minimum height. | Walk every onboarding step in a short window, keyboard-only, and with reduced motion. |
| Documentation browser | Long code and tables could widen the article beyond the available content column. | Article content wraps ordinary prose and keeps preformatted code and tables in bounded horizontal scroll containers. | Open the longest article, code sample, and table at narrow widths. |
| Responsive top app bar | The project switcher, search, notification, and utility actions compete for one row below laptop widths, while duplicated alternate controls can steal focus. | `TopAppBar` measures its rendered width and mounts exactly one wide or compact branch. Compact mode keeps project, command palette, notifications, and an anchored searchable More menu; narrow mode switches project and More controls to icon-first presentation below 720 CSS pixels. | Capture 1280, 1279, 720, and 719 CSS-pixel bars in the built desktop app. Confirm the same control instance remains focused across resize and that More search and regex focus return to the trigger. |
| Sessions context row | The context state pill shared the title line, so a long bilingual unavailable value could overlap the project or cwd metadata. | `SessionRow` renders agent context in a dedicated contained row. Its meter and pill may grow within that row, while the title and cwd remain independently shrinkable. | Open long agent names and unavailable context in bilingual mode at narrow width and 200% scale. Confirm the complete status is readable and the cwd stays visible. |
| Node Catalog dialog | The dialog's flex children could shrink together, compressing profiles and rows when many entries or bilingual descriptions were present. | Fixed sections are non-shrinking, profiles have their own bounded scroll region, and the result list is the sole flexible height consumer. Rows keep intrinsic height and the dialog owns overflow. | Open all 73 entries with profiles at 100%, 125%, 150%, and 200% display scale. Confirm the first and last result, documentation actions, and keyboard hint remain reachable. |

## Contract checklist

- [x] Overlay surfaces paint their own background and remain above their scrims.
- [x] Long content has an internal scroll region instead of being silently clipped.
- [x] Root menus scroll independently from portaled submenu flyouts, so neither tail is deleted.
- [x] Viewport width and height are used for dialogs, menus, and anchored popovers.
- [x] Oversized centered overlays start at the padded top; ordinary-sized cards remain centered.
- [x] Anchored surfaces preserve a visible originating control where geometry permits.
- [x] Long user and localized values wrap rather than relying on one-line truncation.
- [x] Settings, menus, dialogs, and onboarding retain visible keyboard focus.
- [x] Reduced-motion mode removes transition changes introduced by this sheet.
- [ ] Built-artifact captures at narrow/high-scale tuples remain required from the parent integration lane.
- [ ] The cheap headless route must verify the same tuples against the packaged desktop artifact.

## Deliberate boundaries

The Source Control and WSL creator surfaces are owned by another lane, and the worktree picker is
owned by another lane. Their layout files were not edited here. The Material Design 3 audit owns
component-conformance changes, so this lane only added viewport, overflow, wrapping, and focus
behavior around existing renderer components.
