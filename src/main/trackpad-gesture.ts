/**
 * Main-process trackpad gesture ledger for canvas wheel routing.
 *
 * Chromium exposes both precise-pixel mouse wheels and trackpad input as wheel packets in the
 * renderer. The main process also receives macOS gesture edge events, so it can identify a
 * trackpad scroll or pinch without guessing from delta shape. This reducer turns those raw events
 * into a small stream of active-state transitions for the renderer.
 *
 * Scroll and pinch events can nest. A depth counter keeps an inner pinch from closing an outer
 * scroll, while an end received without a matching begin is ignored. The input-event hook runs
 * for every pointer packet, so only edge transitions cross IPC.
 */

const GESTURE_BEGIN = new Set(['gestureScrollBegin', 'gesturePinchBegin'])
const GESTURE_END = new Set(['gestureScrollEnd', 'gesturePinchEnd'])

export class TrackpadGestureLedger {
  private depth = 0

  /**
   * Feed one raw input-event type. Returns the new active state only when the ledger changes,
   * otherwise null for the common non-edge input events.
   */
  observe(type: string): boolean | null {
    if (GESTURE_BEGIN.has(type)) {
      this.depth += 1
      return this.depth === 1 ? true : null
    }
    if (GESTURE_END.has(type)) {
      if (this.depth === 0) return null
      this.depth -= 1
      return this.depth === 0 ? false : null
    }
    return null
  }
}
