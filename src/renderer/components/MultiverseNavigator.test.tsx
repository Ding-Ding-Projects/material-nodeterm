// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MultiverseNavigator } from './MultiverseNavigator'
import { useProjects } from '../state/projects'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function CompactNavigator(): React.JSX.Element {
  const anchorRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={anchorRef} type="button">More</button>
      <MultiverseNavigator
        open
        hideTrigger
        anchorRefOverride={anchorRef}
        onNavigate={vi.fn()}
        onCreate={vi.fn(() => ({ canvasId: 'child-canvas' }))}
        onBeginDoorConstruction={vi.fn()}
      />
    </>
  )
}

function renderNavigator(overrides: Partial<React.ComponentProps<typeof MultiverseNavigator>> = {}): void {
  const project = useProjects.getState().addProject('Root canvas')
  useProjects.setState({ projects: [project], activeProjectId: project.id })
  act(() => {
    root.render(
      <MultiverseNavigator
        onNavigate={vi.fn()}
        onCreate={vi.fn(() => ({ canvasId: 'child-canvas' }))}
        onBeginDoorConstruction={vi.fn()}
        {...overrides}
      />
    )
  })
}

beforeEach(() => {
  useProjects.getState().hydrate({ version: 2, activeProjectId: '', projects: [] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class {
      observe(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver
  }
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

describe('MultiverseNavigator door construction lifecycle', () => {
  it('does not construct closed door intent with an empty destination', () => {
    expect(() => renderNavigator()).not.toThrow()
    expect(document.querySelector('.door-construction-dialog')).toBeNull()
  })

  it('hands the exact persisted child route to the stable parent workflow', async () => {
    const onBeginDoorConstruction = vi.fn()
    renderNavigator({ onBeginDoorConstruction })

    act(() => {
      document.querySelector<HTMLButtonElement>('.multiverse-nav__trigger')?.click()
    })
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)))
    expect(document.activeElement).toBe(document.querySelector('#multiverse-canvas-search'))
    act(() => {
      Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'New child canvas')?.click()
    })
    act(() => {
      Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Create and open')?.click()
    })

    expect(onBeginDoorConstruction).toHaveBeenCalledWith({
      parentCanvasId: 'root',
      childCanvasId: 'child-canvas',
      entryDoorId: 'door-child-canvas-entry',
      returnDoorId: 'door-child-canvas-return',
      title: 'New Multiverse canvas'
    })
    expect(document.querySelector('.door-construction-dialog')).toBeNull()
  })

  it('moves focus from the shared More anchor into the compact picker', async () => {
    const project = useProjects.getState().addProject('Root canvas')
    useProjects.setState({ projects: [project], activeProjectId: project.id })
    act(() => root.render(<CompactNavigator />))
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)))
    expect(document.querySelector('.multiverse-nav__trigger')).toBeNull()
    expect(document.activeElement).toBe(document.querySelector('#multiverse-canvas-search'))
  })
})
