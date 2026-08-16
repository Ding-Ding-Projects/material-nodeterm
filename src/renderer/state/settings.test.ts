import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('settings history restore transaction', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function loadModule(opts?: {
    save?: (settings: typeof DEFAULT_SETTINGS) => Promise<void>
    load?: () => Promise<typeof DEFAULT_SETTINGS>
  }): Promise<{
    save: ReturnType<typeof vi.fn>
    load: ReturnType<typeof vi.fn>
    module: typeof import('./settings')
  }> {
    const save = vi.fn(opts?.save ?? (async () => {}))
    const load = vi.fn(
      opts?.load ?? (async () => ({ ...DEFAULT_SETTINGS, fontSize: 12 }))
    )
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      nodeTerminal: { settings: { save, load } }
    })
    return { save, load, module: await import('./settings') }
  }

  it('cancels a queued stale snapshot and immediately rehydrates the restored settings', async () => {
    const { save, load, module } = await loadModule()
    module.useSettings.getState().update({ fontSize: 99 })

    const restore = vi.fn(async () => ({ ok: true as const }))
    await expect(module.restoreSettingsRevision(restore)).resolves.toEqual({ ok: true })

    expect(restore).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledOnce()
    expect(module.useSettings.getState().base.fontSize).toBe(12)
    expect(module.useSettings.getState().settings.fontSize).toBe(12)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(save).not.toHaveBeenCalled()
  })

  it('joins a save that already crossed the timer before applying the revision', async () => {
    const saveGate = deferred<void>()
    const { save, module } = await loadModule({ save: () => saveGate.promise })
    module.useSettings.getState().update({ fontSize: 88 })
    await vi.advanceTimersByTimeAsync(300)
    expect(save).toHaveBeenCalledOnce()

    const restore = vi.fn(async () => ({ ok: true as const }))
    const restoring = module.restoreSettingsRevision(restore)
    await Promise.resolve()
    await Promise.resolve()
    expect(restore).not.toHaveBeenCalled()

    saveGate.resolve()
    await restoring
    expect(restore).toHaveBeenCalledOnce()
    expect(module.useSettings.getState().base.fontSize).toBe(12)
  })

  it('reschedules the live edit when core refuses the restore', async () => {
    const { save, module } = await loadModule()
    module.useSettings.getState().update({ fontSize: 77 })

    const result = await module.restoreSettingsRevision(async () => ({
      ok: false as const,
      error: 'revision unavailable'
    }))
    expect(result).toEqual({ ok: false, error: 'revision unavailable' })
    expect(module.useSettings.getState().base.fontSize).toBe(77)

    await vi.advanceTimersByTimeAsync(300)
    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0][0].fontSize).toBe(77)
  })

  it('remembers the canceled edit when a failed restore outlives the old timer window', async () => {
    const restoreGate = deferred<{ ok: false; error: string }>()
    const { save, module } = await loadModule()
    module.useSettings.getState().update({ fontSize: 71 })
    const restoring = module.restoreSettingsRevision(() => restoreGate.promise)
    await Promise.resolve()
    await Promise.resolve()

    // The original callback would have fired here. The restore transaction must remember that it
    // canceled real user state even though there is no longer a pending timer to inspect later.
    await vi.advanceTimersByTimeAsync(300)
    restoreGate.resolve({ ok: false, error: 'revision unavailable' })
    await restoring
    await vi.advanceTimersByTimeAsync(300)

    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0][0].fontSize).toBe(71)
  })

  it('drops edits queued while a successful restore is in flight', async () => {
    const restoreGate = deferred<{ ok: true }>()
    const { save, module } = await loadModule()
    const restoring = module.restoreSettingsRevision(() => restoreGate.promise)
    await Promise.resolve()
    await Promise.resolve()

    module.useSettings.getState().update({ fontSize: 66 })
    restoreGate.resolve({ ok: true })
    await restoring
    await vi.advanceTimersByTimeAsync(1_000)

    expect(module.useSettings.getState().base.fontSize).toBe(12)
    expect(save).not.toHaveBeenCalled()
  })
})
