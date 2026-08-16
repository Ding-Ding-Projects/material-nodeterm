import { beforeEach, describe, expect, it, vi } from 'vitest'

type Snapshot = {
  version: 1
  enabled: boolean
  name: string
  authoritative: boolean
  generation: number
}

function api(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    load: vi.fn().mockResolvedValue({
      version: 1,
      enabled: false,
      name: 'Kids mode',
      authoritative: true,
      generation: 1
    } satisfies Snapshot),
    hasCredential: vi.fn().mockResolvedValue(false),
    onChanged: vi.fn(() => () => {}),
    ...overrides
  }
}

function install(kidsMode: Record<string, unknown>): void {
  ;(globalThis as { window?: unknown }).window = { nodeTerminal: { kidsMode } }
}

describe('Kids-mode authoritative renderer state', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('gates while the authoritative load is still pending', async () => {
    const load = vi.fn(() => new Promise<Snapshot>(() => {}))
    install(api({ load, hasCredential: vi.fn(() => new Promise<boolean>(() => {})) }))
    const module = await import('./kidsMode')
    void module.useKidsMode.getState().init()
    await Promise.resolve()

    expect(load).toHaveBeenCalledOnce()
    expect(module.useKidsMode.getState().policyStatus).toBe('loading')
    expect(module.kidsDestructiveGateRequired()).toBe(true)
  })

  it('distinguishes authoritative OFF from an unavailable read', async () => {
    install(api())
    let module = await import('./kidsMode')
    await module.useKidsMode.getState().init()
    expect(module.useKidsMode.getState()).toMatchObject({
      enabled: false,
      policyStatus: 'ready',
      generation: 1
    })
    expect(module.kidsDestructiveGateRequired()).toBe(false)

    vi.resetModules()
    install(api({ load: vi.fn().mockRejectedValue(new Error('IPC unavailable')) }))
    module = await import('./kidsMode')
    await module.useKidsMode.getState().init()
    expect(module.useKidsMode.getState()).toMatchObject({
      enabled: false,
      hydrated: true,
      policyStatus: 'unavailable'
    })
    expect(module.kidsDestructiveGateRequired()).toBe(true)
  })

  it('keeps policy unavailable when the live subscription cannot be installed', async () => {
    install(api({ onChanged: vi.fn(() => { throw new Error('subscription unavailable') }) }))
    const module = await import('./kidsMode')
    await module.useKidsMode.getState().init()

    expect(module.useKidsMode.getState()).toMatchObject({
      enabled: false,
      policyStatus: 'unavailable'
    })
    expect(module.kidsDestructiveGateRequired()).toBe(true)
  })

  it('lets a newer live ON outrank an older in-flight load', async () => {
    let releaseLoad!: (snapshot: Snapshot) => void
    let changed: ((snapshot: Snapshot) => void) | undefined
    install(api({
      load: vi.fn(() => new Promise<Snapshot>((resolve) => { releaseLoad = resolve })),
      onChanged: vi.fn((callback: (snapshot: Snapshot) => void) => {
        changed = callback
        return () => {}
      })
    }))
    const module = await import('./kidsMode')
    const init = module.useKidsMode.getState().init()
    changed?.({
      version: 1,
      enabled: true,
      name: 'External ON',
      authoritative: true,
      generation: 3
    })
    releaseLoad({
      version: 1,
      enabled: false,
      name: 'Stale load',
      authoritative: true,
      generation: 2
    })
    await init

    expect(module.useKidsMode.getState()).toMatchObject({
      enabled: true,
      name: 'External ON',
      policyStatus: 'ready',
      generation: 3
    })
  })

  it('does not let a delayed rename response overwrite a newer live ON event', async () => {
    let changed: ((snapshot: Snapshot) => void) | undefined
    let releaseRename!: (snapshot: Snapshot) => void
    install(api({
      onChanged: vi.fn((callback: (snapshot: Snapshot) => void) => {
        changed = callback
        return () => {}
      }),
      rename: vi.fn(() => new Promise<Snapshot>((resolve) => { releaseRename = resolve }))
    }))
    const module = await import('./kidsMode')
    await module.useKidsMode.getState().init()

    const rename = module.useKidsMode.getState().rename('Old response')
    changed?.({
      version: 1,
      enabled: true,
      name: 'External ON',
      authoritative: true,
      generation: 3
    })
    releaseRename({
      version: 1,
      enabled: false,
      name: 'Old response',
      authoritative: true,
      generation: 2
    })
    await rename

    expect(module.useKidsMode.getState()).toMatchObject({
      enabled: true,
      name: 'External ON',
      policyStatus: 'ready',
      generation: 3
    })
    expect(module.kidsDestructiveGateRequired()).toBe(true)
  })
})
