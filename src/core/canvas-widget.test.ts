import { describe, expect, it } from 'vitest'
import {
  WIDGET_DEFAULT_HEIGHT,
  WIDGET_DEFAULT_WIDTH,
  WIDGET_MIN_HEIGHT,
  WIDGET_MIN_WIDTH,
  clampWidgetBounds,
  defaultCanvasWidgetState,
  defaultWidgetBounds,
  mergeCanvasWidgetState,
  pruneCanvasWidgets,
  resolveOpenBounds,
  type ScreenWorkArea
} from './canvas-widget'

const WORK_AREA: ScreenWorkArea = { x: 0, y: 0, width: 1920, height: 1080 }

describe('defaultWidgetBounds', () => {
  it('centers the default size on the work area', () => {
    const b = defaultWidgetBounds(WORK_AREA)
    expect(b.width).toBe(WIDGET_DEFAULT_WIDTH)
    expect(b.height).toBe(WIDGET_DEFAULT_HEIGHT)
    expect(b.x).toBe(Math.round((1920 - WIDGET_DEFAULT_WIDTH) / 2))
    expect(b.y).toBe(Math.round((1080 - WIDGET_DEFAULT_HEIGHT) / 2))
  })

  it('shrinks to fit a work area smaller than the default size', () => {
    const tiny: ScreenWorkArea = { x: 100, y: 50, width: 300, height: 200 }
    const b = defaultWidgetBounds(tiny)
    expect(b.width).toBe(300)
    expect(b.height).toBe(200)
    expect(b.x).toBe(100)
    expect(b.y).toBe(50)
  })
})

describe('clampWidgetBounds', () => {
  it('leaves in-bounds bounds untouched', () => {
    const bounds = { x: 100, y: 100, width: 500, height: 400 }
    expect(clampWidgetBounds(bounds, WORK_AREA)).toEqual(bounds)
  })

  it('enforces the minimum size', () => {
    const b = clampWidgetBounds({ x: 0, y: 0, width: 10, height: 10 }, WORK_AREA)
    expect(b.width).toBe(WIDGET_MIN_WIDTH)
    expect(b.height).toBe(WIDGET_MIN_HEIGHT)
  })

  it('never opens a window fully off the left/top edge', () => {
    const b = clampWidgetBounds({ x: -10000, y: -10000, width: 480, height: 360 }, WORK_AREA)
    // At least MIN_VISIBLE_PX of the window must remain on-screen.
    expect(b.x + b.width).toBeGreaterThanOrEqual(WORK_AREA.x + 40)
    expect(b.y + b.height).toBeGreaterThanOrEqual(WORK_AREA.y + 40)
  })

  it('never opens a window fully off the right/bottom edge', () => {
    const b = clampWidgetBounds({ x: 100000, y: 100000, width: 480, height: 360 }, WORK_AREA)
    expect(b.x).toBeLessThanOrEqual(WORK_AREA.x + WORK_AREA.width - 40)
    expect(b.y).toBeLessThanOrEqual(WORK_AREA.y + WORK_AREA.height - 40)
  })

  it('clamps a size larger than the whole work area down to it', () => {
    const b = clampWidgetBounds({ x: 0, y: 0, width: 5000, height: 5000 }, WORK_AREA)
    expect(b.width).toBe(WORK_AREA.width)
    expect(b.height).toBe(WORK_AREA.height)
  })

  it('recovers a widget stranded on a monitor that no longer exists (smaller work area)', () => {
    // Saved on a 2560x1440 secondary display that has since been unplugged; the remaining
    // display is the 1920x1080 WORK_AREA above.
    const strandedOnUnpluggedMonitor = { x: 2200, y: 1300, width: 480, height: 360 }
    const b = clampWidgetBounds(strandedOnUnpluggedMonitor, WORK_AREA)
    expect(b.x + b.width).toBeGreaterThanOrEqual(WORK_AREA.x + 40)
    expect(b.x).toBeLessThanOrEqual(WORK_AREA.x + WORK_AREA.width - 40)
    expect(b.y + b.height).toBeGreaterThanOrEqual(WORK_AREA.y + 40)
    expect(b.y).toBeLessThanOrEqual(WORK_AREA.y + WORK_AREA.height - 40)
  })
})

describe('resolveOpenBounds', () => {
  it('centers at the default size when there is no saved state', () => {
    expect(resolveOpenBounds(undefined, WORK_AREA)).toEqual(defaultWidgetBounds(WORK_AREA))
  })

  it('restores saved bounds when they are still valid', () => {
    const saved = { x: 200, y: 150, width: 600, height: 500 }
    expect(resolveOpenBounds(saved, WORK_AREA)).toEqual(saved)
  })

  it('clamps saved bounds from a display that no longer exists', () => {
    const saved = { x: -9999, y: -9999, width: 480, height: 360 }
    const b = resolveOpenBounds(saved, WORK_AREA)
    expect(b.x).toBeGreaterThan(saved.x)
    expect(b.y).toBeGreaterThan(saved.y)
  })
})

describe('defaultCanvasWidgetState', () => {
  it('defaults always-on-top to OFF', () => {
    expect(defaultCanvasWidgetState()).toEqual({ alwaysOnTop: false })
  })
})

describe('mergeCanvasWidgetState', () => {
  it('starts from the default when there is no existing state', () => {
    expect(mergeCanvasWidgetState(undefined, { alwaysOnTop: true })).toEqual({ alwaysOnTop: true })
  })

  it('preserves fields the patch does not touch', () => {
    const existing = { alwaysOnTop: true, bounds: { x: 1, y: 2, width: 3, height: 4 } }
    const next = mergeCanvasWidgetState(existing, { alwaysOnTop: false })
    expect(next).toEqual({ alwaysOnTop: false, bounds: { x: 1, y: 2, width: 3, height: 4 } })
  })

  it('the always-on-top toggle round-trips independently of bounds', () => {
    let state = mergeCanvasWidgetState(undefined, { alwaysOnTop: true })
    state = mergeCanvasWidgetState(state, { bounds: { x: 10, y: 20, width: 500, height: 400 } })
    expect(state.alwaysOnTop).toBe(true)
    state = mergeCanvasWidgetState(state, { alwaysOnTop: false })
    expect(state).toEqual({ alwaysOnTop: false, bounds: { x: 10, y: 20, width: 500, height: 400 } })
  })
})

describe('pruneCanvasWidgets', () => {
  it('drops entries for node ids that no longer exist', () => {
    const widgets = {
      alive: { alwaysOnTop: true },
      gone: { alwaysOnTop: false }
    }
    const pruned = pruneCanvasWidgets(widgets, new Set(['alive']))
    expect(pruned).toEqual({ alive: { alwaysOnTop: true } })
  })

  it('returns the same reference when nothing needs pruning (cheap no-op write)', () => {
    const widgets = { alive: { alwaysOnTop: true } }
    expect(pruneCanvasWidgets(widgets, new Set(['alive']))).toBe(widgets)
  })

  it('never mutates the input map', () => {
    const widgets = { alive: { alwaysOnTop: true }, gone: { alwaysOnTop: false } }
    const before = { ...widgets }
    pruneCanvasWidgets(widgets, new Set(['alive']))
    expect(widgets).toEqual(before)
  })

  it('empties out entirely when no widget node survives', () => {
    const widgets = { gone: { alwaysOnTop: false } }
    expect(pruneCanvasWidgets(widgets, new Set())).toEqual({})
  })
})
