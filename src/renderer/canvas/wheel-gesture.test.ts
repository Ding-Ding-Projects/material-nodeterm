import { describe, expect, it } from 'vitest'
import { MacWheelGestureRouter } from './wheel-gesture'

const gesture = (deltaY: number, o: Partial<{
  deltaX: number; deltaMode: number; ctrlKey: boolean; metaKey: boolean; wheelDeltaY: number
}> = {}) => ({
  deltaY, deltaX: o.deltaX ?? 0, deltaMode: o.deltaMode ?? 0,
  ctrlKey: o.ctrlKey ?? false, metaKey: o.metaKey ?? false, wheelDeltaY: o.wheelDeltaY
})

describe('MacWheelGestureRouter', () => {
  it('keeps a notched macOS mouse wheel on the user-configured zoom path', () => {
    const router = new MacWheelGestureRouter()
    expect(router.shouldPan(gesture(100, { wheelDeltaY: -120 }), true, 1000)).toBe(false)
    expect(router.shouldPan(gesture(-100, { wheelDeltaY: 120 }), true, 1100)).toBe(false)
  })

  it('routes smooth two-finger trackpad scroll and its momentum to panning', () => {
    const router = new MacWheelGestureRouter()
    expect(router.shouldPan(gesture(6.25), true, 1000)).toBe(true)
    expect(router.shouldPan(gesture(75), true, 1080)).toBe(true)
    expect(router.shouldPan(gesture(75), true, 1400)).toBe(false)
  })

  it('captures trackpad panning over a terminal instead of leaking into its scrollback', () => {
    const router = new MacWheelGestureRouter()
    expect(router.destination(gesture(6.25), true, true, 1000)).toBe('manual-pan')
    expect(router.destination(gesture(6.25), true, false, 1400)).toBe('flow-pan')
    expect(router.destination(gesture(100, { wheelDeltaY: -120 }), true, true, 1800)).toBe('native')
  })

  it('does not manually pan over non-terminal native scrollers', () => {
    const router = new MacWheelGestureRouter()
    expect(router.destination(gesture(6.25), true, false, 1000)).toBe('flow-pan')
  })

  it('keeps pinch, Cmd-wheel, line-mode wheel and other platforms off the override', () => {
    const router = new MacWheelGestureRouter()
    expect(router.shouldPan(gesture(5, { ctrlKey: true }), true, 1000)).toBe(false)
    expect(router.shouldPan(gesture(5, { metaKey: true }), true, 1000)).toBe(false)
    expect(router.shouldPan(gesture(3, { deltaMode: 1 }), true, 1000)).toBe(false)
    expect(router.shouldPan(gesture(5), false, 1000)).toBe(false)
  })
})
