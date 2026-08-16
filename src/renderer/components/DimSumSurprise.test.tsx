// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { resetDimSumRollForTests } from '../lib/dimsum/roll'
import { useProjects } from '../state/projects'
import { useSchoolMode } from '../state/schoolMode'
import { useSettings } from '../state/settings'
import { DimSumSurprise } from './DimSumSurprise'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement

beforeEach(() => {
  vi.useFakeTimers()
  resetDimSumRollForTests()
  useSettings.setState({ settings: DEFAULT_SETTINGS, base: DEFAULT_SETTINGS, hydrated: true })
  useProjects.setState({ projects: [{ id: 'existing', closed: false }] as never })
  useSchoolMode.setState({ enabled: false, hydrated: false, name: 'School mode' })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.clearAllTimers()
  vi.useRealTimers()
  useProjects.setState({ projects: [] })
  useSchoolMode.setState({ enabled: false, hydrated: false, name: 'School mode' })
})

function advance(ms: number): void {
  act(() => vi.advanceTimersByTime(ms))
}

describe('DimSum School-mode gate', () => {
  it('does not roll while the shared record is unknown, then hides an already-visible toast immediately on ON', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    act(() => root.render(<DimSumSurprise />))

    advance(10_000)
    expect(host.querySelector('.dimsum-toast')).toBeNull()
    expect(Math.random).not.toHaveBeenCalled()

    act(() => useSchoolMode.setState({ hydrated: true, enabled: false }))
    advance(3_000)
    expect(host.querySelector('.dimsum-toast')).not.toBeNull()

    act(() => useSchoolMode.setState({ enabled: true }))
    expect(host.querySelector('.dimsum-toast')).toBeNull()
  })

  it('consumes no roll and queues no later surprise when hydration confirms ON', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    useSchoolMode.setState({ enabled: true, hydrated: true })
    act(() => root.render(<DimSumSurprise />))
    advance(10_000)
    expect(random).not.toHaveBeenCalled()
    expect(host.querySelector('.dimsum-toast')).toBeNull()

    act(() => useSchoolMode.setState({ enabled: false }))
    advance(10_000)
    expect(random).not.toHaveBeenCalled()
    expect(host.querySelector('.dimsum-toast')).toBeNull()
  })
})
