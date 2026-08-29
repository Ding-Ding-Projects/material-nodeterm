import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { VeraCryptManager, type VeraCryptRuntime } from './service'
import type { CorePlatform } from '../platform'

const trustedExecutable = 'C:\\Program Files\\VeraCrypt\\VeraCrypt.exe'
const container = 'C:\\vault.hc'

function fakePlatform(userDataDir: string): CorePlatform {
  return {
    userDataDir,
    appVersion: '0.0.0-test',
    isPackaged: false,
    handle: () => {},
    on: () => {},
    handleWithSender: () => {},
    onWithSender: () => {},
    sendTo: () => {},
    broadcast: () => {},
    clientIds: () => [],
    openExternal: async () => undefined
  }
}

function runtime(overrides: Partial<VeraCryptRuntime> = {}): VeraCryptRuntime {
  return {
    platform: 'win32',
    executableCandidates: [trustedExecutable],
    whereExecutable: async () => [],
    run: async (_executable, args) => args[0] === '/version'
      ? { exitCode: 0, stdout: 'VeraCrypt 1.26.7', stderr: '' }
      : { exitCode: 0, stdout: '', stderr: '' },
    pathExists: async (path) => !path.endsWith(':\\'),
    lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false }),
    ...overrides
  }
}

describe('VeraCryptManager executable and operation safety', () => {
  let dataDir = ''

  afterEach(async () => {
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
    dataDir = ''
  })

  async function manager(overrides: Partial<VeraCryptRuntime> = {}): Promise<VeraCryptManager> {
    dataDir = await mkdtemp(join(tmpdir(), 'veracrypt-test-'))
    return new VeraCryptManager(fakePlatform(dataDir), runtime(overrides))
  }

  it('reports the availability reason and never runs a mount when VeraCrypt is absent', async () => {
    const calls: string[][] = []
    const instance = await manager({
      executableCandidates: [],
      whereExecutable: async () => [],
      run: async (_executable, args) => {
        calls.push([...args])
        return { exitCode: 1, stdout: '', stderr: '' }
      }
    })

    const operation = await instance.wipeCache()

    expect(operation.state).toBe('failed')
    expect(operation.message).toContain('VeraCrypt was not found')
    expect(calls).toEqual([])
  })

  it('prefers trusted installation candidates and ignores PATH shadowing', async () => {
    const seen: string[] = []
    const instance = await manager({
      whereExecutable: async () => ['C:\\Users\\Public\\VeraCrypt.exe'],
      run: async (executable, args) => {
        seen.push(executable)
        return args[0] === '/version' ? { exitCode: 0, stdout: 'VeraCrypt 1.26.7', stderr: '' } : { exitCode: 0, stdout: '', stderr: '' }
      }
    })

    const result = await instance.availability()

    expect(result.executablePath).toBe(trustedExecutable)
    expect(result.version).toBe('1.26.7')
    expect(seen[0]).toBe(trustedExecutable)
    expect(seen).not.toContain('C:\\Users\\Public\\VeraCrypt.exe')
  })

  it('rejects a directory or symlink executable', async () => {
    const instance = await manager({
      lstat: async () => ({ isFile: () => false, isSymbolicLink: () => false })
    })
    expect((await instance.availability()).state).toBe('not-installed')

    const symlinkInstance = await manager({
      lstat: async () => ({ isFile: () => true, isSymbolicLink: () => true })
    })
    expect((await symlinkInstance.availability()).state).toBe('not-installed')
  })

  it('emits the fixed credential-free mount argv and verifies the drive root', async () => {
    const calls: { executable: string; args: readonly string[] }[] = []
    let mounted = false
    const instance = await manager({
      run: async (executable, args) => {
        calls.push({ executable, args })
        if (args[0] === '/v') mounted = true
        return args[0] === '/version'
          ? { exitCode: 0, stdout: 'VeraCrypt 1.26.7', stderr: '' }
          : { exitCode: 0, stdout: '', stderr: '' }
      },
      pathExists: async (path) => path === 'X:\\' && mounted
    })

    const result = await instance.mount({ containerPath: container, driveLetter: 'X' })

    expect(result.state).toBe('succeeded')
    expect(calls[1]).toMatchObject({ executable: trustedExecutable, args: ['/v', container, '/l', 'X', '/c', 'n', '/quit'] })
    expect(calls[1].args).not.toContain('/p')
    expect(calls[1].args).not.toContain('/pim')
    expect(calls[1].args).not.toContain('/k')
    expect(calls[1].args).not.toContain('/tryemptypass')
  })

  it('fails mount when the requested drive root is not observed', async () => {
    const instance = await manager({ pathExists: async () => false })
    const result = await instance.mount({ containerPath: container, driveLetter: 'X' })
    expect(result.state).toBe('failed')
    expect(result.message).toContain('not independently observed')
  })

  it('rejects an occupied drive before launch', async () => {
    let launches = 0
    const instance = await manager({
      run: async (_executable, args) => {
        if (args[0] !== '/version') launches += 1
        return { exitCode: 0, stdout: 'VeraCrypt 1.26.7', stderr: '' }
      },
      pathExists: async () => true
    })
    await expect(instance.mount({ containerPath: container, driveLetter: 'X' })).rejects.toThrow('already occupied')
    expect(launches).toBe(0)
  })

  it('reports a drive that remains after unmount as failed', async () => {
    let mounted = false
    const instance = await manager({
      pathExists: async (path) => path === 'X:\\' ? mounted : false,
      run: async (_executable, args) => {
        if (args[0] === '/v') mounted = true
        return args[0] === '/version' ? { exitCode: 0, stdout: 'VeraCrypt 1.26.7', stderr: '' } : { exitCode: 0, stdout: '', stderr: '' }
      }
    })
    const mount = await instance.mount({ containerPath: container, driveLetter: 'X' })
    expect(mount.state).toBe('succeeded')
    const result = await instance.unmount('X')
    expect(result.state).toBe('failed')
    expect(result.message).toContain('drive remains mounted')
  })

  it('rejects explore and unmount for a non-manager drive', async () => {
    const instance = await manager({ pathExists: async () => false })
    await expect(instance.explore('X')).rejects.toThrow('not an independently verified')
    await expect(instance.unmount('X')).rejects.toThrow('not an independently verified')
  })

  it('returns unsupported operations on non-Windows hosts', async () => {
    const instance = await manager({ platform: 'linux', executableCandidates: [] })
    expect((await instance.availability()).state).toBe('unsupported')
    expect((await instance.wipeCache()).state).toBe('failed')
    expect((await instance.refresh()).state).toBe('unsupported')
  })
})

describe('VeraCryptManager favorites', () => {
  let dataDir = ''
  afterEach(async () => {
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
    dataDir = ''
  })

  it('deduplicates by id and path, enforces the cap, and writes atomically', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'veracrypt-favorites-'))
    const instance = new VeraCryptManager(fakePlatform(dataDir), runtime())
    const favorite = { id: 'a', containerPath: container, preferredDriveLetter: 'X', readOnly: false, removable: false, preserveTimestamp: false, exploreAfterMount: false }
    await instance.saveFavorite(favorite)
    await instance.saveFavorite({ ...favorite, id: 'b' })
    expect((await instance.favorites())).toHaveLength(1)

    for (let i = 0; i < 105; i += 1) {
      await instance.saveFavorite({ ...favorite, id: `id-${i}`, containerPath: `C:\\vault-${i}.hc` })
    }
    const favorites = await instance.favorites()
    expect(favorites).toHaveLength(100)
    const file = join(dataDir, 'veracrypt', 'favorites.json')
    expect(JSON.parse(await readFile(file, 'utf8'))).toHaveLength(100)
  })
})
