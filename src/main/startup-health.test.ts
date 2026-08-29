import { describe, expect, it } from 'vitest'
import { createStartupHealthTracker } from './startup-health'

describe('startup health receipt', () => {
  it('records load, show, and renderer-loss transitions without private details', () => {
    const health = createStartupHealthTracker()

    health.record('window-created')
    health.record('load-started')
    health.record('load-finished')
    health.record('window-shown')
    expect(health.snapshot()).toMatchObject({
      lastEvent: 'window-shown',
      rendererHealthy: true,
      renderFailures: 0
    })

    health.record('renderer-gone')
    expect(health.snapshot()).toMatchObject({
      lastEvent: 'renderer-gone',
      rendererHealthy: false,
      renderFailures: 1
    })
  })

  it('keeps the event receipt bounded', () => {
    const health = createStartupHealthTracker(2)
    health.record('window-created')
    health.record('load-started')
    health.record('load-finished')
    expect(health.snapshot().events).toEqual(['load-started', 'load-finished'])
  })
})
