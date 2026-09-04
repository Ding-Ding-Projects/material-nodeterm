type WheelGesture = Pick<WheelEvent, 'ctrlKey' | 'metaKey' | 'deltaMode' | 'deltaX' | 'deltaY'> & {
  wheelDeltaY?: number
}

export type WheelDestination = 'flow-pan' | 'native'

/** One shared decision for the router and React Flow's own panOnScroll setting. */
export const trackpadRoutingEnabled = (trackpadPan: boolean): boolean => trackpadPan

const TRACKPAD_SEQUENCE_MS = 500
const MOUSE_WHEEL_NOTCH = 120
const LARGE_PIXEL_DELTA = 40

/**
 * Chromium reports trackpads and precise-pixel mice through the same wheel API. This bounded
 * heuristic keeps one physical smooth gesture classified consistently, while a standard notched
 * wheel remains on the configured zoom path.
 */
export class WheelGestureRouter {
  private trackpadUntil = 0

  shouldPan(event: WheelGesture, enabled: boolean, now = performance.now()): boolean {
    if (!enabled || event.ctrlKey || event.metaKey || event.deltaMode !== 0) return false
    if (now <= this.trackpadUntil) {
      this.trackpadUntil = now + TRACKPAD_SEQUENCE_MS
      return true
    }
    const legacyDelta = Math.abs(event.wheelDeltaY ?? 0)
    const mouseNotch = legacyDelta >= MOUSE_WHEEL_NOTCH && legacyDelta % MOUSE_WHEEL_NOTCH === 0
    if (mouseNotch) {
      this.trackpadUntil = 0
      return false
    }
    const smooth =
      event.deltaX !== 0 ||
      !Number.isInteger(event.deltaX) ||
      !Number.isInteger(event.deltaY) ||
      Math.abs(event.deltaY) < LARGE_PIXEL_DELTA
    if (smooth) {
      this.trackpadUntil = now + TRACKPAD_SEQUENCE_MS
      return true
    }
    return false
  }

  destination(
    event: WheelGesture,
    enabled: boolean,
    overNativeScrollable: () => boolean,
    now = performance.now()
  ): WheelDestination {
    if (!this.shouldPan(event, enabled, now)) return 'native'
    return overNativeScrollable() ? 'native' : 'flow-pan'
  }
}
