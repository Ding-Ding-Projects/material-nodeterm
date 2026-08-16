import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultScheduledSettingsFile,
  newScheduleRule,
  type ScheduledSettingsFile,
  type ScheduledSettingsLoadState
} from '@shared/scheduled-settings'
import type { ScheduledSettingsSaveResult } from '@shared/types'

const empty = (): ScheduledSettingsFile => ({ ...defaultScheduledSettingsFile(), timezone: 'UTC' })
const RULE_ID = '11111111-1111-4111-8111-111111111111'
const homeAssistantFile = (): ScheduledSettingsFile => ({
  ...empty(),
  rules: [
    {
      ...newScheduleRule(RULE_ID),
      label: 'Evening lights',
      source: {
        kind: 'home-assistant',
        baseUrl: 'https://home-assistant.example.com',
        entityId: 'input_boolean.evening'
      }
    }
  ]
})

function installWindow(
  load: ScheduledSettingsLoadState,
  save: (file: ScheduledSettingsFile) => Promise<ScheduledSettingsSaveResult> = vi.fn(
    async (): Promise<ScheduledSettingsSaveResult> => ({ ok: true })
  )
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
      .fn<(file: ScheduledSettingsFile) => Promise<ScheduledSettingsSaveResult>>()
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

  it('finishes hydration with a per-rule unknown state when credential status cannot be read', async () => {
    const scheduledSettings = installWindow({ ok: true, file: homeAssistantFile(), error: null })
    scheduledSettings.tokenStatus.mockRejectedValueOnce(new Error('EACCES'))
    const { useScheduledSettings } = await import('./scheduledSettings')

    await useScheduledSettings.getState().hydrate()

    expect(useScheduledSettings.getState()).toMatchObject({
      hydrated: true,
      loadError: null,
      tokenStatus: {},
      tokenStatusUnknown: { [RULE_ID]: true },
      tokenErrors: {
        [RULE_ID]: 'Could not check whether a Home Assistant token is stored.'
      }
    })
  })

  it('publishes the pending owning rule before changing its credential', async () => {
    const next = homeAssistantFile()
    const save = vi.fn(async (): Promise<ScheduledSettingsSaveResult> => ({ ok: true }))
    const scheduledSettings = installWindow({ ok: true, file: empty(), error: null }, save)
    scheduledSettings.tokenStatus.mockResolvedValue({ [RULE_ID]: true })
    const { useScheduledSettings } = await import('./scheduledSettings')

    useScheduledSettings.getState().update(next)
    await expect(
      useScheduledSettings.getState().setHomeAssistantToken(RULE_ID, 'new token')
    ).resolves.toBe(true)

    expect(save).toHaveBeenCalledWith(next)
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(
      scheduledSettings.setHomeAssistantToken.mock.invocationCallOrder[0]
    )
  })

  it('does not mutate a credential when the owning schedule cannot be made durable', async () => {
    const save = vi.fn(async (): Promise<ScheduledSettingsSaveResult> => ({
      ok: false,
      error: 'Schedule storage is unavailable.'
    }))
    const scheduledSettings = installWindow({ ok: true, file: empty(), error: null }, save)
    const { useScheduledSettings } = await import('./scheduledSettings')

    useScheduledSettings.getState().update(homeAssistantFile())
    await expect(
      useScheduledSettings.getState().setHomeAssistantToken(RULE_ID, 'new token')
    ).resolves.toBe(false)

    expect(scheduledSettings.setHomeAssistantToken).not.toHaveBeenCalled()
    expect(useScheduledSettings.getState().tokenErrors[RULE_ID]).toContain(
      'Could not save the owning schedule rule before changing its token.'
    )
  })

  it('retries the same failed owning rule before a later token Save', async () => {
    const save = vi
      .fn<(file: ScheduledSettingsFile) => Promise<ScheduledSettingsSaveResult>>()
      .mockResolvedValueOnce({ ok: false, error: 'Schedule storage is unavailable.' })
      .mockResolvedValueOnce({ ok: true })
    const scheduledSettings = installWindow({ ok: true, file: empty(), error: null }, save)
    scheduledSettings.tokenStatus.mockResolvedValue({ [RULE_ID]: true })
    const { useScheduledSettings } = await import('./scheduledSettings')

    const next = homeAssistantFile()
    useScheduledSettings.getState().update(next)
    await expect(
      useScheduledSettings.getState().setHomeAssistantToken(RULE_ID, 'new token')
    ).resolves.toBe(false)
    expect(scheduledSettings.setHomeAssistantToken).not.toHaveBeenCalled()

    await expect(
      useScheduledSettings.getState().setHomeAssistantToken(RULE_ID, 'new token')
    ).resolves.toBe(true)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0]).toEqual(next)
    expect(save.mock.invocationCallOrder[1]).toBeLessThan(
      scheduledSettings.setHomeAssistantToken.mock.invocationCallOrder[0]
    )
  })

  it('allows token Save after a typed persisted cleanup warning and keeps the warning visible', async () => {
    const warning = 'The schedule was saved, but related credentials could not be fully cleared.'
    const save = vi.fn(async (): Promise<ScheduledSettingsSaveResult> => ({
      ok: false,
      persisted: true,
      warning: 'credential-cleanup-incomplete',
      error: warning
    }))
    const scheduledSettings = installWindow({ ok: true, file: empty(), error: null }, save)
    scheduledSettings.tokenStatus.mockResolvedValue({ [RULE_ID]: true })
    const { useScheduledSettings } = await import('./scheduledSettings')

    useScheduledSettings.getState().update(homeAssistantFile())
    await expect(
      useScheduledSettings.getState().setHomeAssistantToken(RULE_ID, 'new token')
    ).resolves.toBe(true)

    expect(scheduledSettings.setHomeAssistantToken).toHaveBeenCalledWith(RULE_ID, 'new token')
    expect(useScheduledSettings.getState().saveError).toBe(warning)
  })

  it('lets Clear bypass a failed owning-rule publication barrier', async () => {
    const save = vi.fn(async (): Promise<ScheduledSettingsSaveResult> => ({
      ok: false,
      error: 'Schedule storage is unavailable.'
    }))
    const scheduledSettings = installWindow({ ok: true, file: homeAssistantFile(), error: null }, save)
    scheduledSettings.tokenStatus.mockResolvedValue({ [RULE_ID]: false })
    const { useScheduledSettings } = await import('./scheduledSettings')

    useScheduledSettings.getState().update(homeAssistantFile())
    await vi.advanceTimersByTimeAsync(500)
    await expect(
      useScheduledSettings.getState().setHomeAssistantToken(RULE_ID, null)
    ).resolves.toBe(true)

    expect(save).toHaveBeenCalledTimes(1)
    expect(scheduledSettings.setHomeAssistantToken).toHaveBeenCalledWith(RULE_ID, null)
  })

  it('locks direct edits and token Save during recovery while still permitting Clear', async () => {
    const save = vi.fn(async (): Promise<ScheduledSettingsSaveResult> => ({ ok: true }))
    const scheduledSettings = installWindow(
      {
        ok: false,
        file: empty(),
        error: {
          kind: 'unreadable',
          code: 'EACCES',
          path: 'C:/profile/scheduled-settings.json',
          message: 'The scheduled-settings file could not be read.'
        }
      },
      save
    )
    scheduledSettings.tokenStatus.mockResolvedValue({ [RULE_ID]: false })
    const { useScheduledSettings } = await import('./scheduledSettings')
    await useScheduledSettings.getState().hydrate()

    useScheduledSettings.getState().update(homeAssistantFile())
    await expect(
      useScheduledSettings.getState().setHomeAssistantToken(RULE_ID, 'new token')
    ).resolves.toBe(false)
    expect(save).not.toHaveBeenCalled()
    expect(scheduledSettings.setHomeAssistantToken).not.toHaveBeenCalled()

    await expect(
      useScheduledSettings.getState().setHomeAssistantToken(RULE_ID, null)
    ).resolves.toBe(true)
    expect(scheduledSettings.setHomeAssistantToken).toHaveBeenCalledWith(RULE_ID, null)
  })

  it('drops a pending edit when hydration discovers preserved recovery evidence', async () => {
    const save = vi.fn(async (): Promise<ScheduledSettingsSaveResult> => ({ ok: true }))
    const scheduledSettings = installWindow({ ok: true, file: empty(), error: null }, save)
    const { useScheduledSettings } = await import('./scheduledSettings')
    useScheduledSettings.getState().update(homeAssistantFile())
    scheduledSettings.load.mockResolvedValueOnce({
      ok: false,
      file: empty(),
      error: {
        kind: 'corrupt',
        path: 'C:/profile/scheduled-settings.json',
        message: 'The scheduled-settings file is not valid JSON.'
      }
    })

    await useScheduledSettings.getState().hydrate()
    await vi.advanceTimersByTimeAsync(500)

    expect(save).not.toHaveBeenCalled()
    expect(useScheduledSettings.getState().loadError?.kind).toBe('corrupt')
  })

  it('still hydrates structured recovery when active-state refresh rejects', async () => {
    const loadError = {
      kind: 'unreadable' as const,
      code: 'EIO',
      path: 'C:/profile/scheduled-settings.json',
      message: 'The scheduled-settings file could not be read.'
    }
    const scheduledSettings = installWindow({ ok: false, file: empty(), error: loadError })
    scheduledSettings.activeState.mockRejectedValueOnce(new Error('active state unavailable'))
    const { useScheduledSettings } = await import('./scheduledSettings')

    await expect(useScheduledSettings.getState().hydrate()).resolves.toBeUndefined()
    expect(useScheduledSettings.getState()).toMatchObject({ hydrated: true, loadError, active: null })
  })

  it.each([
    { token: 'new token', before: false, status: false },
    { token: 'new token', before: false, status: undefined },
    { token: null, before: true, status: true },
    { token: null, before: true, status: undefined }
  ])('does not verify a token mutation when status contradicts or omits it: %#', async ({ token, before, status }) => {
    const scheduledSettings = installWindow({ ok: true, file: homeAssistantFile(), error: null })
    scheduledSettings.tokenStatus.mockResolvedValue(
      status === undefined ? {} : { [RULE_ID]: status }
    )
    const { useScheduledSettings } = await import('./scheduledSettings')
    useScheduledSettings.setState({
      file: homeAssistantFile(),
      tokenStatus: { [RULE_ID]: before },
      tokenStatusUnknown: {},
      tokenErrors: {},
      loadError: null
    })

    await expect(
      useScheduledSettings.getState().setHomeAssistantToken(RULE_ID, token)
    ).resolves.toBe(false)
    expect(useScheduledSettings.getState().tokenStatus[RULE_ID]).toBe(before)
    expect(useScheduledSettings.getState().tokenStatusUnknown[RULE_ID]).toBe(true)
    expect(useScheduledSettings.getState().tokenErrors[RULE_ID]).toContain(
      'did not verify the requested result'
    )
  })
})
