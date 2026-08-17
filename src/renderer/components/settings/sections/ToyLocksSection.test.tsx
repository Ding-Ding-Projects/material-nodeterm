// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useToyLocks } from '../../../state/toylocks'
import { ToyLocksSection } from './ToyLocksSection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('ToyLocksSection credential-store recovery', () => {
  let host: HTMLElement
  let root: Root
  let list: ReturnType<typeof vi.fn>

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    list = vi.fn(async () => {
      throw new Error('credential store unreadable')
    })
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      toylock: {
        list,
        remove: vi.fn(async () => undefined)
      }
    }
    useToyLocks.setState({
      records: [],
      loaded: false,
      loadError: null,
      unlockedUntil: {}
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    useToyLocks.setState({
      records: [],
      loaded: false,
      loadError: null,
      unlockedUntil: {}
    })
    host.remove()
  })

  it('shows a failed strict load without presenting an empty lock inventory', async () => {
    await act(async () => {
      root.render(<ToyLocksSection isActive />)
    })

    expect(list).toHaveBeenCalledOnce()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not read the toy-lock credential store.'
    )
    expect(host.textContent).toContain('Existing locks could not be verified.')
    expect(host.textContent).not.toContain('Nothing is locked yet.')
    expect(host.textContent).not.toContain('Loading…')
  })
})
