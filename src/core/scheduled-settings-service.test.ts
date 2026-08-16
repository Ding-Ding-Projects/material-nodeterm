import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IPC } from '../shared/ipc'
import {
  defaultScheduledSettingsFile,
  newScheduleRule,
  type ScheduleRule,
  type ScheduledSettingsFile
} from '../shared/scheduled-settings'
import { initPlatform, resetPlatformForTests } from './platform'
import { fakePlatform, type FakePlatform } from './platform-fake'
import {
  ScheduledSettingsService,
  type ScheduledSettingsServiceDependencies
} from './scheduled-settings-service'
import type { ApiFetchResult, HaFetchResult } from './scheduled-settings-network'

const RULE_ID = '97d84c12-59ba-431a-926d-d706d1206460'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

class MemoryScheduledSettingsStore {
  private listeners = new Set<
    (file: ScheduledSettingsFile, previous: ScheduledSettingsFile) => void | Promise<void>
  >()

  constructor(private file: ScheduledSettingsFile) {}

  get(): ScheduledSettingsFile {
    return this.file
  }

  onChange(
    listener: (file: ScheduledSettingsFile, previous: ScheduledSettingsFile) => void | Promise<void>
  ): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async replace(file: ScheduledSettingsFile): Promise<void> {
    const previous = this.file
    this.file = file
    for (const listener of this.listeners) await listener(file, previous)
  }
}

function fileWith(rule: ScheduleRule): ScheduledSettingsFile {
  return { ...defaultScheduledSettingsFile(), timezone: 'UTC', rules: [rule] }
}

function apiRule(url: string): ScheduleRule {
  return { ...newScheduleRule(RULE_ID), source: { kind: 'api', url } }
}

function haRule(baseUrl = 'https://ha-a.example', entityId = 'input_boolean.office'): ScheduleRule {
  return {
    ...newScheduleRule(RULE_ID),
    source: { kind: 'home-assistant', baseUrl, entityId }
  }
}

function baseDependencies(): Partial<ScheduledSettingsServiceDependencies> {
  return {
    now: () => 1_800_000_000_000,
    setHomeAssistantToken: async () => {},
    getHomeAssistantToken: async () => null,
    homeAssistantTokenStatus: async () => ({}),
    pruneOrphanedTokens: async () => {},
    fetchApiSettingsSource: async () => ({ ok: false, error: 'unused' }),
    fetchHomeAssistantState: async () => ({ ok: false, error: 'unused' })
  }
}

describe('ScheduledSettingsService source ownership', () => {
  let platform: FakePlatform
  let service: ScheduledSettingsService | null

  beforeEach(() => {
    vi.useFakeTimers()
    resetPlatformForTests()
    platform = fakePlatform()
    initPlatform(platform)
    service = null
  })

  afterEach(() => {
    service?.stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
    resetPlatformForTests()
  })

  it('refreshes a same-kind API retarget immediately and never lets the old response win', async () => {
    const oldFetch = deferred<ApiFetchResult>()
    const newFetch = deferred<ApiFetchResult>()
    const fetchApi = vi.fn((url: string) => (url.includes('old') ? oldFetch.promise : newFetch.promise))
    const store = new MemoryScheduledSettingsStore(fileWith(apiRule('https://old.example/settings')))
    service = new ScheduledSettingsService(store, {
      ...baseDependencies(),
      fetchApiSettingsSource: fetchApi
    })
    service.start()
    await flushMicrotasks()
    expect(fetchApi.mock.calls.map(([url]) => url)).toEqual(['https://old.example/settings'])

    await store.replace(fileWith(apiRule('https://new.example/settings')))
    await flushMicrotasks()
    expect(fetchApi.mock.calls.map(([url]) => url)).toEqual([
      'https://old.example/settings',
      'https://new.example/settings'
    ])

    // Four scheduler ticks while B is slow must share B's owned in-flight promise. The previous
    // implementation started B2/B3/B4, invalidating each predecessor before any could land.
    await vi.advanceTimersByTimeAsync(120_000)
    expect(fetchApi).toHaveBeenCalledTimes(2)

    oldFetch.resolve({ ok: true, values: { appTheme: 'light' } })
    await flushMicrotasks()
    const duringNewFetch = platform.handlers[IPC.scheduledSettingsActiveState]() as {
      active: { values: { appTheme?: string } } | null
    }
    expect(duringNewFetch.active).toBeNull()

    // The old owner's finally must not release B's slot.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchApi).toHaveBeenCalledTimes(2)

    newFetch.resolve({ ok: true, values: { appTheme: 'dark' } })
    await flushMicrotasks()
    const final = platform.handlers[IPC.scheduledSettingsActiveState]() as {
      active: { values: { appTheme?: string } } | null
    }
    expect(final.active?.values.appTheme).toBe('dark')
    expect(
      platform.sent.some(
        (entry) =>
          entry.channel === IPC.scheduledSettingsActiveChange &&
          (entry.args[0] as { active?: { values?: { appTheme?: string } } }).active?.values?.appTheme === 'light'
      )
    ).toBe(false)
  })

  it('invalidates cached HA state and an in-flight response when the base URL/entity changes', async () => {
    const oldFetch = deferred<HaFetchResult>()
    const newFetch = deferred<HaFetchResult>()
    const fetchHa = vi.fn((baseUrl: string, _entityId: string, _token: string) =>
      baseUrl.includes('ha-a') ? oldFetch.promise : newFetch.promise
    )
    const store = new MemoryScheduledSettingsStore(fileWith(haRule()))
    service = new ScheduledSettingsService(store, {
      ...baseDependencies(),
      getHomeAssistantToken: async () => 'token',
      fetchHomeAssistantState: fetchHa
    })
    service.start()
    await flushMicrotasks()
    expect(fetchHa).toHaveBeenCalledTimes(1)

    await store.replace(fileWith(haRule('https://ha-b.example', 'binary_sensor.away')))
    await flushMicrotasks()
    expect(fetchHa.mock.calls.map(([baseUrl, entityId]) => [baseUrl, entityId])).toEqual([
      ['https://ha-a.example', 'input_boolean.office'],
      ['https://ha-b.example', 'binary_sensor.away']
    ])

    oldFetch.resolve({ ok: true, on: true })
    await flushMicrotasks()
    expect((platform.handlers[IPC.scheduledSettingsActiveState]() as { active: unknown }).active).toBeNull()

    newFetch.resolve({ ok: true, on: true })
    await flushMicrotasks()
    expect((platform.handlers[IPC.scheduledSettingsActiveState]() as { active: unknown }).active).not.toBeNull()
  })

  it('clearing a token immediately drops last-known on state and rejects the older HA response', async () => {
    const secondFetch = deferred<HaFetchResult>()
    let token: string | null = 'old-token'
    let fetchNumber = 0
    const fetchHa = vi.fn(async (): Promise<HaFetchResult> => {
      fetchNumber += 1
      return fetchNumber === 1 ? { ok: true, on: true } : secondFetch.promise
    })
    const store = new MemoryScheduledSettingsStore(fileWith(haRule()))
    service = new ScheduledSettingsService(store, {
      ...baseDependencies(),
      getHomeAssistantToken: async () => token,
      setHomeAssistantToken: async (_id, next) => {
        token = next
      },
      fetchHomeAssistantState: fetchHa
    })
    service.start()
    await flushMicrotasks()
    expect((platform.handlers[IPC.scheduledSettingsActiveState]() as { active: unknown }).active).not.toBeNull()

    const retry = Promise.resolve(platform.handlers[IPC.scheduledSettingsRefreshRule](RULE_ID))
    await flushMicrotasks()
    expect(fetchHa).toHaveBeenCalledTimes(2)

    await platform.handlers[IPC.scheduledSettingsSetHaToken](RULE_ID, null)
    expect((platform.handlers[IPC.scheduledSettingsActiveState]() as { active: unknown }).active).toBeNull()

    secondFetch.resolve({ ok: true, on: true })
    await retry
    await flushMicrotasks()
    expect((platform.handlers[IPC.scheduledSettingsActiveState]() as { active: unknown }).active).toBeNull()
    // The immediate post-clear refresh observes no token and therefore makes no bearer request.
    expect(fetchHa).toHaveBeenCalledTimes(2)
  })

  it('does not send a token recovered after Clear across the network', async () => {
    const oldTokenRead = deferred<string | null>()
    const getToken = vi
      .fn<() => Promise<string | null>>()
      .mockImplementationOnce(() => oldTokenRead.promise)
      .mockResolvedValue(null)
    const fetchHa = vi.fn(async (): Promise<HaFetchResult> => ({ ok: true, on: true }))
    const store = new MemoryScheduledSettingsStore(fileWith(haRule()))
    service = new ScheduledSettingsService(store, {
      ...baseDependencies(),
      getHomeAssistantToken: getToken,
      fetchHomeAssistantState: fetchHa
    })
    service.start()
    await flushMicrotasks()
    expect(getToken).toHaveBeenCalledTimes(1)

    await platform.handlers[IPC.scheduledSettingsSetHaToken](RULE_ID, null)
    await flushMicrotasks()
    expect(getToken).toHaveBeenCalledTimes(2)

    oldTokenRead.resolve('token-that-was-cleared')
    await flushMicrotasks()
    expect(fetchHa).not.toHaveBeenCalled()
    expect((platform.handlers[IPC.scheduledSettingsActiveState]() as { active: unknown }).active).toBeNull()
  })
})
