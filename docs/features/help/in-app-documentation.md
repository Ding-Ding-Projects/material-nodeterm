# In-app documentation browser

Every article under `docs/` is compiled into the application and readable from inside it — no
browser, no network, no "see the docs online". The **Docs** destination on the nav rail opens it;
so does **Help → Documentation**, which used to open the repository's README on GitHub.

## Behaviour

**The corpus is compiled in at build time.** `scripts/build-docs-bundle.mjs` walks `docs/`, reads
every eligible markdown file, and writes the committed module `src/shared/docs-data.ts`. The
renderer imports that module; it never reads `docs/` at runtime.

That indirection is not an optimisation, it is the only thing that works. `docs/` is not part of
`build.files` in `package.json`, so it does not exist inside a packaged app, and Server Edition
runs in a browser with no filesystem to read it from either way. A runtime read would look perfect
in `npm run dev` and ship an empty documentation browser in every real install. This is the same
arrangement, for the same two reasons, as `CHANGELOG.md` → `src/shared/changelog-data.ts`.

**The bundle is loaded lazily.** It is ~1.2 MB of markdown across 89 articles, so
`components/docs/useDocsBundle.ts` imports it with a dynamic `import()` and Rollup gives it its own
chunk. The main renderer bundle never carries it, and a Server Edition browser never downloads it
until somebody opens the docs. It is still not a network fetch in any meaningful sense: in a
packaged app the chunk is a file beside the renderer bundle, and in Server Edition it comes from
the same origin already serving the page.

**Articles render through the app's one shared markdown renderer** — `renderer/lib/markdown.ts`
(marked + DOMPurify), the same pipeline that draws release notes, the chat transcript and the
editor preview. There is no second renderer and no marked extension: everything docs-specific is a
post-pass over the rendered DOM in `components/docs/DocsArticleView.tsx`.

Two things happen in that post-pass:

- **Heading ids are stamped on.** marked 12 emits none, so `#some-heading` links would have nothing
  to find. `headingSlug` in `src/shared/docs.ts` reproduces GitHub's slug shape — including one
  hyphen per whitespace character rather than per run — because the anchors in `docs/` were written
  by hand against how the same file renders on GitHub. Repeated headings get a numeric suffix, the
  same way GitHub disambiguates them.
- **Every anchor is intercepted.** A delegated click handler calls `preventDefault()` on *every*
  link in the article body and then decides what to do. This is not tidiness: an un-intercepted
  relative href navigates the whole renderer to `file:///…/foo.md` in Electron, or to a 404 in
  Server Edition, losing the canvas behind a blank screen. Middle-click (`auxclick`) is swallowed
  for the same reason.

**Link resolution has four outcomes and no silent fifth.** `resolveDocLink` in `src/shared/docs.ts`
classifies each href against the set of bundled article paths:

| Outcome | What happens |
| --- | --- |
| `article` | Opens that article in place, at its heading if the link carried one, and pushes the current article onto the Back trail. |
| `anchor` | Scrolls to that heading in the current article. No Back entry — Back should leave the article, not undo a scroll. |
| `external` | Opens in the real browser through `shell.openExternal`. |
| `missing` | A real repository path this bundle does not carry. Shown as a notice naming the file, with **Open on GitHub**. |

`missing` is the interesting one. Three links in `docs/` point outside the bundled tree today
(`../../README.md`, `../../CLAUDE.md`, and the design handoff). A click on one of those must not do
nothing — a control that looks live and isn't is exactly what this project forbids everywhere else
— so it reports what the file is and offers the one route that can still show it.

**Back walks a real trail.** A docs tree is a graph, not a hierarchy, so there is no "up" to
compute; the browser remembers the articles you actually came through.

**Search covers titles and body content**, plain text by default with regex as an explicit opt-in,
through the shared `useRegexSearchField` and an `AnchoredRegexBuilder` attached to the field —
the same contract as every other search bar in the app, not a docs-only dialect. Typing shows a
results list with up to five matching lines per article and their line numbers; the sidebar filters
to matching articles at the same time. Picking a result opens the article.

Two details in the search are load-bearing:

- **Long lines are searched in overlapping windows.** The shared `test()` clamps its candidate at
  `MAX_FILTER_CANDIDATE_LENGTH` (300 characters) because every *other* filter surface in the app
  feeds it a label. `docs/` has 49 lines longer than that, up to 1271 characters. Testing a whole
  line against a clamped predicate would silently never match anything past character 300 — a
  search reporting "no matches" over text that is right there on screen. `splitSearchWindows`
  splits a long line into 300-character windows overlapping by 150, so any match up to 150
  characters long lies wholly inside some window. A longer match straddling a boundary can still be
  missed; the alternative is a second matcher with its own behaviour, which is worse. The window
  size is passed in from `MAX_FILTER_CANDIDATE_LENGTH` rather than duplicated, so the two cannot
  drift apart.
- **Plain-text search prefilters whole bodies.** A native lowercase `includes` over 89 bodies is
  orders of magnitude cheaper than a per-line predicate over ~25,000 lines, and it can only skip
  articles the line scan would also have found nothing in. Regex mode passes no prefilter — there
  is no substring it could safely test for — and the scan is debounced by 180 ms in both modes.

## Configuration

None. There is nothing to switch on, no setting, and no per-project override: the documentation is
either in the build or the build is broken, which is what the guard below is for.

## Failure modes

- **The bundle chunk fails to load.** The screen says the bundle failed to load, shows the real
  error, and offers **Try again** plus **Read it on GitHub**. It does not render an empty sidebar
  and call it "no documentation" — a failed load and an empty corpus are different facts.
- **A link points outside the bundle.** Reported by name with a route to GitHub (above), never a
  dead click.
- **A `#anchor` has no matching heading** (a stale link). The article opens and the scroll stays
  where it is, rather than jumping somewhere arbitrary.
- **A malformed percent-escape in a link.** `decodeURIComponent` throwing would take the whole
  rendered article down with it, so a bad escape decodes to itself and the link degrades to
  `missing`.
- **The search has not settled.** The results pane says "Searching…", which is a different message
  from "Nothing matches this search." Reporting the second while the first is true is how a search
  reads as broken.
- **A bundled doc was edited without regenerating.** Caught at build time, not at runtime — see
  Verification.

## Security considerations

Article markdown is sanitized by DOMPurify through the shared renderer, exactly as every other
markdown surface in the app is. The docs post-pass only reads `href` and `textContent` and writes
`id`/`title`/`data-doc-link`; it never re-injects HTML.

No article can navigate the renderer, because every anchor is intercepted before its default
action. External links go through `shell.openExternal`, which is the app's existing boundary for
handing a URL to the operating system.

The content is committed repository documentation compiled into the build. Nothing here reads a
user file, a project path, or the network.

## Verification

**The completeness guard is the point.** Bundling drops a file exactly as easily as it includes
one, and the symptom is invisible: the screen still opens, the sidebar still has articles, and the
missing one simply is not there. `scripts/check-docs-bundle.mjs` runs inside `npm run build` and
fails it on five conditions:

1. An eligible article on disk is **missing from the committed bundle**.
2. A bundled article no longer exists on disk (deleted, renamed, or newly excluded).
3. A markdown file under `docs/` is neither bundled nor covered by one of the two explicit
   exclusions in `build-docs-bundle.mjs` — so a new `docs/<something>/` subtree cannot quietly fall
   out of the bundle.
4. The committed `docs-data.ts` differs from an in-memory regeneration of the current tree — this
   is what catches an *edited* doc whose bundle was never rebuilt, plus title/section drift.
5. The check would otherwise pass vacuously: fewer than 40 articles, or any bundled article with an
   empty body.

It also reports how many article-to-article links resolve inside the bundle (149 of 152 today). It
deliberately does not *fail* on the three that don't: those are pre-existing links to files outside
`docs/`, the browser handles them honestly, and failing the build on them would be failing it for a
condition this feature did not create.

Two exclusions are declared, each with its reason: `docs/superpowers/` (agent working plans and
specs — process notes, not product documentation) and `docs/assets/` (READMEs describing generated
capture assets). Everything else is bundled by default, so the failure mode of forgetting is a
bigger bundle, never a missing article.

To check the guard actually guards, break it on purpose:

```
node scripts/build-docs-bundle.mjs      # regenerate after editing any doc
node scripts/check-docs-bundle.mjs      # green
# delete one article's entry from src/shared/docs-data.ts
node scripts/check-docs-bundle.mjs      # RED: "MISSING FROM THE BUNDLE"
node scripts/build-docs-bundle.mjs      # restore
node scripts/check-docs-bundle.mjs      # green again
```

The pure logic — titles, sections, grouping, slugs, link resolution, the search-window splitter and
the search itself — is unit-tested in `src/shared/docs.test.ts`, including the case that a single
clamped test misses a needle past character 300 while the window splitter finds it.

## Three surfaces

- **Desktop (Electron):** full. Rail destination and Help menu row.
- **Server Edition (browser):** identical. The screen is pure renderer code, the bundle chunk is
  served from the same origin as the app, and `shell.openExternal` in the browser bridge opens a
  new tab. Nothing here needs a main process, so there is no bridge member to stub.
- **Mobile companion (`nodeterm-ios`, separate private repo):** not applicable in this change. The
  phone app attaches to tmux sessions over the transport protocol and has no rail, no canvas and no
  screen switcher to host a documentation browser. Shipping the corpus to it would mean carrying
  1.2 MB of desktop-architecture prose onto a phone that has no way to navigate it. If it is ever
  wanted there it is a follow-up in that repo, not a degrade to arrange here.

## Suggested articles

- [Regex builder](../../regex-builder.md) — the search contract this browser's field uses, and the
  engine behind the `.*` trigger beside it.
- [Changelog viewer](../../changelog-viewer.md) — the other build-time-compiled markdown surface,
  and the pattern this one follows.
- [Appearance](../appearance/README.md) — the Material tokens the screen is drawn with.
