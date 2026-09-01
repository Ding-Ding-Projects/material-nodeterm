import { describe, expect, it } from 'vitest'
import { WheelGestureRouter, trackpadRoutingEnabled } from './wheel-gesture'

const gesture = (
  deltaY: number,
  options: Partial<{
    deltaX: number
    deltaMode: number
    ctrlKey: boolean
    metaKey: boolean
    wheelDeltaY: number
  }> = {}
) => ({
  deltaX: 0,
  deltaY,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  ...options
})

describe('WheelGestureRouter', () => {
  it('keeps a standard notched mouse wheel on the configured zoom path', () => {
    const router = new WheelGestureRouter()
    expect(router.shouldPan(gesture(100, { wheelDeltaY: -120 }), true, 1000)).toBe(false)
    expect(router.shouldPan(gesture(-100, { wheelDeltaY: 120 }), true, 1100)).toBe(false)
  })

  it('routes a smooth two-finger scroll and its momentum to panning', () => {
    const router = new WheelGestureRouter()
    expect(router.shouldPan(gesture(6.25), true, 1000)).toBe(true)
    expect(router.shouldPan(gesture(75), true, 1080)).toBe(true)
    expect(router.shouldPan(gesture(75), true, 1700)).toBe(false)
  })

  it('does not reclassify a quantized packet inside an active smooth gesture', () => {
    const router = new WheelGestureRouter()
    expect(router.shouldPan(gesture(4.5), true, 1000)).toBe(true)
    expect(router.shouldPan(gesture(100, { wheelDeltaY: -120 }), true, 1150)).toBe(true)
  })

  it('keeps scrolling native over terminal and editor surfaces', () => {
    const router = new WheelGestureRouter()
    expect(router.destination(gesture(6.25), true, () => true, 1000)).toBe('native')
    expect(router.destination(gesture(6.25), true, () => false, 1100)).toBe('flow-pan')
  })

  it('honors the persisted escape hatch', () => {
    expect(trackpadRoutingEnabled(true)).toBe(true)
    expect(trackpadRoutingEnabled(false)).toBe(false)
    const router = new WheelGestureRouter()
    expect(router.shouldPan(gesture(6.25), false, 1000)).toBe(false)
  })

  it('leaves pinch, modifier-wheel, and line-mode input on the native zoom path', () => {
    const router = new WheelGestureRouter()
    expect(router.shouldPan(gesture(5, { ctrlKey: true }), true, 1000)).toBe(false)
    expect(router.shouldPan(gesture(5, { metaKey: true }), true, 1000)).toBe(false)
    expect(router.shouldPan(gesture(3, { deltaMode: 1 }), true, 1000)).toBe(false)
  })
})
