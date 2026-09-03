import { Component, type ReactNode } from 'react'
import { copy, fact, mapOwnedSentence } from '../lib/personalVocabulary/ownedCopy'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'

interface State {
  error: Error | null
}

/**
 * The LAST error boundary in the tree. React unmounts the whole root when a render or effect
 * throws with no boundary above it, and on this app that reads as a frozen black screen — the
 * canvas background with nothing on it and nothing to click. `withNodeBoundary` isolates one
 * node; this catches everything else (a canvas load effect, a dialog, a panel) and shows a
 * recovery card with the message and a reload action instead.
 *
 * Deliberately hook-free and store-free: a boundary that reads a store can throw while rendering
 * its own fallback, which is the one failure it exists to prevent.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error('[app error]', error)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return <AppErrorFallback error={error} onContinue={() => this.setState({ error: null })} />
  }
}

/** Hook-capable fallback kept below the class boundary so the boundary itself remains resilient. */
function AppErrorFallback({ error, onContinue }: { error: Error; onContinue: () => void }): React.JSX.Element {
  const map = useVocabularyMapper()
  const title = mapOwnedSentence(map, [copy('nodeterm hit an error and stopped drawing')])
  const lead = mapOwnedSentence(map, [copy('Your terminals keep running: sessions live outside this window. Reload to draw the canvas again.')])
  const message = mapOwnedSentence(map, [fact(error.message)])
  const reload = map('Reload window')
  const continueLabel = map('Try to continue')
  return (
      <div className="app-error" role="alert">
        <div className="app-error__card">
          <h1 className="app-error__title">{title}</h1>
          <p className="app-error__lead">{lead}</p>
          <pre className="app-error__message">{message}</pre>
          <div className="app-error__actions">
            <button
              type="button"
              className="mdx-btn mdx-btn--filled"
              onClick={() => window.location.reload()}
            >
              {reload}
            </button>
            <button
              type="button"
              className="mdx-btn mdx-btn--outlined"
              onClick={onContinue}
            >
              {continueLabel}
            </button>
          </div>
        </div>
      </div>
    )
}
