# Changelog viewer

An in-app viewer over every released version of nodeterm — third tab of the **History** screen,
beside session memory and local settings history (`design/v2/MD3 History.dc.html`). It is
generated entirely at **build time** from the root `CHANGELOG.md`; nothing in the shipped app
parses that file, fetches it, or reads it off disk at runtime.

This requirement is not named in `CLAUDE.md` — it was added for the Material Design 3 rewrite's
History screen and documents itself completely below, per this project's rule that a canonical
feature's documentation must stand on its own rather than assume a reader has read a source file
this doc never names.

Files:

| Layer | File |
|---|---|
| Types + pure parser (`parseChangelog`) | `src/shared/changelog.ts` |
| Generated, committed data module the renderer imports | `src/shared/changelog-data.ts` |
| Generator (`CHANGELOG.md` → `changelog-data.ts`) | `scripts/build-changelog.mjs` |
| Build-time completeness guard, wired into `npm run build` | `scripts/check-changelog.mjs` |
| Date-range filter shared with `LocalHistoryPanel` | `src/renderer/lib/dateRange.ts` |
| The viewer itself | `src/renderer/components/changelog/ChangelogPanel.tsx`, `ReleaseCard.tsx` |
| Hosting screen (session memory · settings history · changelog) | `src/renderer/components/HistoryScreen.tsx` |
| Parser unit tests | `src/shared/changelog.test.ts` |

## Why the viewer never parses `CHANGELOG.md` at runtime

Two independent facts rule it out, and either one alone would be enough:

- `CHANGELOG.md` is not part of `build.files` in `package.json` — it does not ship inside a
  packaged Desktop build (`out/**/*`, `!out/session-host/**/*`, `package.json` only), so a
  packaged app has no copy of it to read.
- Server Edition runs in a browser. A browser tab has no filesystem access to a file sitting
  beside the server's source tree, and the server does not expose one for this.

So the viewer imports a **generated, committed** TypeScript module, `src/shared/changelog-data.ts`,
which compiles into the normal build like any other source file. Regenerating it is a build-time
step a human (or an agent following CLAUDE.md's "the changelog is brought current in every
project-changing task" rule) runs after editing `CHANGELOG.md`, not something the running app ever
does.

## The pipeline

```
CHANGELOG.md  --parseChangelog()-->  ChangelogRelease[]  --renderChangelogModule()-->  changelog-data.ts
     (hand-maintained)                (src/shared/changelog.ts)   (scripts/build-changelog.mjs)   (committed)
```

1. **`node scripts/build-changelog.mjs`** reads `CHANGELOG.md`, transpiles `src/shared/changelog.ts`
   with esbuild (already a project devDependency — the same tool `server:build`/`host:build` use
   to turn TypeScript into something plain Node can run) and calls its exported `parseChangelog`,
   then writes the result through `renderChangelogModule` to `src/shared/changelog-data.ts`. Run
   this after every edit to `CHANGELOG.md` and commit the regenerated file alongside it.
2. **`node scripts/check-changelog.mjs`** is the build-time guard — wired into `npm run build`
   (`package.json`'s `build` script). It independently regenerates the same module **in memory**
   and diffs it byte-for-byte against what is actually committed at `changelog-data.ts`: a
   `CHANGELOG.md` edit with no matching regeneration fails the build instead of shipping a viewer
   that quietly disagrees with the changelog everyone else reads. It also:
   - resolves every referenced commit SHA via `git cat-file -e <sha>^{commit}` — offline,
     deterministic, no GitHub API call, so it behaves identically on a laptop, in CI, or on a
     packaging machine, as long as the checkout has full history (the same requirement
     `scripts/count-lines.mjs` already has for `git blame`);
   - verifies every commit link's visible TEXT agrees with its HREF — a short label (the
     "Unreleased" section's 8-character prefixes) must `git rev-parse` to the exact 40-character
     SHA the link points at, and a full-length label must equal it outright;
   - refuses to pass vacuously: fewer than 3 parsed releases, or a mismatch between the number of
     `## [` headings in `CHANGELOG.md` and the number of releases the parser actually produced (a
     parser regression that silently drops or merges a release), both fail the build.

Run it by hand at any time with `node scripts/check-changelog.mjs`; it prints exactly how many
releases, commit links, and unique commits it checked, and exits non-zero on any failure.

## The parser contract (`src/shared/changelog.ts`)

`parseChangelog(markdown: string): ChangelogRelease[]` is a pure function — no filesystem, no git,
no network — so it is unit-tested directly (`changelog.test.ts`) and reused unmodified by both the
generator and the checker.

- **Line-based, not one monolithic regex.** A bullet's text legitimately wraps across several
  physical lines in the real file (`- **Windows Python discovery now reuses…**` is one example);
  the parser rejoins a non-blank, non-heading, non-bullet line into the previous bullet as its
  continuation, and a blank line ends that continuation so unrelated prose can never be appended.
- **`## [Unreleased]` and `## [x.y.z] — yyyy-mm-dd`** are the two release-heading shapes; the date
  is `null` for Unreleased (it has none). `## Earlier releases` — no `[`, so it never matches — is
  correctly ignored rather than starting a bogus release or corrupting the previous one's last
  bullet.
- **`### <Category>` is an open set, never a hard-coded list.** The real file uses Added, Changed,
  Fixed, Tests, Documentation, Chores, Performance and Security today; a new heading added later
  renders with a category label immediately, with no code change required (see
  `ReleaseCard.tsx`'s deterministic per-name colour hash, for the same reason).
- **`Commit:`/`Commits:`** (singular for one link, plural for the "Unreleased" section's several,
  which can themselves wrap across lines) are both handled by one regex over the accumulated block
  — see `COMMIT_LINK_RE` in `changelog.ts`.
- CRLF and LF checkouts parse identically (normalized once, up front) — the same trap
  `styles.theme.test.ts` documents for a different file in this repository.

## The UI

- **Filtering is release-level, not bullet-level.** A release either matches the current date
  range and search query or it doesn't; a matching release shows every one of its bullets. This
  mirrors the design (`MD3 History.dc.html` filters whole release blocks) and avoids a release
  card that silently drops bullets a reader scrolled down to find. The search box matches against
  the version string, every bullet's category and text, and every linked commit SHA.
- **Search reuses the app's shared regex-search hook and anchored builder**
  (`lib/regex/useRegexSearchField.ts`, `components/regex/AnchoredRegexBuilder.tsx`) — plain text by
  default, regex an explicit opt-in via the `.*` chip, exactly like every other search field in the
  app.
- **The date-range filter is shared with `LocalHistoryPanel`** via `src/renderer/lib/dateRange.ts`
  (`parseBoundary`, `toDateInputValue`, `applyDateRangePreset` — extracted out of
  `LocalHistoryPanel.tsx`, which now imports it too, so the two sibling History tabs can never
  drift on what a preset or a typed date means). `"Unreleased"` carries no date and is therefore
  excluded from an explicit bounded range rather than guessed as "now" — it still shows under the
  default "All time" (or any other open-ended range).
- **Commit links open through `window.nodeTerminal.shell.openExternal`**, the same call
  `SourceControlPanel.tsx` already uses for GitHub links — real navigation to the actual commit on
  GitHub, on every platform this API is wired for (Desktop and Server Edition both implement it;
  see `src/preload/index.ts` and `src/renderer/bridge/stubs.ts`).
- **Release notes are rendered, not printed.** A bullet's markdown (`**bold**`, `` `code` ``,
  links) goes through the app's shared markdown pipeline (`renderer/lib/markdown.ts` — `marked` +
  DOMPurify), the same rule CLAUDE.md states for any provider-authored or generated text the app
  displays. Bullet text itself is never translated or funnified — it is a fact generated from git
  history, not chrome.
- **Export and bulk actions** follow the same pattern as `SessionMemoryPanel` and
  `LocalHistoryPanel`: `ExportMenu` for "export everything currently visible", `BulkActionBar` for
  "export just the releases I selected" (flattened one row per bullet, or one summary row for a
  release with no recorded changes). There is no destructive bulk action — reading history never
  needs a confirmation gate, and nothing in this feature deletes anything.

## No destructive gate — and why that stays true

The changelog viewer has no write path of any kind: it cannot edit `CHANGELOG.md`, delete a
release, or mutate git history. `DestructiveConfirmGate` therefore does not apply here. If a future
change adds an in-app "Clear history" or similar mutation, that is new scope requiring its own
two-key destructive gate per CLAUDE.md's "Super confirmation for destructive actions" — do not add
an ungated destructive control to this feature without one.

## Three surfaces

- **Desktop**: full — `changelog-data.ts` compiles into the packaged app like any other module,
  and `shell.openExternal` opens commit links in the system browser.
- **Server Edition**: full — the same generated module ships in the server-served renderer bundle;
  `shell.openExternal` opens a new browser tab (see `stubs.ts`).
- **Mobile companion** (`nodeterm-ios`, separate private repo): not applicable in this pass. The
  changelog is a documentation surface with no session/canvas concept to attach to, unlike
  session memory (which needed its own N/A note for the same reason) or local settings history.
  Surfacing it on mobile — if ever wanted — is a self-contained follow-up in that repository: it
  would need its own copy of the generated release list (or a small JSON export of it), not an
  extension of the `TerminalTransport`/`RemoteTransport` protocol this repo's mobile note usually
  points at, since nothing here is session- or transport-shaped.
