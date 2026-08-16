import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultScheduledSettingsFile,
  type ScheduledSettingsFile,
  type ScheduledSettingsLoadState
} from '@shared/scheduled-settings'

const empty = (): ScheduledSettingsFile => ({ ...defaultScheduledSettingsFile(), timezone: 'UTC' })

function installWindow(
  load: ScheduledSettingsLoadState,
  save: (file: ScheduledSettingsFile) => Promise<{ ok: boolean; error?: string }> = vi.fn(async () => ({
    ok: true
  }))
) {
  const scheduledSettings = {
    load: vi.fn(async () => load),
    save,
    activeState: vi.fn(async () => ({ computedAtMs: 1, active: null, sources: {} })),
    tokenStatus: vi.fn(async () => ({})),
    setHomeAssistantToken: vi.fn(async () => {}),
    refreshRule: vi.fn(async () => {}),
    onActiveChange: vi.fn(() => () => {})
  }
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    nodeTerminal: { scheduledSettings }
  })
  return scheduledSettings
}

describe('useScheduledSettings recovery and save retry', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('hydrates the structured load failure instead of presenting safe defaults as proven absence', async () => {
    const loadError = {
      kind: 'corrupt' as const,
      path: 'C:/profile/scheduled-settings.json',
      message: 'The scheduled-settings file is not valid JSON.'
    }
    installWindow({ ok: false, file: empty(), error: loadError })
    const { useScheduledSettings } = await import('./scheduledSettings')

    await useScheduledSettings.getState().hydrate()

    expect(useScheduledSettings.getState()).toMatchObject({
      hydrated: true,
      file: { rules: [] },
      loadError
    })
  })

  it('shows an in-flight rejection and lets a later edit save and clear the error', async () => {
    const save = vi
      .fn<(file: ScheduledSettingsFile) => Promise<{ ok: boolean; error?: string }>>()
      .mockRejectedValueOnce(new Error('bridge dropped'))
      .mockResolvedValueOnce({ ok: true })
    installWindow({ ok: true, file: empty(), error: null }, save)
    const { useScheduledSettings } = await import('./scheduledSettings')

    useScheduledSettings.getState().update({ ...empty(), timezone: 'America/Toronto' })
    await vi.advanceTimersByTimeAsync(500)
    expect(useScheduledSettings.getState().saveError).toBe('Could not reach the app to save the schedule.')

    useScheduledSettings.getState().update({ ...empty(), timezone: 'Europe/London' })
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0].timezone).toBe('Europe/London')
    expect(useScheduledSettings.getState().saveError).toBeNull()
  })
})
