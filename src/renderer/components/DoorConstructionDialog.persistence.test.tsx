// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DoorConstructionDialog } from './DoorConstructionDialog'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('DoorConstructionDialog persistence handoff', () => {
  let root: Root
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ''
  })

  it('stays open when the parent cannot persist the paired construction', async () => {
    const onClose = vi.fn()
    const onConstruct = vi.fn(() => false)
    await act(async () => {
      root.render(
        <DoorConstructionDialog
          open
          onClose={onClose}
          canvasId="root"
          targetCanvasId="child"
          doorId="entry"
          pairedDoorId="return"
          initialLabel="Child door"
          onConstruct={onConstruct}
        />
      )
    })

    const arm = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Arm activation core'))
    expect(arm).toBeDefined()
    act(() => arm?.click())
    const activate = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Activate door'))
    expect(activate?.disabled).toBe(false)
    act(() => activate?.click())

    expect(onConstruct).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(document.querySelector('.door-construction-dialog')).not.toBeNull()
  })
})
