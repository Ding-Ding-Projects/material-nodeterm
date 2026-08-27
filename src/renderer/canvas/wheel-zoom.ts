/**
 * Pure wheel-zoom shaping for the canvas capture-phase wheel handler.
 *
 * High-resolution ratchet wheels can deliver one physical detent as several pixel-mode packets
 * a few milliseconds apart. A per-packet clamp lets those packets compound into an unexpectedly
 * large jump, so WheelZoomBurstLimiter spends one bounded budget across a short burst instead.
 */

/** One burst's total influence on zoom, in deltaY pixels. */
export const WHEEL_ZOOM_MAX_STEP = 50

/** Packets inside this interval share one budget. It is short enough not to merge deliberate
 * successive clicks, while covering the packet spread of a high-resolution detent. */
const BURST_WINDOW_MS = 40

/** Keep these aligned with the React Flow minZoom/maxZoom props in Canvas.tsx. */
const MIN_ZOOM = 0.01
const MAX_ZOOM = 2
const ZOOM_STEP_RATE = 0.01

export class WheelZoomBurstLimiter {
  private burstStart = Number.NEGATIVE_INFINITY
  private spent = 0

  /** Return the portion of deltaY that may influence zoom for this packet. */
  apply(deltaY: number, now: number): number {
    if (now - this.burstStart >= BURST_WINDOW_MS) {
      this.burstStart = now
      this.spent = 0
    }

    // The budget is absolute influence. A reversal after exhaustion is device jitter, not a
    // free counter-step, so it stays spent until the next burst.
    const remaining = WHEEL_ZOOM_MAX_STEP - this.spent
    const step = Math.sign(deltaY) * Math.min(Math.abs(deltaY), remaining)
    this.spent += Math.abs(step)
    return step || 0
  }
}

/** Validate a hand-edited settings value at the point where the canvas consumes it. */
export const clampWheelZoomSpeed = (speed: number | undefined): number =>
  typeof speed === 'number' && Number.isFinite(speed) ? Math.min(2, Math.max(0.2, speed)) : 1

/** Compute the bounded next zoom for one already-limited wheel step. */
export const nextWheelZoom = (
  zoom: number,
  deltaY: number,
  speed: number | undefined
): number =>
  Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, zoom * Math.exp(-deltaY * ZOOM_STEP_RATE * clampWheelZoomSpeed(speed)))
  )
