// Types + a pure parser for CHANGELOG.md, shared between the build-time generator
// (scripts/build-changelog.mjs, which transpiles this file with esbuild and calls
// `parseChangelog`) and the renderer, which imports only the TYPES to describe the
// already-generated `changelog-data.ts` it actually renders.
//
// The renderer never parses CHANGELOG.md at runtime and never fetches it: `CHANGELOG.md` is not
// part of `build.files` in package.json, so it does not ship in a packaged app, and Server Edition
// runs in a browser with no filesystem to read it from either way. `changelog-data.ts` is the
// committed, compiled artifact this module's parser produces — see docs/changelog-viewer.md.
//
// Category is deliberately an open string, never a closed enum, the same discipline
// `HistoryAction` in local-history.ts follows: the UI derives its category chips from whatever
// headings actually appear in the log (Added/Changed/Fixed/Tests/Documentation/Chores/Performance/
// Security today), never from a hard-coded list this parser could silently drift from.

export interface ChangelogCommitRef {
  /** The full 40-character commit SHA the link points to. */
  sha: string
  /** The visible link text — a short prefix in the "Unreleased" section, the full SHA for a
   *  released version. Kept verbatim rather than re-derived, so the rendered link matches what
   *  CHANGELOG.md actually says. */
  label: string
  url: string
}

export interface ChangelogItem {
  /** The `### ` heading this bullet was filed under — e.g. "Added", "Fixed". */
  category: string
  /** The bullet's raw markdown text, unmodified — release notes are a FACT generated from git
   *  history and are never translated or funnified. The renderer renders this through the shared
   *  markdown pipeline (`renderMarkdown`), not as printed asterisks. */
  text: string
}

export interface ChangelogRelease {
  /** The bracket contents of the `## [...]` heading — a semver like "0.3.0", or "Unreleased". */
  version: string
  /** The raw `yyyy-mm-dd` date from the heading, or `null` for "Unreleased" (which has none). */
  date: string | null
  /** `date` as epoch milliseconds (UTC midnight), for the date-range filter — `null` alongside
   *  `date === null`. */
  dateMs: number | null
  commits: ChangelogCommitRef[]
  /** Every bullet across every category, in document order, each carrying its own category. */
  items: ChangelogItem[]
}

const RELEASE_HEADING_RE = /^## \[([^\]]+)\](?:\s*—\s*(\d{4}-\d{2}-\d{2}))?\s*$/
const CATEGORY_HEADING_RE = /^### (.+?)\s*$/
const BULLET_RE = /^ {0,3}-\s+(.+)$/
const COMMITS_LINE_RE = /^Commits?:\s*(.*)$/
const COMMIT_LINK_RE = /\[`([0-9a-f]{4,40})`\]\((https:\/\/\S+?\/commit\/([0-9a-f]{40}))\)/g

/** UTC midnight for a `yyyy-mm-dd` string — ECMA-262 treats a date-only ISO string as UTC, so
 *  this is deterministic across every machine's local timezone (the generator and the checker
 *  must produce byte-identical output regardless of where either runs). */
function dateOnlyToMs(dateStr: string): number {
  return Date.parse(`${dateStr}T00:00:00.000Z`)
}

function extractCommits(block: string): ChangelogCommitRef[] {
  const refs: ChangelogCommitRef[] = []
  for (const m of block.matchAll(COMMIT_LINK_RE)) {
    refs.push({ label: m[1], url: m[2], sha: m[3] })
  }
  return refs
}

/**
 * Parse the whole CHANGELOG.md source into an ordered list of releases, newest first (document
 * order — the file itself is already newest-first).
 *
 * Deliberately line-based rather than a single monolithic regex: a bullet's text legitimately
 * wraps across several physical lines (see `- **Windows Python discovery now reuses…**` in the
 * real file), and a line-based walk is what lets a continuation line rejoin the bullet it belongs
 * to without a lookahead that could just as easily swallow the next heading.
 */
export function parseChangelog(markdown: string): ChangelogRelease[] {
  // Git checkouts can hand this either LF or CRLF depending on core.autocrlf — normalize once
  // rather than let every regex above carry its own `\r?` (a lesson this codebase has paid for
  // more than once; see styles.theme.test.ts's own note on the same trap).
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')

  const releases: ChangelogRelease[] = []
  let current: ChangelogRelease | null = null
  let category: string | null = null
  let lastItem: ChangelogItem | null = null
  // Set while walking the (possibly multi-line-wrapped) "Commits:"/"Commit:" block, so every
  // subsequent line is folded into it until a blank line or a heading ends it.
  let commitsBuffer: string[] | null = null

  const flushCommits = (): void => {
    if (commitsBuffer && current) {
      current.commits = extractCommits(commitsBuffer.join('\n'))
    }
    commitsBuffer = null
  }

  for (const rawLine of lines) {
    const line = rawLine

    const releaseMatch = RELEASE_HEADING_RE.exec(line)
    if (releaseMatch) {
      flushCommits()
      if (current) releases.push(current)
      const [, version, date] = releaseMatch
      current = {
        version,
        date: date ?? null,
        dateMs: date ? dateOnlyToMs(date) : null,
        commits: [],
        items: []
      }
      category = null
      lastItem = null
      continue
    }

    // Any other heading (`### `, or the trailing unbracketed `## Earlier releases`) ends both the
    // commit-block capture and the current bullet's continuation — it is never wrapped text.
    if (/^#+\s/.test(line)) {
      flushCommits()
      const categoryMatch = CATEGORY_HEADING_RE.exec(line)
      category = categoryMatch ? categoryMatch[1] : null
      lastItem = null
      continue
    }

    if (commitsBuffer) {
      if (line.trim() === '') {
        flushCommits()
      } else {
        commitsBuffer.push(line)
      }
      continue
    }

    const commitsMatch = COMMITS_LINE_RE.exec(line)
    if (commitsMatch && current) {
      commitsBuffer = [line]
      lastItem = null
      continue
    }

    if (line.trim() === '') {
      lastItem = null
      continue
    }

    const bulletMatch = BULLET_RE.exec(line)
    if (bulletMatch && current && category) {
      lastItem = { category, text: bulletMatch[1].trim() }
      current.items.push(lastItem)
      continue
    }

    // A non-blank, non-heading, non-bullet line right after a bullet (no blank line between) is
    // that bullet's wrapped continuation — CHANGELOG.md wraps long bullets across lines rather
    // than keeping every one on a single (very long) line.
    if (lastItem) {
      lastItem.text = `${lastItem.text} ${line.trim()}`.trim()
    }
    // Anything else (stray prose outside any release, a fenced-code-block line inside the trailing
    // "Earlier releases" appendix, …) is intentionally ignored: it belongs to no release and no
    // bullet, and silently dropping it is correct — there is nothing to attach it to.
  }

  flushCommits()
  if (current) releases.push(current)

  return releases
}
