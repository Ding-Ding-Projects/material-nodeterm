import { useCallback, useEffect, useState } from 'react'
import type { DocArticle } from '@shared/docs'

export type DocsBundleState =
  | { status: 'loading' }
  | { status: 'ready'; articles: readonly DocArticle[] }
  | { status: 'failed'; error: string }

/**
 * The bundled corpus is ~1.2 MB of markdown, so it is imported DYNAMICALLY: Rollup gives it its
 * own chunk, which the main renderer bundle never pays for and Server Edition never downloads
 * until somebody opens the documentation. Same reasoning as `lazyPanels.tsx` — this file exists
 * rather than an entry there because the split has to sit between the SCREEN and its DATA, not
 * around the screen: the screen itself is small, and it is the corpus that must not load eagerly.
 *
 * This is not a network fetch. In a packaged app the chunk is a file beside the renderer bundle;
 * in Server Edition it comes from the same origin already serving the page. Nothing here reaches a
 * third party, so the browser works with the network unplugged exactly as the contract requires.
 */
let cached: Promise<readonly DocArticle[]> | null = null

function loadBundle(): Promise<readonly DocArticle[]> {
  if (!cached) {
    cached = import('@shared/docs-data').then((m) => m.DOC_ARTICLES)
    // A failed load must not poison the cache forever — the retry below would then replay the
    // same rejected promise and the screen could never recover.
    cached.catch(() => {
      cached = null
    })
  }
  return cached
}

export function useDocsBundle(): { state: DocsBundleState; retry: () => void } {
  const [state, setState] = useState<DocsBundleState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    loadBundle().then(
      (articles) => {
        if (live) setState({ status: 'ready', articles })
      },
      (err: unknown) => {
        // Say what actually failed. "No documentation available" over a chunk that failed to load
        // is the same lie as an empty list over an unread directory.
        if (live) setState({ status: 'failed', error: err instanceof Error ? err.message : String(err) })
      }
    )
    return () => {
      live = false
    }
  }, [attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { state, retry }
}
