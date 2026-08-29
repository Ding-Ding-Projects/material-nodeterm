export type StartupHealthEvent =
  | 'window-created'
  | 'load-started'
  | 'load-finished'
  | 'load-failed'
  | 'renderer-gone'
  | 'unresponsive'
  | 'responsive'
  | 'window-shown'

export interface StartupHealthSnapshot {
  events: StartupHealthEvent[]
  lastEvent: StartupHealthEvent | null
  rendererHealthy: boolean
  renderFailures: number
}

export interface StartupHealthTracker {
  record(event: StartupHealthEvent): StartupHealthSnapshot
  snapshot(): StartupHealthSnapshot
}

/**
 * Keep a bounded, path-free startup receipt in memory. A packaged app can otherwise show a blank
 * window after the first frame while its only useful evidence disappears with the renderer.
 */
export function createStartupHealthTracker(maxEvents = 32): StartupHealthTracker {
  const limit = Number.isSafeInteger(maxEvents) && maxEvents > 0 ? maxEvents : 32
  let events: StartupHealthEvent[] = []
  let rendererHealthy = false
  let renderFailures = 0

  const record = (event: StartupHealthEvent): StartupHealthSnapshot => {
    events = [...events, event].slice(-limit)
    if (event === 'load-finished' || event === 'responsive' || event === 'window-shown') {
      rendererHealthy = true
    }
    if (event === 'load-failed' || event === 'renderer-gone') {
      rendererHealthy = false
      renderFailures += 1
    }
    return snapshot()
  }

  const snapshot = (): StartupHealthSnapshot => ({
    events: [...events],
    lastEvent: events.at(-1) ?? null,
    rendererHealthy,
    renderFailures
  })

  return { record, snapshot }
}
