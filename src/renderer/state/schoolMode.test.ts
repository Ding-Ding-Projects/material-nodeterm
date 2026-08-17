import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface RecordShape {
  version: 1
  enabled: boolean
  name: string
}

describe('renderer School-mode hydration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps capabilities fail-closed after a read failure, then retries to a real OFF record', async () => {
    const record: RecordShape = { version: 1, enabled: false, name: 'Focus' }
    const load = vi.fn().mockRejectedValueOnce(new Error('bridge reconnecting')).mockResolvedValue(record)
    const onChanged = vi.fn(() => vi.fn())
    vi.stubGlobal('window', {
      nodeTerminal: {
        schoolMode: {
          load,
          hasCredential: vi.fn(async () => true),
          onChanged
        }
      }
    })

    const { SCHOOL_MODE_HYDRATION_RETRY_MS, useSchoolMode } = await import('./schoolMode')
    await useSchoolMode.getState().init()
    expect(useSchoolMode.getState()).toMatchObject({ hydrated: false, enabled: false })

    await vi.advanceTimersByTimeAsync(SCHOOL_MODE_HYDRATION_RETRY_MS)
    expect(load).toHaveBeenCalledTimes(2)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(useSchoolMode.getState()).toMatchObject({
      hydrated: true,
      enabled: false,
      name: 'Focus',
      hasCredential: true
    })
  })

  it('keeps a newer live ON record when an older load snapshot resolves afterward', async () => {
    let resolveLoad!: (record: RecordShape) => void
    const load = vi.fn(
      () =>
        new Promise<RecordShape>((resolve) => {
          resolveLoad = resolve
        })
    )
    let changed: ((record: RecordShape) => void) | null = null
    vi.stubGlobal('window', {
      nodeTerminal: {
        schoolMode: {
          load,
          hasCredential: vi.fn(async () => false),
          onChanged: vi.fn((cb: (record: RecordShape) => void) => {
            changed = cb
            return vi.fn()
          })
        }
      }
    })

    const { useSchoolMode } = await import('./schoolMode')
    const init = useSchoolMode.getState().init()
    changed!({ version: 1, enabled: true, name: 'Study' })
    resolveLoad({ version: 1, enabled: false, name: 'stale snapshot' })
    await init

    expect(useSchoolMode.getState()).toMatchObject({
      hydrated: true,
      enabled: true,
      name: 'Study',
      hasCredential: false
    })
  })
})
