# Site feature layer (GitHub Pages)

This document describes the client-side feature layer under `site/app/features/`
and `site/app/shared/`, the generated content under `site/content/`, the
per-feature documentation articles under `site/docs/`, and the completeness
guard at `scripts/check-site-contract.mjs`.

It does **not** cover `site/index.html`, `site/styles.css`, or
the shell modules under `site/app/core/` (`site/app/core/engine.js`, `site/app/core/store.js`,
`site/app/core/render.js`, `site/app/core/dom.js`) — those are owned by a different lane building the
site's shell (tab strip, settings screen, command palette). This document only
covers what plugs into that shell, and how.

## Architecture: everything is a plugin registered through `core/registry.js`

`site/index.html` loads exactly one script:

```html
<script type="module" src="./app/features/index.js"></script>
```

`site/app/features/index.js` is this lane's entry point. It:

1. Dynamically imports `../core/registry.js` (owned by the shell lane).
2. Wraps each of `registerTab`, `registerSetting`, `registerCommand` so a
   missing or throwing registry function produces a `console.warn` instead of
   blanking the page.
3. Calls every feature module's `registerXxx(api)` function.

**This is deliberately defensive.** At the time this lane was built, the shell
lane's `core/registry.js` did not exist yet in this worktree — both lanes were
building in parallel. If `core/registry.js` is missing, `index.js` logs a
warning and returns; nothing throws.

Every feature module exports one `registerXxx(api)` function and calls
`api.registerTab(...)`, `api.registerSetting(...)`, and/or
`api.registerCommand(...)`. Panel/control builders are wrapped through
`shared/mountable.js`'s `asMountable()`, which supports both plausible calling
conventions for a `render`/`control` factory (`fn(container)` that mounts into
a passed container, or `fn()` that returns an element for the caller to
place) — the exact calling convention was not pinned down in the contract
handed to this lane, so both are supported rather than guessed at.

## Module map

```
site/app/shared/
  storage.js           localStorage read/write/subscribe helpers (LS_PREFIX = "nodeterm.site.")
  crypto.js             SHA-256 hashing via crypto.subtle, for PINs/passwords (never store the secret itself)
  dom.js                 h() hyperscript, injectStyleOnce(), clear()
  mountable.js             asMountable() — render/control calling-convention shim
  i18n.js                   language mode, funny levels, emoji toggle, the COPY dictionary, t()/tNode()
  school-state.js            School mode's pure state (kept separate from its UI to avoid a circular import)
  vocabulary-state.js         personal-vocabulary schema validation + applyReplacements()
  narrator-state.js            narrator settings (language, voiceURI per language, rate, pitch)
  locks-state.js                 toy-lock records + session-only unlocked state
  lockGate.js                     guardPanel() — wraps a panel builder to gate it behind a lock
  notifications-state.js          notification history + toast rendering (bottom-left)
  history-state.js                 local version-history log (plain description strings)
  regexBuilder.js                   the shared anchored regex-builder popover
  bulkList.js                       the shared bulk-action list component
  exportFormats.js                   JSON/JSONL/YAML/TOML/XML/CSV/TSV/Markdown/HTML encoders + downloadFile()

site/app/features/
  index.js               entry point (see above)
  language-settings.js    language mode + funny sliders + emoji toggle UI
  school-mode.js            School mode UI (toggle, rename, PIN set/verify)
  vocabulary.js               personal-vocabulary upload UI (locked via lockGate)
  dimsum.js                     the 10% dim-sum toast + its settings panel
  dimsum-data.js                  the six-dish catalog (bilingual names + SVG asset URLs)
  narrator.js                       narrator UI (two voice pickers, rate/pitch) (locked via lockGate)
  locks.js                           the toy-locks management panel
  exports.js                          Notifications tab, Local history tab, Export tab
  changelog.js                         the changelog viewer
  docs-index.js                         a "Docs" tab linking to site/docs/index.html
  assets/dimsum/*.svg                    six original dish illustrations
```

## Per-feature notes

### Remote access routes (`pair-device.js`)

The Pages playground is a static product tour, not a terminal client. Its former pairing room
generated an Ed25519 keypair and installed the public key through the desktop's `/pair` endpoint,
but discarded the private key and the successful response (`agentToken` and optional relay token).
That left an authorized key on the host while giving the browser no credential or transport with
which to reconnect. The room now makes no pairing request and offers two honest routes instead:

- **Server Edition / Docker** — open the URL served by the actual self-hosted browser client. The
  page links to the Server Edition article and its container quickstart.
- **nodeterm mobile** — open the live App Store listing. The iOS companion implements the complete
  pairing protocol and owns the private key and returned device credentials.

Mobile handoff: **@eneskirca**, no pairing wire format changed here. The iOS client remains the
owner of Settings → Phone QR/code pairing and must continue retaining the SSH private key,
`agentToken`, and optional relay token. Any future browser pairing client must implement that same
durable credential lifecycle before it is allowed to install a host key.

Behavior is covered by `site/app/features/pair-device.test.js`; it executes the real module,
registers the room, and verifies the rendered destinations and absence of pairing actions.

### Language modes, funny levels, emoji (`language-settings.js`, `shared/i18n.js`)

Every other feature module renders its own chrome through `t(id)` /
`tNode(id)` from `shared/i18n.js`, so the language-mode setting visibly
changes copy across the whole site, not just on its own panel.

**Storage keys** (all under the `nodeterm.site.` prefix):
`lang.mode` (`en`|`yue`|`bi`), `lang.funnyEn` (1–10), `lang.funnyYue` (1–10),
`lang.emoji` (bool).

**The "voice, never facts" contract, in code:** `COPY` is a dictionary of
`{ en: factString, yue: factString }` per id. `shapeVoice(fact, level, lang)`
never edits `fact` — it only **appends** a short, level-specific sentence
after it (`EN_SUFFIX`/`YUE_SUFFIX` tables). The fact is therefore always the
literal, unmodified prefix of whatever `t()` returns, at every funny level,
in every category including errors — checkable by inspection, since there is
no branch that rewrites the fact string itself.

Bilingual mode returns `{ en, yue }` from `t()`; `tNode()` renders it as a
prominent primary line plus a compact secondary `<small>` line, so it never
crowds the layout.

### School mode (`school-mode.js`, `shared/school-state.js`)

**Storage keys:** `school.enabled` (bool), `school.name` (display name,
default `"School mode"`), `school.pinSalt` / `school.pinHash` (never the PIN
itself).

While `school.enabled` is true: `effectiveLanguageMode()` and
`effectiveFunnyLevel()` in `shared/i18n.js` force English / level 1
regardless of what's stored, without touching the stored values — so turning
School mode off restores the visitor's actual preferences with nothing to
"restore" in code, because nothing was ever overwritten. `dimsum.js` checks
`isSchoolModeEnabled()` before rolling the dim-sum draw and before rendering
its own panel's real content.

**Known limitation — no unregister API.** The registry contract handed to
this lane is `registerTab` / `registerSetting` / `registerCommand` only;
there is no documented "unregister" or "update" call. Two consequences,
both handled as honestly as the contract allows rather than hidden:

1. Cantonese/bilingual/funny-level controls **cannot be structurally removed**
   from the registry once School mode turns on mid-session — instead, every
   affected panel's render function checks School-mode state on every call
   and renders **nothing** for the affected controls (see
   `language-settings.js`'s `rebuild()`). This satisfies "omit the copy" at
   the rendering level; it does not retract the registry *entry* itself.
2. **Rename propagation is best-effort.** After a rename, this module
   re-invokes `registerTab`/`registerSetting` with the **same id** and the
   new title, hoping the registry treats a repeated id as an update. If it
   does not, a stale title may remain registered until the next full page
   load. Every place this module prints the feature's name reads the live
   value from `getDisplayName()` — it never caches or hardcodes "School
   mode" — so the *rendered panel* is correct immediately either way; only a
   possible stale entry in the shell's own tab list / palette is the
   at-risk surface, and only until reload.

If `core/registry.js` ships an update/unregister call, wire it here instead
of the re-registration guess — that removes both caveats.

### Personal vocabulary (`vocabulary.js`, `shared/vocabulary-state.js`)

**Storage keys:** `vocab.data` (`{ version: 1, entries: { word: replacement } }`),
`vocab.fileName`.

Schema is version 1 only, validated **completely** before anything is stored
(`validateVocabularyText()`): max 200 KB file, max 2000 entries, key ≤ 100
chars, value ≤ 500 chars, string-only values, `__proto__`/`constructor`/
`prototype` keys rejected, nesting capped at 4 levels before the schema-shape
check even runs. A rejected file changes nothing — the previous valid state
(if any) stays active.

**Where replacement actually happens:** `applyReplacements(text)` compiles a
single word-boundary regex from the current entries (longest key first,
literal characters escaped) and is called from `shared/i18n.js`'s `t()`,
**after** funny-level shaping — this is "the user-facing text boundary" the
contract asks for: prose copy only, never code, URLs, identifiers, or paths,
none of which are ever routed through `t()`.

Locked via `lockGate.guardPanel('vocabulary', …)` — see Toy locks below.

### Dim sum surprise (`dimsum.js`, `dimsum-data.js`)

The draw (`Math.random() >= 0.1` check) runs exactly once, synchronously,
inside `registerDimSum()`, which itself runs exactly once per page load —
so "never twice in one load" falls out of the call graph rather than needing
a separate guard. Suppressed entirely when `isSchoolModeEnabled()`.

All six illustrations are original SVGs in
`site/app/features/assets/dimsum/*.svg`. **Asset URLs are resolved via
`new URL(path, import.meta.url)`, not plain relative strings** — see "the
base-path trap, twice" below; this is the one place in this lane where that
trap was actually caught and fixed during the build.

There is no setting anywhere that disables the automatic draw — the panel's
"show me another dish" button is a manual peek at the catalog, not an
opt-out.

### Narrator (`narrator.js`, `shared/narrator-state.js`)

**Storage keys:** `narrator.enabled`, `narrator.language` (`en`|`yue`|`both`),
`narrator.voiceUri.en`, `narrator.voiceUri.yue` (persisted `voiceURI`, never
the display name — names are not unique across engines and are localized),
`narrator.rate`, `narrator.pitch`.

**The late-voice-list trap, and how this module avoids it:**
`window.speechSynthesis.getVoices()` commonly returns `[]` on its very first
call in a fresh page load; the real list arrives afterward, announced by the
`voiceschanged` event. `watchVoices()` in `narrator.js` calls the callback
immediately with whatever is currently known **and again every time
`voiceschanged` fires**, so a picker built before the list has loaded still
ends up populated once it does — it never reports "no voices installed" on a
machine that has forty of them just because it happened to check too early.
Each of the two pickers (English, Cantonese) has its **own independent**
subscription; there is no shared picker.

Cantonese voice detection uses a permissive language-tag filter
(`/^(yue|zh-hant-hk|zh-hk)/i`), falling back to any `zh*` voice if nothing
narrower matches. **This is a real limitation, not an oversight:** there is
no single BCP-47 tag that every speech engine uses consistently for Hong
Kong Cantonese specifically (as opposed to Mandarin) — some report `zh-HK`
for Cantonese, some for Mandarin-with-HK-locale, some ship `yue-HK`. The
picker shows whatever it can and lets the visitor confirm by ear via "Test
narrate," which is the honest resolution available without a network call to
some voice-classification service (which would violate the no-network rule
anyway).

"Both" is strictly serialized via a single shared queue (`pump()` in
`narrator.js`) that never calls `speechSynthesis.speak()` again until the
previous utterance's `end`/`error` event fires — so English and Cantonese
can never overlap.

Locked via `lockGate.guardPanel('narrator', …)`.

### Toy locks (`locks.js`, `shared/locks-state.js`, `shared/lockGate.js`)

**Storage keys:** `locks.list` (array of
`{ id, label, saltHex, hashHex, createdAt }`). Unlocked-this-session state is
held in an in-memory `Set` (not persisted — a reload re-locks everything,
which is the honest behavior for a toy lock with no real session concept).

Each lock's `id` doubles as the id of the surface it protects, and each lock
has its **own independent** salt + hash — there is no shared/master
credential, and unlocking one lock never unlocks another (`verifyLockPassword`
is always scoped to exactly one lock record).

Two of this lane's own panels — `vocabulary` and `narrator` — are wired as
real lockable surfaces via `guardPanel(id, label, buildContent)`, which is a
generic wrapper any feature module can import and use; it is not special-cased
to those two. **Honest-in-search, as implemented:** because a locked panel's
`registerTab`/`registerSetting` title is unaffected by lock state (only the
*content* is gated), the tab/setting stays fully reachable by its real title
in whatever search or palette the shell lane builds — opening it always shows
either the real content or a plain unlock prompt, never nothing.

**Known limitation, same root cause as School mode's:** there is no
subscription/teardown hook documented in the registry contract, so
`guardPanel`'s internal `subscribeLocks`/`subscribeUnlockState` listeners are
never explicitly torn down — see the comment at the bottom of
`shared/lockGate.js`. In a plain single-page site with a handful of guarded
panels this is a bounded, intentional leak, not an unbounded one; it should be
revisited if the shell lane's registry ships a documented unmount/dispose
hook for `render`/`control` factories.

### Exports, notifications, and local history (`exports.js`, `shared/notifications-state.js`, `shared/history-state.js`)

**Storage keys:** `notify.history` (capped at 200 entries),
`local.history` (capped at 500 entries).

Both lists get the full bulk-action contract via `shared/bulkList.js`:
multi-select with shift-click ranges and a keyboard equivalent, a select-all
labelled by what it actually selects, inverse selection, and a reviewable
`N items will change` preview requiring a second confirm click before any
destructive action (remove-selected, clear-all) runs.

The Export panel offers **settings**, **notification history**, and **local
history** each in all nine formats from `shared/exportFormats.js` (JSON,
JSONL, YAML, TOML, XML, CSV, TSV, Markdown, HTML). A lossy format (CSV, TSV,
Markdown, HTML — anything that can't represent nesting) shows its
`lossNote` **before** the download runs, requiring a second "Download
anyway" click; a non-lossy format downloads immediately.

The settings export is a **curated** flat list (`collectSettingsRecords()`),
not a raw dump of every `localStorage` key — it deliberately excludes lock
salts/hashes and the School-mode PIN hash from the exported settings record
even though they are not the secret itself, on the principle that hash
material has no reason to leave the panel that manages it.

### Changelog viewer (`changelog.js`, `site/content/changelog.json`)

`site/content/changelog.json` is **generated** from the repository's real
`CHANGELOG.md` (the JSON file's own `generatedNote` field says so). It was
produced by a one-off script (not committed — see "regenerating the
changelog data" below) that parses `## [version] — date`, the
`Commit: [`sha`](url)` line, and `### Category` / `- bullet` structure
already used by `CHANGELOG.md`, keeping only entries where a version, date,
**and** commit were all successfully parsed — a partial parse is dropped
rather than emitted as a partial or fabricated record. All 20 entries
`CHANGELOG.md` currently records were captured this way.

Date-range filtering uses a **native** `<input type="date">` pair rather
than a bespoke calendar widget — this was a deliberate scope decision under
the ultra-speed constraint for this pass (see "Deliberately not done" at the
bottom of this document). The native control already provides an anchored
popover with month/year navigation and accepts both a locale-formatted date
and a typed ISO date without any extra parsing here. Three presets (last 30
days, last 90 days, all time) sit alongside it. The date filter and the text
search (wired to `shared/regexBuilder.js`) **compose**: `applyFilters()`
always applies both the current range and the current predicate together,
never one replacing the other.

**Regenerating the changelog data:** there is no committed generator script
in this repository (the one used to produce `changelog.json` was a
throwaway, per the instructions for this lane). To regenerate after
`CHANGELOG.md` changes, write a small script that: reads `CHANGELOG.md`;
matches `^## \[([^\]]+)\] — (\d{4}-\d{2}-\d{2})`,
``^Commit: \[`([0-9a-f]+)`\]\((https://[^)]+)\)``, `^### (.+)$`, and
`^- (.+)$`; groups bullets under their most recent `###` heading within the
most recent `##` version block; and writes
`{ schemaVersion: 1, generatedFrom: "CHANGELOG.md", generatedNote: "...", entries: [...] }`
to `site/content/changelog.json`, keeping only entries with a version, date,
and commit all present.

### The shared anchored regex builder (`shared/regexBuilder.js`)

One implementation, three call sites: the personal-vocabulary entry list
(via `shared/bulkList.js`'s built-in search), the toy-lock list (same), and
the changelog search. `createSearchWithRegex({ onChange, placeholder,
ariaLabel })` returns `{ root, predicate }`: `root` is the search `<input>`
plus a `· *` toggle button that opens an anchored popover (pattern, flags,
a sample-text tester, and inline validity feedback) directly beside the
field it belongs to — never a separate page or a detached dialog. Plain-text
substring matching is the default; regex is an explicit opt-in via the
toggle.

**Evaluation bounds and their real limit.** Pattern length is capped at 200
characters and sample text at 2000; every `RegExp` construction and every
`.test()` call is wrapped in `try/catch` so an invalid pattern reports
inline instead of throwing. **This does not fully prevent catastrophic
backtracking from an adversarial pattern.** A hard guarantee against ReDoS
needs evaluation in a Worker with an enforced timeout that can actually
terminate a runaway synchronous regex engine call, which this static
single-thread site does not have. The practical risk is low because every
data set this searches is small and local (a personal vocabulary list, a
handful of locks, twenty changelog entries) — but it is a real, disclosed
gap, not a claimed guarantee.

## The base-path trap, twice

This fork deploys to `https://ding-ding-projects.github.io/material-nodeterm/`,
not a domain root, so **any** root-absolute internal link (`href="/foo"`)
silently works when previewed from a local file/dev server and 404s the
instant it ships. Two distinct sub-traps were found and fixed while building
this lane, and both matter for anyone adding a new feature module here:

1. **The obvious one:** a literal string like `href="/docs/index.html"`.
   None of this lane's own files contain one (the completeness guard's scan,
   described below, confirms it) — but `site/index.html` (owned by the shell
   lane, not this one) does still have `href="/"` on its logo link at the
   time of this writing. That file is out of this lane's ownership and was
   left untouched; it is called out explicitly in this lane's final report
   so the shell lane can fix it.

2. **The non-obvious one, actually caught during this build:** a *relative*
   path string set as a DOM `img.src` or `a.href` from inside a JS module
   resolves against the **document's** URL (`site/index.html`), not against
   the *module's own* file location. `dimsum-data.js` originally listed
   `svg: './assets/dimsum/har-gow.svg'` — correct if resolved relative to
   `dimsum-data.js` itself (`site/app/features/`), but wrong once assigned
   to an `<img src>`, because that resolves against `site/index.html`
   instead and would have pointed at a nonexistent `site/assets/dimsum/…`.
   Same bug, second instance, in `docs-index.js`'s link to the docs index.

   **The fix used everywhere in this lane:** resolve the URL once, in the
   module that owns the asset, via `new URL(relativePath, import.meta.url)`,
   and use the resulting **absolute** `.href` string as the DOM attribute
   value. This is immune to both traps at once — it doesn't care what the
   document's base path is, and it doesn't care where the importing module
   lives. See `dimsum-data.js`'s `asset()` helper and `docs-index.js`'s
   `DOCS_INDEX_URL` constant for the pattern; `changelog.js`'s
   `dataUrl()` (fetching `site/content/changelog.json`) uses the identical
   technique for a `fetch()` call rather than a DOM attribute.

## The completeness guard: `scripts/check-site-contract.mjs`

```
node scripts/check-site-contract.mjs
```

Not wired into any GitHub Actions workflow — this project runs no gating
checks in CI by policy (see `CLAUDE.md`'s CI section). This is a local tool:
run it yourself before considering a site change to this lane finished.

**Why it is hand-written rather than pattern-derived:** a guard that only
validates whatever it discovers already existing passes cleanly on a site
that implements nothing — it never looked for a specific feature by name, so
a missing one produces no signal. Every row in `FEATURES` and
`REQUIRED_DOC_SLUGS` names a real file, an exported function name, and a
handful of required substrings, and the guard **fails** when any one of them
is absent. It was verified to actually catch a removal: temporarily deleting
`registerSchoolMode` from `FEATURE_REGISTRARS` in `index.js` was confirmed to
turn the guard red (`registerSchoolMode appears only 1 time(s)…`), and
restoring it turned that specific check green again.

**The registration check is occurrence-counting, not `.includes()`, on
purpose.** An early version of this guard checked
`indexText.includes(feature.exportName)`, which stayed **green** even after
removing the feature from `FEATURE_REGISTRARS`, because the `import { ... }`
line at the top of `index.js` still contains the identical name — the
"renamed/removed symbol still matches" trap. The guard now requires **at
least two** occurrences of the exact identifier (word-boundary matched): one
from the import, one from actual use in the registrar list.

It additionally scans every `.html`/`.js`/`.css` file under `site/` for a
root-absolute `href="/..."`, `src="/..."`, or `url(/...)` (excluding
protocol-relative `//` and full `http(s)://` URLs) and fails if it finds
one — this is what currently reports `site/index.html`'s `href="/"`, per
the base-path section above.

## Deliberately not done in this pass (and why)

- **No test suite, lint run, or capture harness.** Per this lane's explicit
  ultra-speed instructions. Verification here is: `node --check` on every
  module (syntax only, since import specifiers can't be resolved outside a
  browser/bundler), and running `check-site-contract.mjs`.
- **No bespoke anchored calendar widget for the changelog date range.** A
  native `<input type="date">` pair was used instead — see the changelog
  section above for exactly what that does and does not provide.
- **`site/index.html`'s `href="/"` was not fixed.** It is in a file this
  lane does not own (`site/index.html`); fixing it belongs to the shell
  lane. The completeness guard reports it rather than silently ignoring it.
- **`core/registry.js`'s exact `render`/`control` calling convention was
  guessed defensively rather than confirmed**, since it did not exist in
  this worktree while this lane was built. `shared/mountable.js` supports
  both plausible conventions; if the real contract turns out to need a
  third shape, only that one file needs to change.
