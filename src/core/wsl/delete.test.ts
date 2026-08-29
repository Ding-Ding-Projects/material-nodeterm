import { describe, it, expect } from 'vitest'
import { deleteWslDistribution } from './delete'
import { fakeWslRuntime, STATUS_OK } from './__fixtures__'
import { inMemoryWslOwnershipStore } from './ownership'

describe('deleteWslDistribution', () => {
  it('THE critical case: refuses to unregister a real, unowned distribution', async () => {
    const runtime = fakeWslRuntime({ responses: { '--status': STATUS_OK } })
    const result = await deleteWslDistribution(runtime, inMemoryWslOwnershipStore(), {
      name: 'docker-desktop',
      confirmDestroyEverything: true,
      confirmName: 'docker-desktop'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not-owned-by-app')
    expect(runtime.calls).toEqual([])
  })

  it('refuses every real pre-existing distribution on this exact machine, even with a perfect confirmation', async () => {
    const runtime = fakeWslRuntime({ responses: { '--status': STATUS_OK } })
    const ownership = inMemoryWslOwnershipStore()
    for (const name of ['docker-desktop', 'ding-pbx-console', 'ding-pbx-test']) {
      const result = await deleteWslDistribution(runtime, ownership, {
        name,
        confirmDestroyEverything: true,
        confirmName: name
      })
      expect(result.ok).toBe(false)
    }
    expect(runtime.calls).toEqual([])
  })

  it('refuses when the ownership ledger is missing or corrupt (unknown is not permission)', async () => {
    const runtime = fakeWslRuntime({ responses: { '--status': STATUS_OK } })
    const corrupt = {
      isOwned: async () => false, // what a corrupt-ledger read resolves to
      list: async () => [],
      record: async () => {},
      forget: async () => {}
    }
    const result = await deleteWslDistribution(runtime, corrupt, {
      name: 'my-project',
      confirmDestroyEverything: true,
      confirmName: 'my-project'
    })
    expect(result.ok).toBe(false)
    expect(runtime.calls).toEqual([])
  })

  it('refuses when the confirmation name does not match, even for an owned distribution', async () => {
    const runtime = fakeWslRuntime({ responses: { '--status': STATUS_OK } })
    const ownership = inMemoryWslOwnershipStore(['my-project'])
    const result = await deleteWslDistribution(runtime, ownership, {
      name: 'my-project',
      confirmDestroyEverything: true,
      confirmName: 'my-projekt'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('confirmation-mismatch')
    expect(runtime.calls).toEqual([])
  })

  it('unregisters an owned distribution with a matching confirmation, and forgets it afterward', async () => {
    const runtime = fakeWslRuntime({
      responses: {
        '--status': STATUS_OK,
        '--unregister my-project': { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0 }
      }
    })
    const ownership = inMemoryWslOwnershipStore(['my-project'])
    const result = await deleteWslDistribution(runtime, ownership, {
      name: 'my-project',
      confirmDestroyEverything: true,
      confirmName: 'my-project'
    })
    expect(result).toEqual({ ok: true })
    expect(runtime.calls).toEqual([['--status'], ['--unregister', 'my-project']])
    expect(await ownership.isOwned('my-project')).toBe(false)
  })

  it('reports failure honestly when wsl.exe cannot unregister', async () => {
    const runtime = fakeWslRuntime({ responses: { '--status': STATUS_OK } })
    const ownership = inMemoryWslOwnershipStore(['my-project'])
    const result = await deleteWslDistribution(runtime, ownership, {
      name: 'my-project',
      confirmDestroyEverything: true,
      confirmName: 'my-project'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('command-failed')
    // Ownership is not forgotten on a failed unregister: the distribution is still there and
    // still nodeterm's to manage.
    expect(await ownership.isOwned('my-project')).toBe(true)
  })

  it('type-level gate: TypeScript refuses to compile a call whose confirm flag is a bare boolean', () => {
    // This "test" is a compile-time proof, not a runtime assertion. If someone weakens
    // WslDeleteIntent.confirmDestroyEverything from the literal `true` to `boolean`, the
    // following line stops being a type error and this file fails to typecheck, which is the
    // signal this test exists to produce.
    const computedFalse: boolean = false
    const _shouldNotCompile: Parameters<typeof deleteWslDistribution>[2] = {
      name: 'my-project',
      // @ts-expect-error confirmDestroyEverything must be the literal `true`, not `boolean`.
      confirmDestroyEverything: computedFalse,
      confirmName: 'my-project'
    }
    expect(_shouldNotCompile).toBeDefined()
  })
})
