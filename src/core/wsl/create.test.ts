import { describe, it, expect } from 'vitest'
import { createWslDistribution } from './create'
import { fakeWslRuntime, STATUS_OK } from './__fixtures__'
import { inMemoryWslOwnershipStore } from './ownership'

describe('createWslDistribution', () => {
  it('refuses an invalid name before ever calling wsl.exe', async () => {
    const runtime = fakeWslRuntime({ responses: { '--status': STATUS_OK } })
    const ownership = inMemoryWslOwnershipStore()
    const result = await createWslDistribution(runtime, ownership, {
      name: '-bad',
      catalogName: 'Ubuntu',
      existingNames: []
    })
    expect(result.ok).toBe(false)
    expect(runtime.calls).toEqual([])
  })

  it('refuses a name that collides with an existing (even unowned) distribution', async () => {
    const runtime = fakeWslRuntime({ responses: { '--status': STATUS_OK } })
    const ownership = inMemoryWslOwnershipStore()
    const result = await createWslDistribution(runtime, ownership, {
      name: 'docker-desktop',
      catalogName: 'Ubuntu',
      existingNames: ['docker-desktop']
    })
    expect(result.ok).toBe(false)
    expect(runtime.calls).toEqual([])
  })

  it('refuses an empty catalog selection', async () => {
    const runtime = fakeWslRuntime({ responses: { '--status': STATUS_OK } })
    const result = await createWslDistribution(runtime, inMemoryWslOwnershipStore(), {
      name: 'my-project',
      catalogName: '',
      existingNames: []
    })
    expect(result.ok).toBe(false)
  })

  it('reports failure when wsl.exe cannot install', async () => {
    const runtime = fakeWslRuntime({ responses: { '--status': STATUS_OK } })
    const ownership = inMemoryWslOwnershipStore()
    const result = await createWslDistribution(runtime, ownership, {
      name: 'my-project',
      catalogName: 'Ubuntu',
      existingNames: []
    })
    expect(result.ok).toBe(false)
    expect(await ownership.isOwned('my-project')).toBe(false)
  })

  it('on success, passes the name as its own argv element and records ownership', async () => {
    const runtime = fakeWslRuntime({
      responses: {
        '--status': STATUS_OK,
        '--install --distribution Ubuntu --name my-project --no-launch': {
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
          exitCode: 0
        }
      }
    })
    const ownership = inMemoryWslOwnershipStore()
    const result = await createWslDistribution(runtime, ownership, {
      name: 'my-project',
      catalogName: 'Ubuntu',
      existingNames: []
    })
    expect(result).toEqual({ ok: true })
    expect(await ownership.isOwned('my-project')).toBe(true)
    expect(runtime.calls).toEqual([
      ['--status'],
      ['--install', '--distribution', 'Ubuntu', '--name', 'my-project', '--no-launch']
    ])
  })

  it('reports truthful phase progress without inventing installation percentages', async () => {
    const runtime = fakeWslRuntime({
      responses: {
        '--status': STATUS_OK,
        '--install --distribution Ubuntu --name my-project --no-launch': {
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
          exitCode: 0
        }
      }
    })
    const progress: Array<{ stage: string; step: number; steps: number; determinate: boolean }> = []
    await createWslDistribution(runtime, inMemoryWslOwnershipStore(), {
      name: 'my-project',
      catalogName: 'Ubuntu',
      existingNames: []
    }, {
      onProgress: (value) => progress.push(value)
    })
    expect(progress.map((value) => value.stage)).toEqual(['validating', 'checking', 'installing', 'recording', 'completed'])
    expect(progress.every((value) => value.steps === 4)).toBe(true)
    expect(progress.find((value) => value.stage === 'installing')?.determinate).toBe(false)
    expect(progress.find((value) => value.stage === 'completed')?.determinate).toBe(true)
  })

  it('reports failure (not silent success) when wsl.exe succeeds but the ownership write fails', async () => {
    const runtime = fakeWslRuntime({
      responses: {
        '--status': STATUS_OK,
        '--install --distribution Ubuntu --name my-project --no-launch': {
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
          exitCode: 0
        }
      }
    })
    const ownership = {
      isOwned: async () => false,
      list: async () => [],
      record: async () => {
        throw new Error('disk full')
      },
      forget: async () => {}
    }
    const result = await createWslDistribution(runtime, ownership, {
      name: 'my-project',
      catalogName: 'Ubuntu',
      existingNames: []
    })
    expect(result.ok).toBe(false)
  })

  it('never touches a real distribution name it was not asked to create', async () => {
    const runtime = fakeWslRuntime({
      responses: {
        '--status': STATUS_OK,
        '--install --distribution Ubuntu --name my-project --no-launch': {
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
          exitCode: 0
        }
      }
    })
    await createWslDistribution(runtime, inMemoryWslOwnershipStore(), {
      name: 'my-project',
      catalogName: 'Ubuntu',
      existingNames: ['docker-desktop', 'ding-pbx-console', 'ding-pbx-test']
    })
    for (const call of runtime.calls) {
      expect(call).not.toContain('docker-desktop')
      expect(call).not.toContain('ding-pbx-console')
      expect(call).not.toContain('ding-pbx-test')
    }
  })
})
