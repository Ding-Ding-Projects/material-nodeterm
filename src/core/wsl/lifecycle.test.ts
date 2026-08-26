import { describe, it, expect } from 'vitest'
import { sleepWslDistribution, wakeWslDistribution } from './lifecycle'
import { fakeWslRuntime, STATUS_OK } from './__fixtures__'
import { inMemoryWslOwnershipStore } from './ownership'

describe('sleepWslDistribution', () => {
  it('refuses to terminate a real, unowned distribution (the critical case)', async () => {
    const runtime = fakeWslRuntime({ responses: { '--status': STATUS_OK } })
    const result = await sleepWslDistribution(runtime, inMemoryWslOwnershipStore(), 'docker-desktop')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not-owned-by-app')
    // The refusal must happen before any command touches wsl.exe.
    expect(runtime.calls).toEqual([])
  })

  it('refuses every real pre-existing distribution on this exact machine', async () => {
    const runtime = fakeWslRuntime({ responses: { '--status': STATUS_OK } })
    const ownership = inMemoryWslOwnershipStore()
    for (const name of ['docker-desktop', 'ding-pbx-console', 'ding-pbx-test']) {
      const result = await sleepWslDistribution(runtime, ownership, name)
      expect(result.ok).toBe(false)
    }
    expect(runtime.calls).toEqual([])
  })

  it('refuses when ownership cannot be proven (corrupt ledger reads as not owned)', async () => {
    const runtime = fakeWslRuntime({ responses: { '--status': STATUS_OK } })
    const unreadable = {
      isOwned: async () => false,
      list: async () => [],
      record: async () => {},
      forget: async () => {}
    }
    const result = await sleepWslDistribution(runtime, unreadable, 'my-project')
    expect(result.ok).toBe(false)
    expect(runtime.calls).toEqual([])
  })

  it('terminates an owned distribution, passing its exact name as its own argv element', async () => {
    const runtime = fakeWslRuntime({
      responses: {
        '--status': STATUS_OK,
        '--terminate my-project': { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0 }
      }
    })
    const ownership = inMemoryWslOwnershipStore(['my-project'])
    const result = await sleepWslDistribution(runtime, ownership, 'my-project')
    expect(result).toEqual({ ok: true })
    expect(runtime.calls).toEqual([['--status'], ['--terminate', 'my-project']])
  })

  it('reports command failure honestly rather than a silent success', async () => {
    const runtime = fakeWslRuntime({ responses: { '--status': STATUS_OK } })
    const ownership = inMemoryWslOwnershipStore(['my-project'])
    const result = await sleepWslDistribution(runtime, ownership, 'my-project')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('command-failed')
  })
})

describe('wakeWslDistribution', () => {
  it('refuses to start a real, unowned distribution', async () => {
    const runtime = fakeWslRuntime({ responses: { '--status': STATUS_OK } })
    const result = await wakeWslDistribution(runtime, inMemoryWslOwnershipStore(), 'docker-desktop')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not-owned-by-app')
    expect(runtime.calls).toEqual([])
  })

  it('starts an owned distribution', async () => {
    const runtime = fakeWslRuntime({
      responses: {
        '--status': STATUS_OK,
        '-d my-project -- true': { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0 }
      }
    })
    const ownership = inMemoryWslOwnershipStore(['my-project'])
    const result = await wakeWslDistribution(runtime, ownership, 'my-project')
    expect(result).toEqual({ ok: true })
    expect(runtime.calls).toEqual([['--status'], ['-d', 'my-project', '--', 'true']])
  })
})
