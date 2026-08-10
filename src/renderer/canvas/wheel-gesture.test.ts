import { describe, expect, it } from 'vitest'
import { isMacTrackpadPan } from './wheel-gesture'

const gesture = (deltaMode: number, ctrlKey = false, metaKey = false) => ({
  deltaMode,
  ctrlKey,
  metaKey
})

describe('isMacTrackpadPan', () => {
  it('routes an unmodified macOS pixel gesture to canvas panning', () => {
    expect(isMacTrackpadPan(gesture(0), true)).toBe(true)
  })

  it('keeps pinch/Cmd-wheel and line-mode mouse wheels on the zoom path', () => {
    expect(isMacTrackpadPan(gesture(0, true), true)).toBe(false)
    expect(isMacTrackpadPan(gesture(0, false, true), true)).toBe(false)
    expect(isMacTrackpadPan(gesture(1), true)).toBe(false)
  })

  it('does not change wheel routing on other platforms', () => {
    expect(isMacTrackpadPan(gesture(0), false)).toBe(false)
  })
})
