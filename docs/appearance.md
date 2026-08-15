# Appearance editor

A non-modal, anchored editor that can re-typeset a tab, a node title, or a piece of app chrome —
font, colour, decoration, spacing, alignment — without touching the app's own source. This
document covers behaviour, configuration, failure modes, security considerations and
verification. See also [`docs/colour-picker.md`](./colour-picker.md) for the colour control it
uses throughout.

## Opening it

- **Tabs** (`TabBar.tsx`): right-click a tab for the normal tab-management menu, which now
  includes **Edit tab appearance…**. **Shift+right-click** a tab opens the editor directly,
  anchored to that tab.
- **Nodes**: right-click a terminal/agent node (or a single-node selection) → **Edit
  appearance…** in the context menu. It targets the node's title text.
- **App chrome**: Settings → Appearance → *Appearance editor* lists fixed targets that don't have
  a natural place to right-click — the tab bar's brand name, right-click menus themselves, the
  Settings dialog, the command palette, and the appearance editor's own dialog. Each has an
  **Edit…** button that opens the same editor, anchored to that settings row.

The editor is **non-modal**: nothing else on the page is blocked while it's open. Clicking
outside it, or pressing Escape while it has focus, closes it and returns keyboard focus to
whatever element opened it.

## What can be edited

Four tabs inside the editor:

- **Font** — family (a detected-installed list plus free-text CSS stack, with a live preview
  sample rendered in the chosen font and a warning when the primary family isn't actually
  installed), size (slider + free-entry number field), weight (100–900), italic, and an
  "advanced" disclosure for variable-font axes (`wght`/`wdth`/`slnt`/`ital`/`opsz` via CSS
  `font-variation-settings`).
- **Colour & effects** — text colour, highlight, underline (style + colour), overline,
  strikethrough (single/double), capitalization (including small caps), superscript/subscript,
  outline (colour + width, via `-webkit-text-stroke`), drop shadow (colour/blur/offset), glow
  (a second, wider shadow layer), background colour, border colour and corner radius.
- **Layout** — letter spacing, word spacing, line height, baseline offset, text direction
  (ltr/rtl), and alignment.
- **Presets** — apply a saved preset to the current element, save the current style as a new
  named preset, set another element to **inherit** any property this one leaves unset, export
  every saved preset to a JSON file, import one, and reset this one element.

Every row that has a value set shows a small **↺** reset button beside it — that resets *only
that one property*, leaving the rest of the element's customization alone. Settings → Appearance
→ *Appearance editor* also offers **Reset every customized element** (a global reset; saved
presets are untouched) and a **Rename element** is not needed — an element's persisted label is
simply the element's own label at the time it was first edited.

## Persistence

Everything lives in `settings.json`:

- `elementAppearance: Record<id, { label, kind, style, inheritFrom?, updatedAt }>` — one entry per
  customized element, keyed by a stable id (`kind:key`, e.g. `tab:<projectId>`,
  `node:<nodeId>`, `app:context-menu`). A property that has never been touched is simply absent
  from `style` — there is no "off" value, because "unset" already means "use the platform
  default", which is what makes per-property reset meaningful.
- `appearancePresets: { id, name, style, createdAt }[]` — the saved-preset library, independent
  of what is currently applied anywhere.

An element with an empty style and no inheritance is not written at all — closing the editor
without changing anything leaves `settings.json` exactly as it was.

## How it's applied

`renderer/lib/appearance/apply.ts` turns a style object into CSS declarations. A single
`<style>` element (`AppearanceStyleInjector`, mounted once at the app root) is regenerated
whenever `elementAppearance` changes, emitting one rule per customized element:

```css
[data-appearance-id="tab:abc123"] { font-family: …; color: …; … }
```

Any DOM node that carries a matching `data-appearance-id` attribute picks up the override
automatically — adding theming support to a new element is exactly "add the attribute and a
right-click entry that calls `openAppearanceEditor(id, label, kind, anchorEl)`", nothing else.
Declarations are written with `!important` because several themed elements (active tabs, in
particular) already carry inline styles from unrelated app logic (the project's accent colour);
an explicit user override has to win over that.

**Self-application.** The editor's own popover carries `data-appearance-id="app:appearance-editor"`
on its root, right-click menus carry `app:context-menu`, the Settings dialog carries
`app:settings-dialog`, and the command palette carries `app:command-palette` — so a theming
system that could only theme user content, and not its own chrome, would visibly fail its own
"Edit chrome → App chrome" list.

## What's covered in this pass, and what isn't yet

The engine (registry, apply mechanism, the anchored non-modal popover, persistence, presets,
export/import, self-theming) is complete and general. Wiring is currently live on:

- Project tabs (`TabBar.tsx`)
- Terminal/agent node titles (`TerminalNode.tsx`)
- The five app-chrome targets listed above

Extending it to another element — a sticky note, a group frame label, a dock button — is
mechanical: add `data-appearance-id={appearanceId(kind, key)}` to its root/text element, and a
menu entry (or a Shift+right-click handler, for anything tab-like) that calls
`openAppearanceEditor`. That extension work is intentionally left for follow-up passes rather
than claimed as done here; each additional surface is a small, low-risk PR against an engine that
already exists, not new design work.

Terminal *content* (the text a shell or an agent CLI prints) is out of scope for this system —
its typography is governed by the existing `fontFamily`/`fontSize`/… terminal settings
(Settings → Terminal), because most of what this editor offers (outline, glow, small caps,
per-character decoration) has no meaning inside a monospaced glyph grid rendered by xterm's own
WebGL/DOM/canvas renderers.

## Unsupported properties, and why they still show

CSS genuinely cannot express everything this editor asks for:

- **Only one decoration style/colour at once.** `text-decoration-line` can combine underline,
  overline and strikethrough, but there is exactly one `text-decoration-style` and one
  `text-decoration-color` for the whole set. When more than one line is turned on, they share the
  underline's style and colour. Each choice is still stored individually and reapplied
  individually — only the *rendering* is limited, and the editor says so directly under the
  Underline control.
- **Variable-font axes may do nothing.** There is no API to ask "does this specific installed
  font define a `wght` axis" without parsing the font binary, so the editor shows the axis
  controls whenever the *platform* can apply `font-variation-settings` at all (feature-detected
  via `CSS.supports`), and explains that an individual font may still ignore some or all axes.
  Values are kept regardless, in case the same style is later applied to a font that does define
  them.

Nothing is ever silently dropped: an unrepresentable value stays in `settings.json` and keeps
being offered back to the user exactly as entered.

## Security & privacy

Everything here is local: styles are plain data (numbers, short strings, hex/functional colour
strings) written to the same `settings.json` every other setting lives in. Import validates a
bounded, allowlisted shape (`renderer/state/appearance.ts` → `parseImportFile`/`sanitizeStyle`) —
unknown keys, wrong types, and over-length strings are dropped per-property rather than
rejecting or silently corrupting the whole file, and a name collision on import is skipped rather
than overwritten. Export writes a plain JSON file via a client-side `Blob`/`<a download>` — no
network request is made.

## Verification

Manual verification performed for this pass (automated tests were explicitly out of scope for
this delivery — see the repository's contribution guide for the project's normal testing
expectations):

- `npx tsc --noEmit -p tsconfig.web.json` / `-p tsconfig.node.json` compile clean (see the PR /
  commit history for the exact run).
- Opened the editor from a tab (both via the caret menu's new item and Shift+right-click),
  confirmed anchored positioning and viewport-edge flipping near a screen edge, confirmed Escape
  and outside-click close it and return focus to the tab.
- Edited every property in each of the four tabs and confirmed the live preview sample and the
  actual tab/node label update immediately.
- Reset a single property, reset a whole element, exported presets, imported them into a second
  browser profile's `settings.json` shape (via the parse function directly), and confirmed
  duplicate names and malformed entries are reported and skipped rather than corrupting the
  library.
