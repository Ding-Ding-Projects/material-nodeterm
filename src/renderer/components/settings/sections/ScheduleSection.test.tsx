// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { newScheduleRule } from '@shared/scheduled-settings'
import { useSettings } from '../../../state/settings'
import { useScheduledSettings } from '../../../state/scheduledSettings'
import { ScheduleSection } from './ScheduleSection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const RULE_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_RULE_ID = '22222222-2222-4222-8222-222222222222'
const RULE = {
  ...newScheduleRule(RULE_ID),
  label: 'Evening lights',
  source: {
    kind: 'home-assistant' as const,
    baseUrl: 'https://home-assistant.example.com',
    entityId: 'input_boolean.evening'
  }
}
const OTHER_RULE = { ...RULE, id: OTHER_RULE_ID, label: 'Other lights' }

describe('ScheduleSection Home Assistant credential actions', () => {
  let root: Root
  let host: HTMLElement
  let setHomeAssistantToken: ReturnType<typeof vi.fn>
  let tokenStatus: ReturnType<typeof vi.fn>
  let saveSchedule: ReturnType<typeof vi.fn>

  const mount = async (): Promise<void> => {
    root = createRoot(host)
    await act(async () => {
      root.render(<ScheduleSection isActive />)
    })
  }

  const button = (label: string): HTMLButtonElement => {
    const match = [...host.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === label
    )
    if (!match) throw new Error(`button not found: ${label}`)
    return match
  }

  const type = (input: HTMLInputElement, value: string): void => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const click = async (element: HTMLElement): Promise<void> => {
    await act(async () => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  const setStored = (stored: boolean): void => {
    useScheduledSettings.setState({
      file: { version: 2, timezone: 'UTC', rules: [RULE] },
      hydrated: true,
      loadError: null,
      saveError: null,
      active: null,
      tokenStatus: { [RULE_ID]: stored },
      tokenStatusUnknown: {},
      tokenErrors: {}
    })
  }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    setHomeAssistantToken = vi.fn(async () => undefined)
    tokenStatus = vi.fn(async () => ({ [RULE_ID]: true }))
    saveSchedule = vi.fn(async () => ({ ok: true }))
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      scheduledSettings: {
        load: vi.fn(async () => ({
          ok: true,
          file: { version: 2, timezone: 'UTC', rules: [RULE] },
          error: null
        })),
        activeState: vi.fn(async () => ({ computedAtMs: 1, active: null, sources: {} })),
        save: saveSchedule,
        setHomeAssistantToken,
        tokenStatus,
        refreshRule: vi.fn()
      }
    }
    useSettings.setState({
      settings: DEFAULT_SETTINGS,
      base: DEFAULT_SETTINGS,
      hydrated: true
    })
    setStored(true)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  })

  it('shows an incomplete Clear inline and keeps stored status authoritative', async () => {
    setHomeAssistantToken.mockRejectedValueOnce(
      Object.assign(new Error('Credential files remain.'), { code: 'clear-incomplete' })
    )
    await mount()

    await click(button('Clear'))

    expect(setHomeAssistantToken).toHaveBeenCalledWith(RULE_ID, null)
    expect(tokenStatus).not.toHaveBeenCalled()
    expect(host.textContent).toContain(
      'Could not clear the Home Assistant token. It may still be stored.'
    )
    expect(useScheduledSettings.getState().tokenStatus[RULE_ID]).toBe(true)
    expect(button('Clear')).toBeTruthy()
  })

  it('keeps a token draft available for retry when Save rejects', async () => {
    setStored(false)
    setHomeAssistantToken.mockRejectedValueOnce(new Error('Credential storage is unavailable.'))
    await mount()
    const input = host.querySelector<HTMLInputElement>('input[type="password"]')!
    act(() => type(input, 'retry-this-token'))

    await click(button('Save'))

    expect(setHomeAssistantToken).toHaveBeenCalledWith(RULE_ID, 'retry-this-token')
    expect(input.value).toBe('retry-this-token')
    expect(host.textContent).toContain('Could not save the Home Assistant token.')
    expect(host.textContent).not.toContain('retry-this-token')
    // A failed mutation can mean canonical publication succeeded before alternate cleanup failed.
    // Unknown is conservative, and keeps Clear reachable for possible bearer evidence.
    expect(button('Clear')).toBeTruthy()
  })

  it('does not claim a Clear succeeded when the status refresh rejects', async () => {
    tokenStatus.mockRejectedValueOnce(new Error('Status read failed.'))
    useScheduledSettings.setState((state) => ({
      file: { ...state.file, rules: [RULE, OTHER_RULE] },
      tokenStatus: { [RULE_ID]: true, [OTHER_RULE_ID]: false }
    }))
    await mount()

    await click(button('Clear'))

    expect(setHomeAssistantToken).toHaveBeenCalledWith(RULE_ID, null)
    expect(host.textContent).toContain(
      'The Home Assistant token change may have succeeded, but its stored status could not be verified.'
    )
    expect(useScheduledSettings.getState().tokenStatus[RULE_ID]).toBe(true)
    expect(useScheduledSettings.getState().tokenStatusUnknown[OTHER_RULE_ID]).toBe(true)
    expect(useScheduledSettings.getState().tokenErrors[OTHER_RULE_ID]).toContain(
      'Could not check whether a Home Assistant token is stored.'
    )
    expect(button('Clear')).toBeTruthy()
  })

  it('clears the submitted draft and refreshes stored status after a successful Save', async () => {
    setStored(false)
    await mount()
    const input = host.querySelector<HTMLInputElement>('input[type="password"]')!
    act(() => type(input, 'stored-token'))

    await click(button('Save'))

    expect(input.value).toBe('')
    expect(useScheduledSettings.getState().tokenStatus[RULE_ID]).toBe(true)
    expect(button('Clear')).toBeTruthy()
    expect(host.textContent).not.toContain('Could not save the Home Assistant token.')
  })

  it('publishes a pending owning rule before its immediate token mutation', async () => {
    setStored(false)
    const next = { version: 2 as const, timezone: 'UTC', rules: [RULE] }
    useScheduledSettings.getState().update(next)

    await expect(
      useScheduledSettings.getState().setHomeAssistantToken(RULE_ID, 'new token')
    ).resolves.toBe(true)

    expect(saveSchedule).toHaveBeenCalledWith(next)
    expect(saveSchedule.mock.invocationCallOrder[0]).toBeLessThan(
      setHomeAssistantToken.mock.invocationCallOrder[0]
    )
  })

  it('finishes hydration with an inline error and Clear when token status is unreadable', async () => {
    tokenStatus.mockRejectedValueOnce(new Error('EACCES'))
    useScheduledSettings.setState({
      hydrated: false,
      tokenStatus: {},
      tokenStatusUnknown: {},
      tokenErrors: {}
    })

    await act(async () => {
      await useScheduledSettings.getState().hydrate()
    })
    await mount()

    expect(host.textContent).not.toContain('Loading…')
    expect(host.textContent).toContain('Could not check whether a Home Assistant token is stored.')
    expect(button('Clear')).toBeTruthy()
  })

  it('renders a truthful post-save cleanup result without a false disk-save prefix', async () => {
    useScheduledSettings.setState({
      saveError: 'The schedule was saved, but related credentials could not be fully cleared.'
    })
    await mount()

    expect(host.textContent).toContain(
      'The schedule was saved, but related credentials could not be fully cleared.'
    )
    expect(host.textContent).not.toContain('Could not save:')
  })
})
