type WheelGesture = Pick<WheelEvent, 'ctrlKey' | 'metaKey' | 'deltaMode' | 'deltaX' | 'deltaY'> & {
  wheelDeltaY?: number
}

export type MacWheelDestination = 'flow-pan' | 'native'

/**
 * Whether the trackpad override is live at all — the `mac` argument every method below takes.
 *
 * Two reasons it must be one named expression rather than an `isMac &&` at each call site: the
 * router and React Flow's own `panOnScroll` have to agree exactly (disagreeing means a gesture
 * that neither of them pans), and `trackpadPan` is the user's ESCAPE HATCH. Turning it off
 * restores the pre-router behavior on macOS — `wheelZoom` alone decides, and a plain wheel zooms.
 * On the desktop, main-process gesture reporting identifies a precise-pixel mouse as a fact, so
 * it reaches wheel zoom while the trackpad keeps panning. The hatch remains the recourse where
 * reporting does not exist, such as the Server Edition browser tab, whose heuristics still
 * classify such a mouse as a trackpad.
 */
export const trackpadRoutingEnabled = (mac: boolean, trackpadPan: boolean): boolean =>
  mac && trackpadPan

const TRACKPAD_SEQUENCE_MS = 500
const MOUSE_WHEEL_NOTCH = 120
const LARGE_PIXEL_DELTA = 40

/** Pixel mode alone is not a device identity: Chromium uses it for trackpads and many mice. */
export class MacWheelGestureRouter {
  private trackpadUntil = 0
  private gestureActive = false
  private gestureEndedAt = Number.NEGATIVE_INFINITY

  /**
   * When true, the desktop main process supplies trackpad gesture edge facts. The browser keeps
   * this false because it cannot observe the raw input stream and must retain the heuristic path.
   */
  constructor(private readonly gestureReporting = false) {}

  /** Record a main-process gesture edge. The optional clock keeps the reducer deterministic. */
  noteGesture(active: boolean, now = performance.now()): void {
    this.gestureActive = active
    if (!active) this.gestureEndedAt = now
  }

  shouldPan(event: WheelGesture, mac: boolean, now = performance.now()): boolean {
    if (!mac || event.ctrlKey || event.metaKey || event.deltaMode !== 0) return false
    if (this.gestureReporting) {
      // A few bare mouseWheel packets can occupy the touch-to-momentum gap. Keep the gesture open
      // for the same bounded window used by the legacy heuristic, then treat reported silence as
      // a wheel mouse even when its deltas look trackpad-smooth.
      if (this.gestureActive || now - this.gestureEndedAt < TRACKPAD_SEQUENCE_MS) return true
      return false
    }
    // Device identity is sticky for one physical gesture. Chromium can quantize a later
    // trackpad/momentum event to wheelDeltaY=120; treating that single packet as a mouse notch
    // hands it to wheelZoom and creates the observed one-frame zoom inside an otherwise pure pan.
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

  /**
   * `overNativeScrollable` is a THUNK, not a boolean: the caller answers it with a DOM ancestor
   * walk and this runs on every wheel packet (~120 Hz through a trackpad pan), so it must not be
   * paid for the packets that never reach the question — a non-trackpad wheel is answered by
   * `shouldPan` alone.
   */
  destination(
    event: WheelGesture,
    mac: boolean,
    overNativeScrollable: () => boolean,
    now = performance.now()
  ): MacWheelDestination {
    if (!this.shouldPan(event, mac, now)) return 'native'
    return overNativeScrollable() ? 'native' : 'flow-pan'
  }
}
