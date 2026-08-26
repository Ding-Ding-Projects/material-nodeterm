// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WslCreateDialog } from './WslCreateDialog'
import { resetDialogStack } from '../components/dialog-stack'
import type { WslCatalogueEntry } from './wslCoreApi'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CATALOGUE: WslCatalogueEntry[] = [
  { id: 'ubuntu-24.04', label: 'Ubuntu 24.04 LTS' },
  { id: 'debian', label: 'Debian' },
  { id: 'alpine', label: 'Alpine' }
]

describe('WslCreateDialog', () => {
  let root: Root | undefined
  let host: HTMLElement

  beforeEach(() => {
    resetDialogStack()
    host = document.createElement('div')
    document.body.appendChild(host)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    host.remove()
  })


  const setInputValue = (el: HTMLInputElement, value: string): void => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function render(overrides: Partial<React.ComponentProps<typeof WslCreateDialog>> = {}) {
    const onCreate = vi.fn()
    const onCancel = vi.fn()
    root = createRoot(host)
    act(() => {
      root!.render(
        <WslCreateDialog
          catalogue={CATALOGUE}
          catalogueLoading={false}
          catalogueError={null}
          existingNames={new Set(['docker-desktop'])}
          busy={false}
          error={null}
          onCreate={onCreate}
          onCancel={onCancel}
          {...overrides}
        />
      )
    })
    return { onCreate, onCancel }
  }

  it('lists the catalogue and disables Create until a distro and a valid name are chosen', () => {
    render()
    const createBtn = document.querySelector('button.confirm__actions button:last-child') as HTMLButtonElement
    // fall back to text match if class selectors above miss the exact structure
    const buttons = Array.from(document.querySelectorAll('button'))
    const create = buttons.find((b) => b.textContent === 'Create')!
    expect(create.disabled).toBe(true)
    expect(create.title).toMatch(/choose a distribution/i)
    void createBtn
  })

  it('enables Create and calls onCreate with the trimmed name once valid', () => {
    const { onCreate } = render()
    const option = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Ubuntu 24.04 LTS')!
    act(() => option.click())
    const nameInput = document.querySelector('input[aria-label="WSL instance name"]') as HTMLInputElement
    act(() => setInputValue(nameInput, 'my-project'))
    const create = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Create')!
    expect(create.disabled).toBe(false)
    act(() => create.click())
    expect(onCreate).toHaveBeenCalledWith({ catalogueId: 'ubuntu-24.04', name: 'my-project' })
  })

  it('refuses a name colliding with a real distribution on this machine', () => {
    render()
    const option = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Debian')!
    act(() => option.click())
    const nameInput = document.querySelector('input[aria-label="WSL instance name"]') as HTMLInputElement
    act(() => setInputValue(nameInput, 'docker-desktop'))
    const create = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Create')!
    expect(create.disabled).toBe(true)
    expect(document.body.textContent).toMatch(/already exists/i)
  })

  it('Escape cancels', () => {
    const { onCancel } = render()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onCancel).toHaveBeenCalled()
  })

  it('filters the distro list via the search field', () => {
    render()
    const search = document.querySelector('input[aria-label="Filter distributions"]') as HTMLInputElement
    act(() => setInputValue(search, 'alp'))
    const options = Array.from(document.querySelectorAll('[role="option"]')).map((el) => el.textContent)
    expect(options).toEqual(['Alpine'])
  })
})
