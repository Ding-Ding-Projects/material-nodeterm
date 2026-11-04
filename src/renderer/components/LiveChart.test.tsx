// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LiveChart, chartDomain, smoothPath, type LiveChartStatus, type LivePoint } from './LiveChart'
import { MEM_HISTORY_MAX, appendMemSample, memUsedPct } from '../state/sessionMemory'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const TEXT = { loading: 'Measuring', paused: 'Not live', stale: 'Old', unavailable: 'Nothing yet' }
const POINTS: LivePoint[] = [
  { t: 1_000, v: 40 },
  { t: 31_000, v: 45 },
  { t: 61_000, v: 52 }
]

function render(points: LivePoint[], status: LiveChartStatus): void {
  act(() =>
    root.render(
      <LiveChart points={points} status={status} label="RAM in use" format={(v) => `${v}%`} domain={[0, 100]} statusText={TEXT} />
    )
  )
}

describe('LiveChart', () => {
  it('draws the line, area and newest point with a pulse only while live', () => {
    render(POINTS, 'live')
    expect(host.querySelector('.md3-live-chart__line')?.getAttribute('d')).toMatch(/^M/)
    expect(host.querySelector('.md3-live-chart__area')).not.toBeNull()
    expect(host.querySelector('.md3-live-chart__pulse')).not.toBeNull()
    expect(host.querySelector('.md3-live-chart__badge')?.textContent).toBe('52%')
    expect(host.querySelector('svg')?.getAttribute('aria-label')).toBe('RAM in use: 52%')
  })

  it('a stale or paused series keeps its values but never pulses and says why', () => {
    for (const status of ['stale', 'paused'] as const) {
      render(POINTS, status)
      expect(host.querySelector('.md3-live-chart__pulse')).toBeNull()
      expect(host.querySelector('.md3-live-chart__caption')?.textContent).toBe(TEXT[status])
      expect(host.querySelector('svg')?.getAttribute('aria-label')).toContain(TEXT[status])
    }
  })

  it('no points shows loading or unavailable, never an invented value', () => {
    render([], 'loading')
    expect(host.querySelector('.md3-live-chart__badge')).toBeNull()
    expect(host.querySelector('.md3-live-chart__line')).toBeNull()
    expect(host.querySelector('.md3-live-chart__caption')?.textContent).toBe('Measuring')
    render([], 'unavailable')
    expect(host.querySelector('.md3-live-chart__caption')?.textContent).toBe('Nothing yet')
    expect(host.querySelector('svg')?.getAttribute('tabindex')).toBe('-1')
  })

  it('arrow keys scrub through the real points and Escape returns to the newest', () => {
    render(POINTS, 'live')
    const svg = host.querySelector('svg') as SVGSVGElement
    const key = (k: string) => act(() => svg.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))
    key('ArrowLeft')
    expect(host.querySelector('.md3-live-chart__badge')?.textContent).toBe('45%')
    expect(host.querySelector('.md3-live-chart__crosshair')).not.toBeNull()
    key('Home')
    expect(host.querySelector('.md3-live-chart__badge')?.textContent).toBe('40%')
    key('Escape')
    expect(host.querySelector('.md3-live-chart__badge')?.textContent).toBe('52%')
    expect(host.querySelector('.md3-live-chart__crosshair')).toBeNull()
  })

  it('smoothPath passes through every point and chartDomain never collapses', () => {
    const d = smoothPath([
      [0, 10],
      [50, 20],
      [100, 5]
    ])
    expect(d.startsWith('M0,10')).toBe(true)
    expect(d).toContain('50,20')
    expect(d.endsWith('100,5')).toBe(true)
    const [lo, hi] = chartDomain([{ t: 0, v: 7 }])
    expect(hi).toBeGreaterThan(lo)
  })
})

describe('RAM history', () => {
  it('records the used share and refuses a reading that cannot support one', () => {
    expect(memUsedPct({ availableMb: 25, totalMb: 100 })).toBe(75)
    expect(memUsedPct({ availableMb: 25, totalMb: 0 })).toBeNull()
    expect(memUsedPct(null)).toBeNull()
    const h = appendMemSample([], { availableMb: 50, totalMb: 100 }, 1)
    expect(h).toEqual([{ t: 1, usedPct: 50 }])
    expect(appendMemSample(h, null, 2)).toBe(h)
  })

  it('keeps only the newest readings', () => {
    let h: ReturnType<typeof appendMemSample> = []
    for (let i = 0; i < MEM_HISTORY_MAX + 5; i++) h = appendMemSample(h, { availableMb: i % 100, totalMb: 100 }, i)
    expect(h.length).toBe(MEM_HISTORY_MAX)
    expect(h[0].t).toBe(5)
  })
})
