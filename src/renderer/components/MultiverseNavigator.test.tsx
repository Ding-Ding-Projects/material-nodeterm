// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MultiverseNavigator } from './MultiverseNavigator'
import { useProjects } from '../state/projects'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function renderNavigator(overrides: Partial<React.ComponentProps<typeof MultiverseNavigator>> = {}): void {
  const project = useProjects.getState().addProject('Root canvas')
  useProjects.setState({ projects: [project], activeProjectId: project.id })
  act(() => {
    root.render(
      <MultiverseNavigator
        onNavigate={vi.fn()}
        onCreate={vi.fn(() => ({ canvasId: 'child-canvas' }))}
        onConstructDoor={vi.fn(() => ({ portalId: 'portal-1' }))}
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

  it('still opens the constructor with the real child canvas destination', () => {
    renderNavigator()

    act(() => {
      document.querySelector<HTMLButtonElement>('.multiverse-nav__trigger')?.click()
    })
    act(() => {
      Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'New child canvas')?.click()
    })
    act(() => {
      Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Create and open')?.click()
    })

    expect(document.querySelector('.door-construction-dialog')).not.toBeNull()
    expect(document.body.textContent).toContain('Route: root → child-canvas')
  })
})
