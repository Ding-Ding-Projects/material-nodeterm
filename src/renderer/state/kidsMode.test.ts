import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('Kids-mode destructive safety hydration', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('gates before the record has answered', async () => {
    const load = vi.fn(() => new Promise(() => {}))
    ;(globalThis as { window?: unknown }).window = {
      nodeTerminal: {
        kidsMode: {
          load,
          hasCredential: () => new Promise(() => {}),
          onChanged: () => () => {}
        }
      }
    }
    const { kidsDestructiveGateRequired, useKidsMode } = await import('./kidsMode')
    void useKidsMode.getState().init()
    await Promise.resolve()

    expect(load).toHaveBeenCalledOnce()
    expect(useKidsMode.getState().policyStatus).toBe('loading')
    expect(kidsDestructiveGateRequired()).toBe(true)
  })

  it('distinguishes an authoritative OFF record from a failed read', async () => {
    ;(globalThis as { window?: unknown }).window = {
      nodeTerminal: {
        kidsMode: {
          load: vi.fn().mockResolvedValue({
            enabled: false,
            name: 'Kids mode',
            authoritative: true
          }),
          hasCredential: vi.fn().mockResolvedValue(false),
          onChanged: vi.fn(() => () => {})
        }
      }
    }
    let module = await import('./kidsMode')
    await module.useKidsMode.getState().init()
    expect(module.useKidsMode.getState().policyStatus).toBe('ready')
    expect(module.kidsDestructiveGateRequired()).toBe(false)

    vi.resetModules()
    ;(globalThis as { window?: unknown }).window = {
      nodeTerminal: {
        kidsMode: {
          load: vi.fn().mockRejectedValue(new Error('IPC unavailable')),
          hasCredential: vi.fn().mockResolvedValue(false),
          onChanged: vi.fn(() => () => {})
        }
      }
    }
    module = await import('./kidsMode')
    await module.useKidsMode.getState().init()
    expect(module.useKidsMode.getState()).toMatchObject({
      enabled: false,
      hydrated: true,
      policyStatus: 'unavailable'
    })
    expect(module.kidsDestructiveGateRequired()).toBe(true)
  })

  it('keeps gating when core reports a non-authoritative display snapshot', async () => {
    ;(globalThis as { window?: unknown }).window = {
      nodeTerminal: {
        kidsMode: {
          load: vi.fn().mockResolvedValue({
            enabled: false,
            name: 'Kids mode',
            authoritative: false
          }),
          hasCredential: vi.fn().mockResolvedValue(false),
          onChanged: vi.fn(() => () => {})
        }
      }
    }
    const module = await import('./kidsMode')
    await module.useKidsMode.getState().init()

    expect(module.useKidsMode.getState()).toMatchObject({
      enabled: false,
      hydrated: true,
      policyStatus: 'unavailable'
    })
    expect(module.kidsDestructiveGateRequired()).toBe(true)
  })

  it('keeps gating when the live subscription cannot be installed', async () => {
    ;(globalThis as { window?: unknown }).window = {
      nodeTerminal: {
        kidsMode: {
          load: vi.fn().mockResolvedValue({
            enabled: false,
            name: 'Kids mode',
            authoritative: true
          }),
          hasCredential: vi.fn().mockResolvedValue(false),
          onChanged: vi.fn(() => {
            throw new Error('subscription unavailable')
          })
        }
      }
    }
    const module = await import('./kidsMode')
    await module.useKidsMode.getState().init()

    expect(module.useKidsMode.getState().policyStatus).toBe('unavailable')
    expect(module.kidsDestructiveGateRequired()).toBe(true)
  })

  it('lets a live record outrank an older in-flight load snapshot', async () => {
    type Snapshot = { enabled: boolean; name: string; authoritative: boolean }
    let releaseLoad: (record: Snapshot) => void = () => {}
    let changed: ((record: Snapshot) => void) | undefined
    ;(globalThis as { window?: unknown }).window = {
      nodeTerminal: {
        kidsMode: {
          load: vi.fn(
            () => new Promise<Snapshot>((resolve) => (releaseLoad = resolve))
          ),
          hasCredential: vi.fn().mockResolvedValue(false),
          onChanged: vi.fn((callback) => {
            changed = callback
            return () => {}
          })
        }
      }
    }
    const module = await import('./kidsMode')
    const init = module.useKidsMode.getState().init()
    changed?.({ enabled: true, name: 'Family mode', authoritative: true })
    releaseLoad({ enabled: false, name: 'Stale snapshot', authoritative: true })
    await init

    expect(module.useKidsMode.getState()).toMatchObject({
      enabled: true,
      name: 'Family mode',
      policyStatus: 'ready'
    })
    expect(module.kidsDestructiveGateRequired()).toBe(true)
  })
})
