import { useEffect, useMemo, useRef } from 'react'
import { headingSlug, resolveDocLink, type DocArticle, type DocLinkTarget } from '@shared/docs'
import { renderMarkdown } from '../../lib/markdown'

interface DocsArticleViewProps {
  article: DocArticle
  /** Paths of every bundled article — the only thing that decides whether a link can be followed
   *  in-app or has to be reported as outside the bundle. */
  known: ReadonlySet<string>
  /** Where to scroll once this article has rendered: a heading slug, or null for the top. The
   *  nonce changes on every request, so re-following the SAME anchor scrolls again instead of
   *  reading as a dead link. */
  scrollTo: { hash: string | null; nonce: number }
  onNavigate: (target: DocLinkTarget) => void
}

const HEADINGS = 'h1, h2, h3, h4, h5, h6'

/**
 * One article, rendered through the app's ONE shared markdown renderer (`lib/markdown.ts` —
 * marked + DOMPurify). No second renderer, no marked extension: that pipeline also draws release
 * notes, the chat transcript and the editor preview, and none of those asked for docs behaviour.
 *
 * Everything docs-specific is a post-pass over the rendered DOM instead:
 *
 *  · heading ids, so a `#some-heading` link finds its target (marked 12 emits none by default);
 *  · a delegated click handler that intercepts EVERY anchor. This is not an optimisation — an
 *    un-intercepted relative href navigates the whole renderer to `file:///…/foo.md` in Electron
 *    or a 404 in Server Edition, which loses the canvas behind a white screen.
 */
export function DocsArticleView({
  article,
  known,
  scrollTo,
  onNavigate
}: DocsArticleViewProps): JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const html = useMemo(() => renderMarkdown(article.body), [article.body])

  // Stamp heading ids + label the links. Runs after every re-render of this article's HTML.
  useEffect(() => {
    const root = bodyRef.current
    if (!root) return
    const seen = new Map<string, number>()
    root.querySelectorAll<HTMLElement>(HEADINGS).forEach((h) => {
      const base = headingSlug(h.textContent ?? '')
      if (!base) return
      // Two headings with the same text would otherwise share an id and the second would be
      // unreachable — GitHub disambiguates with a numeric suffix, so links written against the
      // rendered page keep working here.
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      h.id = n === 0 ? base : `${base}-${n}`
    })
    root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
      const target = resolveDocLink(article.path, a.getAttribute('href') ?? '', known)
      a.dataset.docLink = target.kind
      // A hover title that says where a click actually goes — the href is a repo path and means
      // nothing to a reader.
      if (target.kind === 'article') a.title = `Open ${target.path} in the documentation browser`
      else if (target.kind === 'missing') a.title = `${target.path} is not part of the offline bundle`
      else if (target.kind === 'external') a.title = `Open ${target.href} in your browser`
    })
  }, [html, article.path, known])

  // Scroll: to the requested heading, else back to the top when the article changes. Without the
  // reset, following a link leaves the reader half-way down a page they have not seen.
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    if (!scrollTo.hash) {
      scroller.scrollTop = 0
      return
    }
    const el = bodyRef.current?.querySelector<HTMLElement>(`[id="${CSS.escape(scrollTo.hash)}"]`)
    if (el) scroller.scrollTop = el.offsetTop - 12
    // A hash with no matching heading (a stale anchor) leaves the scroll where it is rather than
    // jumping somewhere arbitrary; the article itself is still open and correct.
  }, [html, scrollTo.hash, scrollTo.nonce])

  const handleAnchor = (e: React.MouseEvent<HTMLDivElement>): void => {
    const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!a || !bodyRef.current?.contains(a)) return
    // Always: even an unrecognized href must not be allowed to navigate the renderer.
    e.preventDefault()
    // A modified click (new window / download / context) is not a plain activation — swallow the
    // default navigation but do not act, rather than guessing which of several intents was meant.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    onNavigate(resolveDocLink(article.path, a.getAttribute('href') ?? '', known))
  }

  return (
    <div className="md3-docs-article" ref={scrollRef}>
      <div className="md3-docs-article__path">{article.path}</div>
      <div
        ref={bodyRef}
        className="md3-docs-article__body"
        onClick={handleAnchor}
        // Middle-click fires `auxclick`, not `click`, and would open a new window on the raw href.
        onAuxClick={(e) => {
          if ((e.target as HTMLElement | null)?.closest?.('a[href]')) e.preventDefault()
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
