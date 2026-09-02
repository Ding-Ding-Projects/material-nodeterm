// The in-app offline documentation browser — every bundled `docs/` article, readable with the
// network unplugged, searchable, and with article-to-article links that land on the linked article
// instead of throwing the reader out to a browser.
//
// The corpus is compiled into `src/shared/docs-data.ts` at build time by
// `scripts/build-docs-bundle.mjs`, because `docs/` is not in package.json's `build.files` (so it
// does not exist in a packaged app) and Server Edition runs in a browser with no filesystem. It is
// imported lazily (see `docs/useDocsBundle.ts`) so its ~1.2 MB lands in its own chunk.
// `scripts/check-docs-bundle.mjs` fails `npm run build` when an article on disk is missing from
// that bundle. Full write-up: docs/features/help/in-app-documentation.md.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../ui/md3/Button'
import { SearchField } from '../ui/md3/SearchField'
import {
  groupArticles,
  searchArticles,
  type DocArticle,
  type DocLinkTarget,
  type DocSearchHit
} from '@shared/docs'
import { MAX_FILTER_CANDIDATE_LENGTH } from '../lib/regex/engine'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'
import { REPO_URL } from '../lib/bugReport'
import { IconExternal } from './icons'
import { DocsArticleView } from './docs/DocsArticleView'
import { useDocsBundle } from './docs/useDocsBundle'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { copy, fact, mapOwnedSentence } from '../lib/personalVocabulary/ownedCopy'

export function docsArticleCountSegments(count: number, suffix: string) {
  return [fact(String(count)), copy(` ${suffix}`)]
}

/** Re-running a ~25k-line scan on every keystroke is the difference between instant and janky, so
 *  the search settles first. Short enough that it still reads as live typing. */
const SEARCH_DEBOUNCE_MS = 180

/** The article the browser opens on: the features index is the tree's own front door. Falls back
 *  to whatever came first if that file is ever renamed — never to a blank pane. */
const DEFAULT_ARTICLE = 'docs/features/README.md'

/** Where a doc that is real but outside the bundle can still be read. */
function repoBlobUrl(path: string): string {
  return `${REPO_URL}/blob/main/${path}`
}

const EMPTY_ARTICLES: readonly DocArticle[] = []

/** A scroll request. The nonce is what makes clicking the SAME anchor twice scroll twice: a bare
 *  string is unchanged the second time, so the effect never re-runs and the link reads as dead. */
interface ScrollRequest {
  hash: string | null
  nonce: number
}

export function DocsBrowser({ initialPath }: { initialPath?: string } = {}): JSX.Element {
  const vocab = useVocabularyMapper()
  const { state, retry } = useDocsBundle()
  const articles = state.status === 'ready' ? state.articles : EMPTY_ARTICLES

  const search = useRegexSearchField()
  const searchInputRef = useRef<HTMLInputElement>(null)

  const [path, setPath] = useState<string | null>(null)
  const [scroll, setScroll] = useState<ScrollRequest>({ hash: null, nonce: 0 })
  /** Every article opened before this one, newest last — so Back walks a real trail rather than
   *  guessing at a parent. A docs tree is a graph, not a hierarchy; there is no "up". */
  const [trail, setTrail] = useState<string[]>([])
  /** A link that pointed outside the bundle. Shown as an honest notice with a route forward, which
   *  is the whole difference between "we can't show this" and a click that does nothing. */
  const [outside, setOutside] = useState<string | null>(null)
  /** True while the reader is looking at search results rather than an article. */
  const [showResults, setShowResults] = useState(false)

  // The trail needs the path being LEFT, and reading it from a ref keeps `openArticle` free of
  // both a `path` dependency and a setState call nested inside another setState updater.
  const pathRef = useRef<string | null>(null)
  pathRef.current = path

  const byPath = useMemo(() => new Map(articles.map((a) => [a.path, a])), [articles])
  const known = useMemo(() => new Set(articles.map((a) => a.path)), [articles])
  const sections = useMemo(() => groupArticles(articles), [articles])

  // Land on a real article as soon as the bundle arrives.
  useEffect(() => {
    if (path !== null || articles.length === 0) return
    setPath(initialPath && byPath.has(initialPath) ? initialPath : byPath.has(DEFAULT_ARTICLE) ? DEFAULT_ARTICLE : articles[0].path)
  }, [articles, byPath, initialPath, path])

  // --- search ---------------------------------------------------------------------------------
  // `test` changes identity on every keystroke, so it is read through a ref when the debounce
  // fires rather than being a dependency — otherwise the memo recomputes immediately and the
  // debounce buys nothing.
  const testRef = useRef(search.test)
  testRef.current = search.test
  const lowerCache = useMemo(() => new Map<string, string>(), [articles])
  const plainQuery = search.mode === 'text' ? search.query.trim().toLowerCase() : ''
  const [results, setResults] = useState<DocSearchHit[] | null>(null)

  useEffect(() => {
    if (!search.active) {
      setResults(null)
      return
    }
    const timer = setTimeout(() => {
      // A cheap whole-body reject in plain-text mode: a native `includes` over the bundled bodies beats a
      // per-line predicate over ~25k lines by orders of magnitude, and it can only skip articles
      // the line scan would also have found nothing in. Regex mode passes no prefilter — there is
      // no substring it could safely test for.
      const prefilter = plainQuery
        ? (a: DocArticle): boolean => {
            let lower = lowerCache.get(a.path)
            if (lower === undefined) {
              lower = a.body.toLowerCase()
              lowerCache.set(a.path, lower)
            }
            return lower.includes(plainQuery)
          }
        : undefined
      setResults(
        searchArticles(articles, testRef.current, {
          // The clamp the shared matcher applies, passed in rather than duplicated — one source of
          // truth, so a change to `MAX_FILTER_CANDIDATE_LENGTH` cannot silently start hiding
          // matches past it. See `splitSearchWindows`.
          windowSize: MAX_FILTER_CANDIDATE_LENGTH,
          overlap: Math.floor(MAX_FILTER_CANDIDATE_LENGTH / 2),
          prefilter
        })
      )
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [articles, lowerCache, plainQuery, search.active, search.value, search.mode, search.flags])

  // Typing opens the results view; clearing the field returns to whatever was being read.
  useEffect(() => {
    if (search.active) setShowResults(true)
    else setShowResults(false)
  }, [search.active])

  const matchedPaths = useMemo(
    () => (results === null ? null : new Set(results.map((h) => h.path))),
    [results]
  )

  // --- navigation -----------------------------------------------------------------------------
  const openArticle = useCallback((next: string, nextHash: string | null, pushTrail: boolean) => {
    const leaving = pathRef.current
    if (pushTrail && leaving && leaving !== next) setTrail((t) => [...t, leaving])
    setOutside(null)
    setShowResults(false)
    setPath(next)
    setScroll((s) => ({ hash: nextHash, nonce: s.nonce + 1 }))
  }, [])

  const goBack = useCallback(() => {
    setTrail((t) => {
      if (t.length === 0) return t
      const previous = t[t.length - 1]
      setPath(previous)
      setScroll((s) => ({ hash: null, nonce: s.nonce + 1 }))
      setOutside(null)
      setShowResults(false)
      return t.slice(0, -1)
    })
  }, [])

  const follow = useCallback(
    (target: DocLinkTarget) => {
      switch (target.kind) {
        case 'article':
          openArticle(target.path, target.hash, true)
          return
        case 'anchor':
          // Same article, different heading — no trail entry: Back should leave the article, not
          // undo a scroll. The nonce is what lets the same anchor be clicked twice.
          setScroll((s) => ({ hash: target.hash, nonce: s.nonce + 1 }))
          return
        case 'external':
          // App-global, like the clipboard: this screen is a root-level drawer, so
          // `window.nodeTerminal` is the VIEWER's preload -- the right machine to open a URL on
          // even when the active project is a relay tab.
          window.nodeTerminal.shell.openExternal(target.href)
          return
        case 'missing':
          setOutside(target.path)
      }
    },
    [openArticle]
  )

  const article = path === null ? undefined : byPath.get(path)

  // --- render ---------------------------------------------------------------------------------
  if (state.status === 'loading') {
    return (
      <div className="md3-docs" data-screen-label="Documentation" data-easter-surface="documentation" aria-label={vocab('Documentation')}>
        <div className="md3-docs__pending">{vocab('Loading documentation…')}</div>
      </div>
    )
  }

  if (state.status === 'failed') {
    return (
      <div className="md3-docs" data-screen-label="Documentation" data-easter-surface="documentation" aria-label={vocab('Documentation')}>
        <div className="md3-docs__pending md3-docs__pending--error" role="alert">
          <div>{vocab('The documentation bundle failed to load.')}</div>
          <div className="md3-docs__pending-detail">{state.error}</div>
          <div className="md3-docs__pending-actions">
            <Button size="small" className="md3-docs__button" onClick={retry}>
              Try again
            </Button>
            <Button
              size="small"
              variant="tonal"
              className="md3-docs__button"
              onClick={() => window.nodeTerminal.shell.openExternal(`${REPO_URL}/tree/main/docs`)}
            >
              Read it on GitHub
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="md3-docs" data-screen-label="Documentation" data-easter-surface="documentation" aria-label={vocab('Documentation')}>
      <div className="md3-docs__head">
        <div className="md3-docs__heading">
          <div className="md3-docs__title">{vocab('Documentation')}</div>
          <div className="md3-docs__subtitle">
            {mapOwnedSentence(vocab, docsArticleCountSegments(articles.length, `article${articles.length === 1 ? '' : 's'}, bundled with this build — no network needed`))}
          </div>
        </div>
        <SearchField
          ref={searchInputRef}
          className="md3-docs__search"
          dense
          placeholder={search.mode === 'regex' ? 'Search titles and content (regex)…' : 'Search titles and content…'}
          value={search.value}
          onChange={(e) => search.setValue(e.target.value)}
          aria-label="Search documentation"
          trailingSlot={<AnchoredRegexBuilder
            search={search}
            fieldRef={searchInputRef}
            label="Regex — Documentation search"
          />}
        />
      </div>
      {search.error && (
        <div className="md3-docs__error" role="alert">
          {search.error}
        </div>
      )}

      <div className="md3-docs__body">
        <nav className="md3-docs__nav" aria-label={vocab('Documentation contents')}>
          {sections.map((section) => {
            const visible =
              matchedPaths === null ? section.articles : section.articles.filter((a) => matchedPaths.has(a.path))
            if (visible.length === 0) return null
            return (
              <div className="md3-docs__section" key={section.label}>
                <div className="md3-docs__section-label">{vocab(section.label)}</div>
                {visible.map((a) => (
                  <Button variant="outlined" size="small" vocabularyMode="factual"
                    key={a.path}
                    type="button"
                    className={`md3-docs__nav-item${
                      a.path === path && !showResults ? ' md3-docs__nav-item--active' : ''
                    }`}
                    aria-current={a.path === path && !showResults ? 'page' : undefined}
                    onClick={() => openArticle(a.path, null, true)}
                  >
                    {a.title}
                  </Button>
                ))}
              </div>
            )
          })}
          {matchedPaths !== null && matchedPaths.size === 0 && (
            <div className="md3-docs__nav-empty">{vocab('No article matches this search.')}</div>
          )}
        </nav>

        <div className="md3-docs__main">
          <div className="md3-docs__crumbs">
            <Button
              variant="text"
              size="small"
              className="md3-docs__button md3-docs__button--quiet"
              disabled={trail.length === 0}
              onClick={goBack}
              title={trail.length === 0 ? 'Nothing to go back to yet' : 'Back to the previous article'}
            >
              ← Back
            </Button>
            {article && (
              <Button
                variant="text"
                size="small"
                className="md3-docs__button md3-docs__button--quiet"
                leadingIcon={<IconExternal />}
                onClick={() => window.nodeTerminal.shell.openExternal(repoBlobUrl(article.path))}
                title="Open this article on GitHub"
              >
                View source
              </Button>
            )}
          </div>

          {outside && (
            <div className="md3-docs__notice" role="status">
              <span>
                <strong>{outside}</strong> is part of the repository but not of the offline
                documentation bundle.
              </span>
              <Button
                size="small"
                variant="tonal"
                className="md3-docs__button"
                onClick={() => window.nodeTerminal.shell.openExternal(repoBlobUrl(outside))}
              >
                Open on GitHub
              </Button>
              <Button
                variant="text"
                size="small"
                className="md3-docs__button md3-docs__button--quiet"
                onClick={() => setOutside(null)}
              >
                Dismiss
              </Button>
            </div>
          )}

          {showResults ? (
            <DocsResults
              results={results}
              onOpen={(hit) => openArticle(hit.path, null, true)}
            />
          ) : article ? (
            <DocsArticleView article={article} known={known} scrollTo={scroll} onNavigate={follow} />
          ) : (
            <div className="md3-docs__pending">{vocab('This build bundled no documentation.')}</div>
          )}
        </div>
      </div>
    </div>
  )
}

function DocsResults({
  results,
  onOpen
}: {
  results: DocSearchHit[] | null
  onOpen: (hit: DocSearchHit) => void
}): JSX.Element {
  const vocab = useVocabularyMapper()
  // `null` is "the scan has not settled yet", which is a different fact from "nothing matched" —
  // reporting the second while the first is true is how a search reads as broken.
  if (results === null) return <div className="md3-docs__pending">{vocab('Searching…')}</div>
  if (results.length === 0) return <div className="md3-docs__pending">{vocab('Nothing matches this search.')}</div>

  return (
    <div className="md3-docs__results">
      <div className="md3-docs__results-count">
        {mapOwnedSentence(vocab, docsArticleCountSegments(results.length, `article${results.length === 1 ? '' : 's'} match`))}
      </div>
      {results.map((hit) => (
        <Button variant="outlined" size="small" vocabularyMode="factual" key={hit.path} type="button" className="md3-docs__result" onClick={() => onOpen(hit)}>
          <div className="md3-docs__result-head">
            <span className="md3-docs__result-title">{hit.title}</span>
            <span className="md3-docs__result-section">{hit.section}</span>
            {hit.matchCount > 0 && (
              <span className="md3-docs__result-count">
                {hit.matchCount}
                {hit.truncated ? '+' : ''} line{hit.matchCount === 1 && !hit.truncated ? '' : 's'}
              </span>
            )}
          </div>
          {hit.snippets.map((s) => (
            <div className="md3-docs__snippet" key={s.line}>
              <span className="md3-docs__snippet-line">{s.line}</span>
              <span className="md3-docs__snippet-text">{s.text}</span>
            </div>
          ))}
          {hit.snippets.length === 0 && (
            <div className="md3-docs__snippet md3-docs__snippet--title">{vocab('Title match')}</div>
          )}
        </Button>
      ))}
    </div>
  )
}
