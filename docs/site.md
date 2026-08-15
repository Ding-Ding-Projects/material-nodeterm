# The GitHub Pages site

The static landing site lives in `site/` and deploys via
`.github/workflows/pages.yml` on every push to `main` that touches `site/**`
(or the workflow itself), plus `workflow_dispatch`. It is plain HTML/CSS/JS —
no build step, no bundler, no npm dependency. The workflow uploads `site/`
exactly as committed.

This document covers: the base-path trap this fork lives under and how the
site avoids it, the deploy workflow, the shell/feature registry contract,
the tab-docking + accessibility-axis rule, the theme-token rule, and how to
run the site locally.

## The base-path trap (read this first)

This repository is a **fork**. Upstream (`eneskirca/nodeterm`) owns the
custom domain `nodeterm.dev`, and a GitHub Pages custom domain verifies to
exactly one repository — so this fork cannot use it and will always publish
at the **project-path** URL:

```
https://ding-ding-projects.github.io/material-nodeterm/
```

Note the trailing `/material-nodeterm/`. That path segment is not optional
and is the entire trap: a page that references its own assets with a
**root-absolute** URL (`/styles.css`, `/assets/mark.svg`, `href="/"`) will
build cleanly, deploy green, and then every single page and asset 404s in
production — because the browser resolves `/styles.css` against the domain
root (`https://ding-ding-projects.github.io/styles.css`), not against the
project path the site actually lives under.

**The fix used throughout `site/`:** every internal `href`/`src` is either
a bare relative path (`styles.css`, `assets/mark.svg`) or explicitly
`./`-prefixed (`./app/core/app.js`). Both resolve relative to the current
document regardless of what path prefix the document itself was served
under, so the exact same files work unmodified whether you preview them at
`http://localhost:8080/` or the real deployed
`https://ding-ding-projects.github.io/material-nodeterm/`.

This was verified by grepping the finished `site/index.html` for any
`href="/…"` / `src="/…"` root-absolute internal reference — there are none.
(External links to `https://github.com/...` and similar are absolute
**by necessity**, since they point off-site; those are fine. The one bug
found and fixed during this work was the brand logo's `href="/"`, corrected
to `href="./"`.)

`site/.nojekyll` (an empty file) is also present so GitHub Pages serves the
directory as-is rather than running it through Jekyll, which would
otherwise ignore/mangle anything under an underscore-prefixed path.

If this fork ever gets its own custom domain, none of this needs to change
— relative URLs work identically at the domain root and under a path
prefix. It's only broken in one direction (root-absolute breaking under a
prefix), which is exactly the direction avoided here.

## The deploy workflow

`.github/workflows/pages.yml`:

- Triggers on `push` to `main` (path-filtered to `site/**` and the workflow
  file itself) and `workflow_dispatch`.
- `actions/configure-pages` → `actions/upload-pages-artifact` (`path:
  site`) → `actions/deploy-pages`, with the standard `pages: write` /
  `id-token: write` / `contents: read` permissions and the `github-pages`
  environment.
- A `concurrency` group keyed by the workflow, `cancel-in-progress: true`
  — a newer push superseding an in-flight deploy is correct here, since
  this workflow only ever publishes the newest content.
- **No test job, no lint job, no type-check.** Per this project's CI
  policy (see `docs/ci-and-releases.md`), no workflow in this repository
  gates a release on a test/lint verdict, and that applies here too. A run
  fails only if the deploy itself fails.
- It does **not** enable Pages via the API or touch repository settings —
  that's a one-time manual step outside the workflow's remit.

## The registry contract

`site/app/core/registry.js` is the seam between this lane (the shell:
tabs, search, palette, settings surface, notifications, appearance,
destructive-confirm gate — everything under `site/app/core/`) and the
site-content lane (`site/app/features/**`, a sibling's ownership). Neither
lane imports the other's internals; both talk only to the registry.

```js
import { registerTab, registerSetting, registerCommand } from '../core/registry.js'

registerTab({ id, title, icon, group, order, render(container) { /* … */ } })
registerSetting({ id, tabId, title, describe, control(container, get, set) { /* … */ } })
registerCommand({ id, title, run() { /* … */ }, hint })
```

- **`registerTab`** adds an entry to the tab strip. Either pass `render`
  (called once, lazily, the first time the tab is opened) for content that
  doesn't exist in the DOM yet, or pass `panelEl` directly to adopt an
  already-authored panel in place (this is how the static "Overview" tab
  in `index.html` — `<div data-tab-panel="overview" …>` — is picked up
  without any JS needing to build it).
- **`registerSetting`** adds a row to the (itself tabbed) Settings
  surface. `control(container, get, set)` must render the *live* control
  and call `set(value)` on change — never write to `localStorage`
  directly, or the change won't be recorded in local version history and
  won't show up correctly in the command palette's inline rich control for
  that same setting.
- **`registerCommand`** adds a palette-only entry with no tab/setting
  backing.

`site/app/features/index.js` is currently a one-line placeholder
(`export {}`) so `<script type="module" src="./app/features/index.js">`
in `index.html` never 404s before the content lane fills it in. Replace
its contents with real registrations; the shell picks them up
automatically, including ones registered after the shell has already
booted (`onRegistryChange` in `registry.js` exists for exactly that).

## Tab docking and the accessibility axis

The tab strip (`site/app/core/tabs.js`) docks to any of the four edges —
left (default), right, top, bottom — persisted per visitor. Docking is an
**orientation change, not a rotation**: no label is ever rotated 90°.

The load-bearing rule: `aria-orientation` on the rail, and which arrow
keys move focus (`ArrowUp`/`ArrowDown` vs `ArrowLeft`/`ArrowRight`), track
the **actual rendered axis** — not the raw `dock` preference. Below 768px
the strip visually collapses to a horizontal icon-only bar pinned to the
bottom of the viewport *regardless* of the stored dock edge (see
`@media (max-width: 767px)` in `styles.css`), because a side rail has no
room to earn its keep on a phone. `tabs.js` has a matching
`isVerticalNow()` helper that checks the same breakpoint via
`matchMedia('(max-width: 767px)')` before deciding whether "vertical"
means anything right now, and every place that would otherwise read the
raw `dock` value (the ARIA attribute, the keyboard handler, the overflow
measurement) goes through it instead. Get this wrong and you get a strip
that *looks* right and is unusable by keyboard — the exact failure mode
this project's shared instructions call out by name, because no
screenshot reveals it.

The strip also implements: an overflow "More" menu (`tab-rail__more`, via
the shared `menu.js` anchored/filterable menu) when tabs exceed the
available space rather than clipping or wrapping illegibly; drag-and-drop
reordering (native HTML5 DnD on the tab buttons); pinning (right-click →
"Pin tab"/"Unpin tab", pinned tabs always shown first and never sent to
overflow); and persistence of order, pinned set, active tab, and dock edge
across reloads (`localStorage`, via `storage.js`).

**Known simplification, stated plainly:** full nested tab *grouping* (drag
tabs into named, collapsible clusters) is not implemented — a `group`
field is accepted on `registerTab` but currently unused by the renderer.
Of the four tab-discovery searches this project's shared instructions
describe (current strip, within a group, groups by name, master search
across every window), a static single-page site has exactly one window and
one strip, so "current strip" (the search field above the rail, wired to
the anchored regex builder) and "master search across every destination"
(the command palette) are the two that meaningfully apply here; the other
two collapse into those given there is nothing else for them to search.

## The theme-token rule

`site/styles.css` already followed the project's required pattern before
this lane touched it, and every addition here preserves it rather than
introducing a second convention:

- The **complete light palette** is defined as `--md-*` custom properties
  on a bare `:root`.
- The **dark** palette is defined exactly **twice** more: once under
  `@media (prefers-color-scheme: dark)`, guarded as
  `:root:not([data-theme='light'])` so an explicit light choice always
  wins over the OS setting; and once under `:root[data-theme='dark']` so
  an explicit toggle wins in both directions regardless of the OS setting.
- `body` has an explicit token background (`background: var(--md-surface)`)
  — never left transparent, since the browser paints its own ground
  behind an unstyled page.
- **No color is ever given its only definition inside a media query or a
  `[data-theme]` block.** Every token that exists in the dark blocks also
  exists on bare `:root` with its light value.

The one runtime exception, and it's intentional: the accent color set
through the appearance editor (`theme.js`) is applied as an **inline style
override** on `--md-primary`/`--md-on-primary` directly on
`document.documentElement`, on top of whichever theme's token value is
currently in effect. That's a per-visitor customization layered *above*
the token system, not a competing definition of the tokens themselves —
resetting it (`resetAccent()`) simply removes the inline override and the
underlying token block (light or dark) shows through again unchanged.

## Everything is bundled and local

No CDN scripts, stylesheets, fonts, or remote images. No analytics, no
third-party tracking. Plain ES modules (`type="module"`, native browser
imports — no bundler) and hand-written CSS. The one asset added by this
lane is `site/.nojekyll` (empty, disables Jekyll processing); no new
images were needed.

## Running the site locally

Any static file server rooted at `site/` works — there is no build step:

```bash
cd site && python3 -m http.server 8080   # → http://localhost:8080
```

or, with Node available:

```bash
npx serve site
```

Because every internal reference is relative, this local preview and the
real deployed `https://ding-ding-projects.github.io/material-nodeterm/`
render identically — the only difference is the path prefix the browser
resolves those relative references against, which is exactly the property
the base-path fix above depends on.

## What's implemented vs. simplified (honest inventory)

Fully implemented: tabbed navigation with the four-edge dock + narrow-
viewport collapse described above; the anchored regex builder
(`regexBuilder.js`/`regex.js`, plain-text default, bounded evaluation,
catastrophic-backtracking heuristic guard) attached to every search field
this lane owns (tab strip search, settings search, command palette
search) and every menu (`menu.js`, used by the tab context menu and its
overflow list); the command palette on `Ctrl`/`Cmd`+`Shift`+`F` with rich
inline setting controls and teleport-on-select; the tabbed settings
surface with its own search and per-visitor `localStorage` persistence;
non-blocking bottom-right toasts (auto-dismissing for info/success,
persistent for warning/error) plus a reviewable notification centre with
multi-select, invert selection, an honestly-scoped "select all shown",
bulk dismiss, and filtered JSON export; the destructive-action
super-confirmation gate (two independent keys, then a slider, with an
always-available emergency exit and Escape support) gating the "clear
local site data" action; the Material 3 appearance editor with a
continuous 2-D saturation/value field, a hue strip, numeric RGB/hex entry,
a translator across HEX/HEX8/RGB(A)/HSL(A)/HSV/HWB/CIELAB/LCH/OKLab/OKLCH/
CMYK, a live WCAG contrast readout, and an out-of-gamut warning; and
append-only local version history for every settings change, including
resets, surfaced in its own history browser under Settings → Data &
privacy.

Deliberately simplified, stated here rather than left silent: nested tab
*grouping* (see above); drag-reorder is mouse/HTML5-DnD only — there's no
dedicated keyboard-only reorder command yet (arrow keys move *focus*
between tabs, not the tab itself); and CMYK is the standard naive
subtractive approximation every browser-side picker uses (documented in
`color.js`) rather than an ICC-profile-accurate conversion, since there is
no single "correct" CMYK without one.
