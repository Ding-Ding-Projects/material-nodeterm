type WheelGesture = Pick<WheelEvent, 'ctrlKey' | 'metaKey' | 'deltaMode'>

/** macOS trackpads emit unmodified pixel-wheel events; pinch adds ctrlKey in Chromium. */
export function isMacTrackpadPan(event: WheelGesture, mac: boolean): boolean {
  return mac && !event.ctrlKey && !event.metaKey && event.deltaMode === 0
}
