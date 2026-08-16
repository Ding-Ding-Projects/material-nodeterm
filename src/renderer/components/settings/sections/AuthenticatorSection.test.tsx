// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthenticatorSection } from './AuthenticatorSection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('AuthenticatorSection credential-store recovery', () => {
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
      authenticator: {
        list,
        codes: vi.fn(async () => ({})),
        addFromUri: vi.fn(),
        addManual: vi.fn(),
        rename: vi.fn(),
        remove: vi.fn(),
        reveal: vi.fn(),
        exportSecrets: vi.fn()
      }
    }
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('renders an explicit unknown state instead of claiming the store has no entries', async () => {
    await act(async () => {
      root.render(<AuthenticatorSection isActive />)
    })

    expect(list).toHaveBeenCalledOnce()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not read the authenticator credential store.'
    )
    expect(host.textContent).toContain('Existing entries could not be verified.')
    expect(host.textContent).not.toContain('No entries yet.')
  })
})
