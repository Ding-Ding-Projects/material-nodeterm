# nodeterm — the terminal playground (GitHub Pages site)

The project's GitHub Pages site for this fork
([Ding-Ding-Projects/material-nodeterm](https://github.com/Ding-Ding-Projects/material-nodeterm)),
served at `https://ding-ding-projects.github.io/material-nodeterm/`. Static, no build step,
no third-party requests: plain HTML/CSS and vanilla ES modules only.

```
site/
  index.html          the whole page's shell — everything else is rendered by app/main.js
  styles.css           the paper-and-ink design system (day + night themes)
  app/
    core/               the generic engine: store, render loop, menus, regex builder,
                         command palette, confirm gate, room/settings-card registries
    features/           one module per canonical feature, each registering its own
                         room and/or settings card (see app/features/index.js)
    shared/             pure data tables and logic shared by the features above
  content/changelog.json  real changelog data (generated from this fork's CHANGELOG.md)
  docs/                one article per feature, plus docs/index.html
  assets/              logo + hero illustration
  updates/             the desktop app's own auto-update feed hosting convention
                        (unrelated to this page's own JS, which fetches nothing from it)
```

## Because this is a subpath deployment

GitHub Pages serves this site from `/material-nodeterm/`, not a domain root. Every
internal link and asset reference in this tree must be relative (`./`, `../`) — a
root-absolute `href="/x"` builds and previews fine locally and then 404s in production.
`scripts/check-site-contract.mjs` (run from the repo root) fails the build on any of
these, among ~275 other hand-written completeness assertions for this site.

## Local preview

```bash
cd site && python3 -m http.server 8080   # → http://localhost:8080
```

Some features (the "What changed" room's `fetch('./content/changelog.json')`) require an
actual HTTP server rather than opening `index.html` directly via `file://`, because
browsers block `fetch()` of local files under that scheme.

## Everything here is local-only

No CDN script, no analytics, no third-party font, no tracking pixel. Settings, messages,
the local history log, toy-lock passwords (hashed), and TOTP secrets all live in this
browser's own `localStorage` and are never sent anywhere. See `styles.css`'s top comment
for the one documented exception to "no CDN" this redesign currently carries (a webfont
fallback, not a live request) and `app/main.js`/`app/core/engine.js` for how the rest is
wired together.
