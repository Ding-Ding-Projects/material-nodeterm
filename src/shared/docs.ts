// Types + the pure logic behind the in-app offline documentation browser, shared between the
// build-time generator (scripts/build-docs-bundle.mjs, which transpiles this file with esbuild and
// calls `buildArticle`) and the renderer, which imports the types and the resolver/search helpers
// it renders `docs-data.ts` with.
//
// The renderer never reads docs/*.md at runtime and never fetches it: the `docs/` tree is not part
// of `build.files` in package.json, so it does not ship in a packaged app, and Server Edition runs
// in a browser with no filesystem to read it from either way. `docs-data.ts` is the committed,
// compiled artifact this module's helpers produce — exactly the arrangement `changelog.ts` /
// `changelog-data.ts` already use, for exactly the same two reasons. See
// docs/features/help/in-app-documentation.md.
//
// Everything here is pure and platform-free: no `node:path`, no `node:fs`, no DOM. Article paths
// are ALWAYS repo-relative POSIX strings minted by our own build script, so plain '/' handling is
// correct here — this is not the ambiguous-dialect case `core/path-basename.ts` exists for, where
// a recorded path's owning platform is unknown.

export interface DocArticle {
  /** Repo-relative POSIX path, e.g. `docs/regex-builder.md`. The stable id: link targets resolve
   *  to it, the sidebar keys on it, and the completeness guard compares it against disk. */
  path: string
  /** The article's first `# ` heading, else a title derived from its filename. */
  title: string
  /** Sidebar grouping, derived from the directory (see `docSectionFor`). */
  section: string
  /** The raw markdown, verbatim. Rendered through the app's one shared renderer
   *  (`renderer/lib/markdown.ts`), never parsed into a second representation here. */
  body: string
}

/** What a link inside a rendered article points at. Every href gets exactly one of these — there
 *  is no "do nothing" case, because a link that silently does nothing is the dead end the
 *  in-app-docs contract exists to forbid. */
export type DocLinkTarget =
  /** Another bundled article, optionally at one of its headings. */
  | { kind: 'article'; path: string; hash: string | null }
  /** A heading inside the article being read. */
  | { kind: 'anchor'; hash: string }
  /** Off-repo, or any non-relative scheme — opened in the real browser. */
  | { kind: 'external'; href: string }
  /** A repo file this bundle does not carry (an article outside the bundled tree, a link to
   *  README.md, or a genuinely dangling path — `docs/` already contains two). Surfaced as an
   *  honest "not in this bundle" state with a route to the same file on the hui, never as a
   *  click that appears to work and doesn't. */
  | { kind: 'missing'; path: string }

export interface DocSnippet {
  /** 1-based line number within the article body. */
  line: number
  text: string
}

export interface DocSearchHit {
  path: string
  title: string
  section: string
  /** The article's own title matched the query. */
  titleMatch: boolean
  /** Matching body lines, in document order, capped at `snippetCap`. */
  snippets: DocSnippet[]
  /** Matching body lines found before the cap stopped the scan — never presented as a total when
   *  the scan short-circuited (see `truncated`). */
  matchCount: number
  /** The scan stopped at the cap, so `matchCount` is a floor rather than a total. */
  truncated: boolean
}

export interface DocSection {
  label: string
  articles: DocArticle[]
}

/** Where the bundled tree is rooted. Every article path starts with this. */
export const DOCS_ROOT = 'docs'

const FIRST_H1_RE = /^#[ \t]+(.+?)[ \t]*$/m

/** The article's own title: its first `# ` heading. Falls back to a humanized filename so a doc
 *  that loses its heading still gets a usable sidebar row instead of an empty one. */
export function docTitleFrom(path: string, markdown: string): string {
  const m = FIRST_H1_RE.exec(markdown)
  if (m && m[1].trim()) return m[1].trim()
  const file = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
  if (!file) return path
  return file.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/** Title-case a directory segment for a sidebar heading: `source-control` → `Source control`. */
function humanizeSegment(seg: string): string {
  return seg.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/**
 * The sidebar group an article belongs to, derived from its directory rather than from a
 * hand-maintained map — a map is one more place that drifts silently when a doc moves.
 *
 * `docs/foo.md` is "Reference" (the deep-dive write-ups); `docs/features/<area>/foo.md` is that
 * area; `docs/features/foo.md` is "Features".
 */
export function docSectionFor(path: string): string {
  const rel = path.startsWith(`${DOCS_ROOT}/`) ? path.slice(DOCS_ROOT.length + 1) : path
  const segs = rel.split('/')
  if (segs.length <= 1) return 'Reference'
  if (segs[0] === 'features') {
    return segs.length === 2 ? 'Features' : humanizeSegment(segs[1])
  }
  return humanizeSegment(segs[0])
}

/** Build the article record for one file. Called by the build script AND by the guard's in-memory
 *  regeneration, so "what did we bundle" is decided exactly once. */
export function buildArticle(path: string, markdown: string): DocArticle {
  return { path, title: docTitleFrom(path, markdown), section: docSectionFor(path), body: markdown }
}

/**
 * Sections in a stable render order: the curated feature areas first (alphabetically, with the
 * "Features" index ahead of its areas), then "Reference" last — the top-level docs are the long
 * deep dives a reader arrives at from a link, not the front door.
 */
export function groupArticles(articles: readonly DocArticle[]): DocSection[] {
  const bySection = new Map<string, DocArticle[]>()
  for (const a of articles) {
    const list = bySection.get(a.section)
    if (list) list.push(a)
    else bySection.set(a.section, [a])
  }
  const rank = (label: string): number => (label === 'Features' ? 0 : label === 'Reference' ? 2 : 1)
  const labels = [...bySection.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  return labels.map((label) => ({
    label,
    // A README index is the section's front door, so it sorts first; everything else by title.
    articles: [...(bySection.get(label) as DocArticle[])].sort((a, b) => {
      const ra = a.path.endsWith('/README.md') ? 0 : 1
      const rb = b.path.endsWith('/README.md') ? 0 : 1
      return ra - rb || a.title.localeCompare(b.title)
    })
  }))
}

/** GitHub-style heading slug, so `#some-heading` links inside an article find their target. The
 *  renderer stamps these onto the rendered headings itself rather than teaching the SHARED
 *  markdown renderer to emit ids — that renderer also draws release notes, chat and the editor
 *  preview, and none of those asked for anchors. */
export function headingSlug(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      // One hyphen per whitespace character, NOT per run: `docs/` anchors are written by hand to
      // match how the same file renders on the hui, and GitHub's slugger substitutes each space
      // individually. Collapsing runs here would silently mis-target every heading that contains
      // punctuation between two words (`socket — why` → `socket-why`, not `socket--why`).
      .replace(/\s/g, '-')
  )
}

/** Normalize a POSIX path built from `base` + a relative href, resolving `.` and `..`. A `..` that
 *  climbs past the root is KEPT, so an href escaping the repo stays visibly wrong instead of
 *  quietly resolving to something plausible. */
function normalizePosix(segments: readonly string[]): string {
  const out: string[] = []
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else out.push('..')
      continue
    }
    out.push(seg)
  }
  return out.join('/')
}

/** Resolve an href written inside `fromPath` into a repo-relative path. Exported for the guard,
 *  which walks every bundled article's links to report how many resolve. */
export function resolveDocPath(fromPath: string, href: string): string {
  if (href.startsWith('/')) return normalizePosix(href.split('/'))
  const dir = fromPath.slice(0, Math.max(0, fromPath.lastIndexOf('/')))
  return normalizePosix([...dir.split('/'), ...href.split('/')])
}

const ABSOLUTE_URL_RE = /^[a-z][a-z0-9+.-]*:/i

/**
 * Classify one href from a rendered article. `known` is the set of bundled article paths — the
 * only thing that decides `article` vs `missing`, so a doc that is on disk but outside the bundled
 * tree can never be mistaken for one we can show.
 */
export function resolveDocLink(
  fromPath: string,
  hrefRaw: string,
  known: ReadonlySet<string>
): DocLinkTarget {
  const href = hrefRaw.trim()
  if (!href) return { kind: 'external', href: hrefRaw }
  if (href.startsWith('#')) return { kind: 'anchor', hash: href.slice(1) }
  // `//host/path`, `https:`, `mailto:` — anything with a scheme or protocol-relative authority is
  // not ours to resolve.
  if (href.startsWith('//') || ABSOLUTE_URL_RE.test(href)) return { kind: 'external', href }

  const hashAt = href.indexOf('#')
  const hash = hashAt === -1 ? null : href.slice(hashAt + 1)
  const pathPart = hashAt === -1 ? href : href.slice(0, hashAt)
  if (!pathPart) return { kind: 'anchor', hash: hash ?? '' }

  const resolved = resolveDocPath(fromPath, decodeHrefPath(pathPart))
  if (known.has(resolved)) return { kind: 'article', path: resolved, hash: hash || null }
  return { kind: 'missing', path: resolved }
}

/** Markdown link targets are percent-encoded for spaces and the like; article paths are not.
 *  A malformed escape decodes to itself rather than throwing — a bad link must degrade to
 *  "missing", never crash the article that contains it. */
function decodeHrefPath(p: string): string {
  try {
    return decodeURIComponent(p)
  } catch {
    return p
  }
}

/**
 * Split one line into overlapping windows so a long line can be matched in full by a predicate
 * that clamps its candidate (the shared `useRegexSearchField().test` clamps at
 * `MAX_FILTER_CANDIDATE_LENGTH`, because every OTHER filter surface in the app feeds it a label).
 * Without this, a match past that clamp on one of this tree's ~49 lines longer than 300 characters
 * is silently never found — a search that reports "no matches" over text that is right there.
 *
 * `overlap` is the guarantee: any match up to `overlap` characters long lies wholly inside at
 * least one window. A longer match straddling a boundary can still be missed; the alternative is
 * a second matcher with its own behavior, which is worse.
 */
export function splitSearchWindows(line: string, windowSize: number, overlap: number): string[] {
  if (line.length <= windowSize) return [line]
  const step = Math.max(1, windowSize - overlap)
  const out: string[] = []
  for (let start = 0; start < line.length; start += step) {
    out.push(line.slice(start, start + windowSize))
    if (start + windowSize >= line.length) break
  }
  return out
}

export interface DocSearchOptions {
  /** Longest candidate the predicate will look at in full (the caller's clamp). */
  windowSize: number
  /** Longest match `splitSearchWindows` guarantees to find across a window boundary. */
  overlap: number
  /** Stop scanning an article's body after this many matching lines. */
  snippetCap: number
}

export const DEFAULT_DOC_SEARCH_OPTIONS: DocSearchOptions = {
  windowSize: 300,
  overlap: 150,
  snippetCap: 5
}

/** Does any window of this line satisfy the predicate? */
function lineMatches(line: string, test: (s: string) => boolean, opts: DocSearchOptions): boolean {
  for (const w of splitSearchWindows(line, opts.windowSize, opts.overlap)) {
    if (test(w)) return true
  }
  return false
}

/**
 * Search titles AND body content. `test` is the caller's live matcher — the shared
 * `useRegexSearchField().test`, so plain text stays the default and regex stays the explicit
 * opt-in, with one behavior contract rather than a docs-only dialect.
 *
 * `prefilter` is an optional cheap whole-body reject (a lowercase `includes` in text mode): the
 * bundled corpus is ~1.2 MB across ~25k lines, and testing every line of every article on every
 * keystroke is the difference between instant and janky. It must never reject an article the
 * line scan would have matched — in regex mode the caller passes nothing.
 */
export function searchArticles(
  articles: readonly DocArticle[],
  test: (candidate: string) => boolean,
  options?: Partial<DocSearchOptions> & { prefilter?: (article: DocArticle) => boolean }
): DocSearchHit[] {
  const opts: DocSearchOptions = { ...DEFAULT_DOC_SEARCH_OPTIONS, ...options }
  const prefilter = options?.prefilter
  const hits: DocSearchHit[] = []

  for (const a of articles) {
    const titleMatch = test(a.title)
    // A title match still scans the body: a reader searching "tmux" wants the lines, not just the
    // fact that an article is called that.
    const scanBody = titleMatch || !prefilter || prefilter(a)
    const snippets: DocSnippet[] = []
    let matchCount = 0
    let truncated = false

    if (scanBody) {
      const lines = a.body.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i]
        if (!raw.trim()) continue
        if (!lineMatches(raw, test, opts)) continue
        matchCount += 1
        if (snippets.length < opts.snippetCap) snippets.push({ line: i + 1, text: raw.trim() })
        else {
          truncated = true
          break
        }
      }
    }

    if (titleMatch || matchCount > 0) {
      hits.push({
        path: a.path,
        title: a.title,
        section: a.section,
        titleMatch,
        snippets,
        matchCount,
        truncated
      })
    }
  }

  // A title match outranks a body-only match; then more matches first; then title order, so the
  // list is stable for the same query rather than reshuffling on an unrelated re-render.
  return hits.sort(
    (x, y) =>
      Number(y.titleMatch) - Number(x.titleMatch) ||
      y.matchCount - x.matchCount ||
      x.title.localeCompare(y.title)
  )
}
