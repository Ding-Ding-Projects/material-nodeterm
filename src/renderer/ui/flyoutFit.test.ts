import { describe, expect, it } from 'vitest'
import { fitFlyout } from './flyoutFit'

const VIEW = { width: 1280, height: 800 }
/** A row in the middle of a menu on the left of the screen. */
const HOST = { left: 40, right: 300 }

describe('fitFlyout', () => {
  it('leaves a flyout that already fits exactly where the CSS put it', () => {
    const fit = fitFlyout({ top: 100, left: 300, width: 260, height: 300 }, HOST, VIEW)
    expect(fit).toEqual({ shiftY: 0, flipX: false })
  })

  it('slides up by exactly the overflow — the reported bug', () => {
    // The "Restart with profile…" list: opened at y=480, 380px tall, so it ends at 860 on an
    // 800px-tall window and its last entries were unreachable.
    const fit = fitFlyout({ top: 480, left: 300, width: 260, height: 380 }, HOST, VIEW)
    expect(fit.shiftY).toBe(480 + 380 - (800 - 6))
    expect(fit.flipX).toBe(false)
  })

  it('never slides so far up that the flyout leaves the top of the screen', () => {
    // Taller than the viewport: pin to the top margin rather than sliding the head off-screen.
    const fit = fitFlyout({ top: 200, left: 300, width: 260, height: 5000 }, HOST, VIEW)
    expect(fit.shiftY).toBe(200 - 6)
  })

  it('never pushes a flyout DOWN', () => {
    const fit = fitFlyout({ top: 10, left: 300, width: 260, height: 50 }, HOST, VIEW)
    expect(fit.shiftY).toBe(0)
  })

  it('flips to the row’s left when it would run off the right edge', () => {
    const host = { left: 1000, right: 1240 }
    const fit = fitFlyout({ top: 100, left: 1240, width: 300, height: 200 }, host, VIEW)
    expect(fit.flipX).toBe(true)
  })

  it('does NOT flip when the left side cannot hold it either', () => {
    // Trading a clipped right edge for a clipped left one is worse: the left edge hides the
    // labels, the right edge only hides the chevrons.
    const host = { left: 120, right: 360 }
    const fit = fitFlyout({ top: 100, left: 360, width: 1000, height: 200 }, host, VIEW)
    expect(fit.flipX).toBe(false)
  })

  it('applies both remedies at once in the bottom-right corner', () => {
    const host = { left: 1000, right: 1240 }
    const fit = fitFlyout({ top: 600, left: 1240, width: 300, height: 300 }, host, VIEW)
    expect(fit.shiftY).toBeGreaterThan(0)
    expect(fit.flipX).toBe(true)
  })

  it('honours a caller-supplied margin', () => {
    const tight = fitFlyout({ top: 500, left: 300, width: 260, height: 300 }, HOST, VIEW, 0)
    const loose = fitFlyout({ top: 500, left: 300, width: 260, height: 300 }, HOST, VIEW, 40)
    expect(loose.shiftY).toBeGreaterThan(tight.shiftY)
  })
})
