// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Boom(): never {
  throw new Error('size.height of undefined')
}

describe('AppErrorBoundary', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  })

  it('renders a recovery card with the message instead of an empty root', () => {
    act(() => {
      root.render(
        <AppErrorBoundary>
          <Boom />
        </AppErrorBoundary>
      )
    })
    expect(host.querySelector('.app-error')).not.toBeNull()
    expect(host.querySelector('.app-error__message')?.textContent).toBe('size.height of undefined')
    expect(host.querySelector('.mdx-btn--filled')?.textContent).toBe('Reload window')
  })

  it('renders children untouched while nothing throws', () => {
    act(() => {
      root.render(
        <AppErrorBoundary>
          <span id="ok">fine</span>
        </AppErrorBoundary>
      )
    })
    expect(host.querySelector('#ok')?.textContent).toBe('fine')
    expect(host.querySelector('.app-error')).toBeNull()
  })
})
