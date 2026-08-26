# nodeterm — the terminal playground (GitHub Pages site)

The project's GitHub Pages site for this fork
([Ding-Ding-Projects/material-nodeterm](https://github.com/Ding-Ding-Projects/material-nodeterm)),
served at `https://ding-ding-projects.github.io/material-nodeterm/`. Static, no build step,
no third-party requests: plain HTML/CSS and vanilla ES modules only.

The documentation and landing site runs in Kids mode by default. Its current visual style is
intentional and must be preserved. Site changes are limited to stale facts, data, releases,
links, features, accessibility, and broken behavior. Desktop Material Design 3 work must not
restyle this site.

```
site/
  index.html          the whole page's shell — everything else is rendered by app/main.js
  styles.css           Material Design 3 tokens (day + night themes) + this site's own
                        vanilla-JS "hallway of doors" component styling — see the file's
                        own top comment; docs/app-design-tokens.md's "The site's own
                        divergence, closed" section is the app-side half of the same story
  app/
    core/               the generic engine: store, render loop, menus, regex builder,
                         command palette, confirm gate, room/settings-card registries
    features/           one module per canonical feature, each registering its own
                         room and/or settings card (see app/features/index.js)
    shared/             pure data tables and logic shared by the features above
  content/changelog.json  historical changelog data generated from this fork's CHANGELOG.md,
                          plus a verified current-release overlay for the latest stable build
  docs/                one article per feature, plus docs/index.html
  assets/              logo + hero illustration + fonts/ (Outfit, Roboto Mono — the exact
                        committed .woff2 files the desktop app bundles, copied byte-for-byte)
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
browser's own `localStorage` and are never sent anywhere. Outfit and Roboto Mono are bundled
locally under `assets/fonts/` (the exact committed `.woff2` files the desktop app ships,
SIL OFL-1.1 licensed — see `THIRD-PARTY-NOTICES.md` at the repo root); `styles.css`'s
`@font-face` blocks load them from this origin only. See `app/main.js`/`app/core/engine.js`
for how the rest is wired together.

The Time machine stores the prior durable values beside each saved-setting change, so **Put back**
really restores state, reapplies live theme/text-size effects, and the restore itself can be
reversed. Nickname and narrator-speed changes commit on control change rather than on every input
tick. TOTP records, toy-lock hashes, the School PIN and history itself never enter undo snapshots;
legacy secret-bearing rows are cleaned at load, and neither settings nor history exports include
those bytes. Authenticator deletion and Time machine-row deletion are therefore explicit,
record-only permanent actions instead of fake restores. Exports, conversions and old rows without a
prior-state snapshot are also honest record-only entries. Deleting the final history row persists an
explicit empty log after reload.
