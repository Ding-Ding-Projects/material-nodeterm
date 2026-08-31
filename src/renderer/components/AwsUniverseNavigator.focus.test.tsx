// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AwsUniverseNavigator } from './AwsUniverseNavigator'
import { useProjects } from '../state/projects'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function CompactPicker(): React.JSX.Element {
  const anchorRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={anchorRef} type="button">More</button>
      <AwsUniverseNavigator
        open
        hideTrigger
        anchorRefOverride={anchorRef}
        onNavigate={vi.fn()}
        onCreate={vi.fn(() => ({ canvasId: 'aws-child' }))}
      />
    </>
  )
}

describe('AwsUniverseNavigator compact focus handoff', () => {
  let root: Root
  let host: HTMLDivElement

  beforeEach(() => {
    const project = useProjects.getState().addProject('Root canvas')
    useProjects.setState({ projects: [project], activeProjectId: project.id })
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
    useProjects.getState().hydrate({ version: 2, activeProjectId: '', projects: [] })
  })

  it('moves focus from the shared More anchor into the opened compact picker', async () => {
    act(() => root.render(<CompactPicker />))
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)))
    expect(document.querySelector('.aws-universe-nav__trigger')).toBeNull()
    expect(document.activeElement).toBe(document.querySelector('#aws-universe-search'))
  })
})
