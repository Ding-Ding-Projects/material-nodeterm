# Command palette

## Opening it

**`Ctrl+Shift+F`** is the discoverable global shortcut, on every platform (macOS included — it is
not remapped to a Mac-style chord because the literal control key combination is producible
there too, and a second binding that only sometimes matches would be worse than one that always
does). **`Cmd/Ctrl+K` keeps working exactly as before** — nothing about the existing binding
changed, so muscle memory built on it is never taken away. Both open and close the same palette;
neither is primary.

Chromium reserves `Ctrl+Shift+C` for its DevTools inspector and a page cannot `preventDefault()`
it — see the terminal copy-shortcut notes in `CLAUDE.md` for the same constraint biting a
different feature. `Ctrl+Shift+F` is free on every platform this app ships to (desktop Electron
and the browser-based Server Edition alike), which is why it was picked over `Ctrl+Shift+C`
adjacent letters.

Implementation: `src/renderer/canvas/Canvas.tsx`, the keydown effect that already owns `⌘K`
(search for `setPaletteOpen`).

## What it lists

Every command the palette assembles (`buildCommands` in `Canvas.tsx`) — node/agent/terminal
creation, project switching, going to an open node (with in-buffer content search), file search,
worktree and remote actions, view toggles, and a curated set of **Settings** rows — is one flat,
fuzzy-searchable list. A feature that cannot be found here by its name is not palette-complete;
if you add a new destination or setting, add its row here too.

## Rich rows

A settings result is not a label that sends you somewhere else to change it — it renders its own
**live control** inline, right there in the row:

```ts
{
  id: 'setting-notify-done',
  label: 'Notify when a turn finishes in the background',
  control: {
    type: 'toggle',
    checked: s.notifyOnClaudeDone,
    onToggle: (v) => update({ notifyOnClaudeDone: v, notifyConsentAsked: true })
  },
  run: () => update({ notifyOnClaudeDone: !s.notifyOnClaudeDone, notifyConsentAsked: true }),
  onSecondary: () => openSettingsTo('notifications', 'Notify when a turn finishes'),
  secondaryLabel: 'Open in Settings'
}
```

`onToggle` calls the **exact same `useSettings().update()` setter** the Notifications settings
section uses — same persistence (`settings.json`), same validation, same effect on every other
surface that reads that setting. There is no second copy of the value and no chance for the
palette's idea of "on" to disagree with the settings page's. `run` mirrors the toggle so Enter (or
clicking the row outside the control) does the same thing as clicking the switch — a control row
never has two different actions attached to it.

`CommandControl` (`src/renderer/components/CommandPalette.tsx`) supports:

- `{ type: 'toggle', checked, onToggle }` — rendered as a real switch.
- `{ type: 'select', value, options, onChange }` — rendered as a compact value that cycles
  through `options` on click (native `<select>` popups can't nest inside the row's own clickable
  surface without becoming invalid, nested-interactive-element markup, so a cycling control is
  the accessible middle ground; add a dedicated dropdown affordance here if a future row needs
  more than a handful of options).

### Why a control row isn't a `<button>`

Every ordinary command row is a `<button className="palette__item">` — unchanged. A row **with**
a control can't be, because the control (a switch) is itself a real interactive element, and HTML
forbids an interactive element inside a `<button>`. Those rows render as
`<div role="option" aria-selected>` instead; clicking anywhere in the row still runs the row's
default action, and clicking the control specifically stops propagation so it fires exactly once
rather than double-toggling.

## Teleporting to the exact element

Every rich-control command also carries `onSecondary` — the palette's existing "reveal in
Explorer"-style secondary action (⤷ button, or `Cmd/Ctrl+Enter`) — wired to
`openSettingsTo(sectionId, searchQuery)`. That:

1. Opens `SettingsPage` to the exact section (`initialSection`).
2. Seeds the sidebar's own search box with the setting's title (`initialQuery`), which the
   section's existing `SearchableRow` machinery uses to filter every OTHER row in that section
   out of view — landing the user on the one control they searched the palette for, using the
   settings page's own search feature rather than a second, bespoke scroll-and-highlight system.

This reuses machinery instead of inventing a parallel one: `SettingsSearchContext` + `matchesQuery`
+ `SearchableRow` already exist for the settings page's own search bar (see the regex-builder and
settings-search rules in `CLAUDE.md`); the palette's teleport is that same mechanism, entered from
a different door.

## Size: bounded card vs. full window

A `⤢` / `⤡` button beside the search input toggles between the default bounded card (`560px`
wide, `60vh` tall) and a full-window view (`min(1040px, 100vw-40px)` wide, most of the viewport
tall). The choice persists in `localStorage` (`nodeterm.paletteSize`) across sessions.

## Virtualization

Ordinary rows (icon + label + hint) are cheap regardless of count — they always render. **Control**
rows are the expensive ones (each instantiates a live, store-subscribed switch), so a row's
`InlineControl` is not constructed until the row has actually scrolled into the palette's viewport
(`IntersectionObserver` with a 200px pre-roll, in `PaletteRow`). A palette with hundreds of setting
rows never instantiates hundreds of live controls up front; only the ones the user has scrolled
near. Keyboard traversal (`↑`/`↓` moving the active index) is `O(1)` regardless of list size — it
only updates a number, never touches per-row DOM.

This is a targeted, not exhaustive, virtualization: the full list still fully renders its
non-control markup (icon/label/hint spans) for every row. At the palette's current scale (dozens,
not thousands, of commands) this is the right trade — a uniform-row-height windowing scheme would
need to assume a fixed row height that control rows and section headers don't actually have, and
getting that wrong would clip or misposition rows. If the command list grows into the thousands, a
proper windowed list is the next step; this document says so explicitly rather than leaving the
gap to be rediscovered silently.
