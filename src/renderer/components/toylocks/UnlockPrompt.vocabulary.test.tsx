// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ToyLockRecord } from '@shared/toylock'
import { UnlockPrompt } from './UnlockPrompt'
import { usePersonalVocabulary } from '../../state/personalVocabulary'
import { useSchoolMode } from '../../state/schoolMode'

let host: HTMLDivElement
let root: Root

const record: ToyLockRecord = {
  id: 'lock-1',
  target: { kind: 'tab', id: 'tab-1', label: 'Secret tab' },
  credentialKind: 'password',
  createdAt: 1,
  duration: 'until-close',
  lockedOnLaunch: true
}

function buttonNamed(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.trim() === text)
  if (!button) throw new Error(`missing button ${text}`)
  return button
}

function render(): void {
  act(() =>
    root.render(
      <UnlockPrompt record={record} anchor={{ x: 20, y: 20 }} onUnlocked={() => {}} onClose={() => {}} />
    )
  )
}

beforeEach(() => {
  usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
  useSchoolMode.setState({ enabled: false, hydrated: true, name: 'School mode' })
  ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
    toylock: {
      verify: vi.fn().mockResolvedValue({ ok: false, reason: 'ERR_LOCK_TARGET:Secret tab' })
    }
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
  useSchoolMode.setState({ enabled: false, hydrated: true, name: 'School mode' })
})

describe('unlock prompt personal vocabulary boundary', () => {
  it('maps authored labels and action names while preserving the target label and transport error', async () => {
    const verify = (window as unknown as { nodeTerminal: { toylock: { verify: ReturnType<typeof vi.fn> } } }).nodeTerminal.toylock.verify
    usePersonalVocabulary.setState({
      entries: {
        Unlock: 'Open',
        Password: 'Passcode',
        Cancel: 'Stop',
        'Forgotten your password?': 'Need help?',
        'Secret tab': 'Wrong target'
      },
      status: 'loaded',
      entryCount: 5
    })
    render()

    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Open Secret tab')
    expect(document.querySelector('.toylock-wizard__title')?.textContent).toContain('Secret tab')
    expect(document.querySelector('.toylock-field__label')?.textContent).toBe('Passcode')
    expect(buttonNamed('Stop')).not.toBeNull()
    expect(buttonNamed('Need help?')).not.toBeNull()

    const input = document.querySelector<HTMLInputElement>('.toylock-passwordfield__input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'typed-value')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      buttonNamed('Open').click()
      await Promise.resolve()
    })
    expect(document.querySelector('.toylock-error')?.textContent).toBe('ERR_LOCK_TARGET:Secret tab')
    expect(verify).toHaveBeenCalledWith({ id: 'lock-1', password: 'typed-value', code: undefined })
  })

  it('restores shipped identity in School mode, including the password field accessible name', () => {
    usePersonalVocabulary.setState({ entries: { Password: 'Passcode', Unlock: 'Open' }, status: 'loaded', entryCount: 2 })
    useSchoolMode.setState({ enabled: true, hydrated: true, name: 'School mode' })
    render()

    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Unlock Secret tab')
    expect(document.querySelector('.toylock-field__label')?.textContent).toBe('Password')
    expect(buttonNamed('Unlock')).not.toBeNull()
  })
})
