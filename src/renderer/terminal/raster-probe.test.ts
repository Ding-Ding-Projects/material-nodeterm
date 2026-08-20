// @vitest-environment jsdom
import type { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __resetRasterProbeForTests,
  __resetRasterScaleForTests,
  patchTerminalRasterScale,
  type RasterProbeEntry,
  type RasterProbeForceResult
} from './raster-scale'
import { __resetWebglBudgetForTests } from './webgl-budget'

/**
 * A minimal stand-in for the exact xterm internals `patchTerminalRasterScale` reaches through —
 * same shape as `raster-scale.test.ts`'s harness, with `cols`/`rows` added because the probe reads
 * them directly off the terminal (xterm's own fields, never touched by the patch).
 */
class FakeCoreBrowserService {
  public constructor(private readonly _win: { devicePixelRatio: number }) {}
  public get dpr(): number {
    return this._win.devicePixelRatio
  }
}

interface FakeTerminal {
  element?: HTMLElement
  cols: number
  rows: number
  dispose(): void
  _core: {
    _coreBrowserService: FakeCoreBrowserService
    _charSizeService: { width: number }
    _renderService: { handleDevicePixelRatioChange(): void }
  }
}

const win = { devicePixelRatio: 1.5 }

function makeTerminal(
  measuredWidth = 8.6667,
  cols = 92,
  rows = 30
): { term: Terminal; fake: FakeTerminal } {
  const svc = new FakeCoreBrowserService(win)
  const fake: FakeTerminal = {
    cols,
    rows,
    dispose(): void {},
    _core: {
      _coreBrowserService: svc,
      _charSizeService: { width: measuredWidth },
      _renderService: {
        handleDevicePixelRatioChange(): void {
          // A well-behaved renderer: reflow the column count off the display grid the way
          // `addon-fit` would, so `after.cols` in a passing test can actually differ from
          // `before.cols` when the width narrows.
          fake.cols = Math.floor(80 / (fake._core._charSizeService.width || 1))
        }
      }
    }
  }
  return { term: fake as unknown as Terminal, fake }
}

function probe(): {
  list(): RasterProbeEntry[]
  force(scale: number): RasterProbeForceResult[]
} {
  return (window as unknown as Record<string, unknown>).__rasterProbe as {
    list(): RasterProbeEntry[]
    force(scale: number): RasterProbeForceResult[]
  }
}

beforeEach(() => {
  win.devicePixelRatio = 1.5
  document.body.innerHTML = ''
  __resetRasterScaleForTests()
  __resetWebglBudgetForTests()
  // NOT `__resetRasterProbeForTests()` here: `installRasterProbe()` runs exactly once, at module
  // load, and nothing re-runs it — that reset exists for a real caller tearing down a whole module
  // instance, not for per-test cleanup. `__resetRasterScaleForTests()` already empties `clients`,
  // which is all `list()`/`force()` read from, so the probe itself needs no reset between tests.
})

afterEach(() => {
  __resetRasterScaleForTests()
  __resetWebglBudgetForTests()
})

describe('window.__rasterProbe', () => {
  it('is installed as soon as the module loads, before any client registers', () => {
    expect(typeof probe().list).toBe('function')
    expect(typeof probe().force).toBe('function')
    expect(probe().list()).toEqual([])
  })

  it('list() reports one entry per registered client with the documented shape', () => {
    const { term } = makeTerminal(8.6667, 92, 30)
    patchTerminalRasterScale(term)

    const entries = probe().list()
    expect(entries).toHaveLength(1)
    const [entry] = entries
    expect(entry.dpr).toBe(1.5)
    expect(entry.applied).toBe(1.5) // patch installs at the display dpr before any camera zoom
    expect(entry.cols).toBe(92)
    expect(entry.rows).toBe(30)
    expect(entry.measuredCellWidth).toBeCloseTo(8.6667, 4)
    expect(entry.zoom).toBe(1) // no react-flow viewport ancestor in this harness
  })

  it('force() bypasses the static guard, drives the renderer, and records before/after', () => {
    const { term, fake } = makeTerminal(8.6667, 92, 30)
    patchTerminalRasterScale(term)

    // 1.75 is NOT a whole multiple of dpr 1.5 — `cellWidthIsStable` would refuse it, and
    // `applyTo` (the production path) would never call the renderer with it at all.
    const [result] = probe().force(1.75)

    expect(result.wouldBeStable).toBe(false)
    expect(result.before).toEqual({ cols: 92, measuredCellWidth: 8.6667 })
    expect(result.error).toBeNull()
    expect(result.after).not.toBeNull()
    // The fake renderer above reflows cols from the (still-8.6667, unchanged by the probe) width —
    // the point of this assertion is only that `after` was actually captured post-call, not that
    // it differs; the real reflow-or-not question needs the real xterm/addon-fit path this probe
    // exists to be pointed at.
    expect(result.after?.cols).toBe(fake.cols)
    // `applied` was left at the forced scale — this is a diagnostic override, not `applyTo`.
    expect(probe().list()[0].applied).toBe(1.75)
  })

  it('force() rolls back applied when the renderer throws, exactly as applyTo does', () => {
    const { term, fake } = makeTerminal(8.6667, 92, 30)
    fake._core._renderService.handleDevicePixelRatioChange = (): void => {
      throw new Error('boom')
    }
    patchTerminalRasterScale(term)

    const before = probe().list()[0].applied
    const [result] = probe().force(1.75)

    expect(result.error).toBe('boom')
    expect(result.after).toBeNull()
    expect(probe().list()[0].applied).toBe(before) // rolled back, never left at 1.75
  })

  it('force() ignores a non-positive or non-finite scale and touches nothing', () => {
    const { term } = makeTerminal()
    patchTerminalRasterScale(term)
    const before = probe().list()[0].applied

    expect(probe().force(0)).toEqual([])
    expect(probe().force(-1)).toEqual([])
    expect(probe().force(Number.NaN)).toEqual([])
    expect(probe().list()[0].applied).toBe(before)
  })

  it('__resetRasterProbeForTests removes the installed global', () => {
    const installed = (window as unknown as Record<string, unknown>).__rasterProbe
    expect(installed).toBeDefined()
    __resetRasterProbeForTests()
    expect((window as unknown as Record<string, unknown>).__rasterProbe).toBeUndefined()
    // `installRasterProbe()` runs exactly once at module load and nothing re-arms it, so restore
    // the same instance for any test that runs after this one in the same file/process.
    ;(window as unknown as Record<string, unknown>).__rasterProbe = installed
  })
})
