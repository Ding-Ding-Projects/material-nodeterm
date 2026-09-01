import { Component, type ReactNode } from 'react'

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
    return (
      <div className="app-error" role="alert">
        <div className="app-error__card">
          <h1 className="app-error__title">nodeterm hit an error and stopped drawing</h1>
          <p className="app-error__lead">
            Your terminals keep running: sessions live outside this window. Reload to draw the
            canvas again.
          </p>
          <pre className="app-error__message">{error.message}</pre>
          <div className="app-error__actions">
            <button
              type="button"
              className="mdx-btn mdx-btn--filled"
              onClick={() => window.location.reload()}
            >
              Reload window
            </button>
            <button
              type="button"
              className="mdx-btn mdx-btn--outlined"
              onClick={() => this.setState({ error: null })}
            >
              Try to continue
            </button>
          </div>
        </div>
      </div>
    )
  }
}
