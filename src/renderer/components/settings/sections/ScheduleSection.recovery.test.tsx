// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultScheduledSettingsFile } from '@shared/scheduled-settings'
import { useScheduledSettings } from '../../../state/scheduledSettings'
import { useSettings } from '../../../state/settings'
import { ScheduleSection } from './ScheduleSection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('ScheduleSection startup recovery', () => {
  let host: HTMLElement
  let root: Root

  beforeEach(() => {
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      scheduledSettings: { save: vi.fn(async () => ({ ok: false })) },
      settings: { save: vi.fn(async () => undefined) }
    }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    useSettings.setState({ hydrated: true })
    useScheduledSettings.setState({
      hydrated: true,
      file: defaultScheduledSettingsFile(),
      loadError: {
        kind: 'unreadable',
        code: 'EACCES',
        path: 'C:/profile/scheduled-settings.json',
        message: 'The scheduled-settings file could not be read.'
      },
      saveError: null
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    useSettings.setState({ hydrated: false })
    useScheduledSettings.setState({ hydrated: false, loadError: null })
  })

  it('shows the preserved recovery fact and exposes no schedule mutation control', () => {
    act(() => root.render(<ScheduleSection isActive />))

    expect(host.querySelector('[role="alert"]')).toBeTruthy()
    expect(host.textContent).toContain('Scheduled settings are off')
    expect(host.textContent).toContain('unreadable (EACCES)')
    expect(host.textContent).toContain('C:/profile/scheduled-settings.json')
    expect(host.textContent).toContain('left untouched')
    expect(
      [...host.querySelectorAll('button')].some((button) => button.textContent === 'Add rule')
    ).toBe(false)
  })
})
