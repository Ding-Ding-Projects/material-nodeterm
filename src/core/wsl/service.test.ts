/**
 * What the WSL RPC surface DECIDES, which is one thing: whether a failure to look is allowed to
 * arrive as an answer.
 *
 * The sweeps themselves are covered elsewhere in this directory. The danger here is narrower and
 * quieter: `listInstalledWslDistributions` returns a discriminated result, and flattening its
 * `ok:false` into `[]` would hand the renderer "this machine has no WSL distributions" when the
 * truth is "we could not enumerate them". Those are different sentences, and the second one is
 * invisible once it has been rendered as the first -- the create dialog would offer a name that
 * really does collide, and the canvas would show a bound frame as gone.
 *
 * So the service throws, and the throw is the contract: Electron's `ipcMain.handle` and the
 * server's dispatch both surface a thrown handler as a rejected promise, and the renderer store
 * already has an `error` field and a catch waiting for it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { IPC } from '../../shared/ipc'
import { initPlatform, resetPlatformForTests } from '../platform'
import { fakePlatform, type FakePlatform } from '../platform-fake'
import { startWslService } from './service'
import { fakeWslRuntime, STATUS_OK, VERBOSE_LIST_FIXTURE, utf16leFixture } from './__fixtures__'
import { inMemoryWslOwnershipStore } from './ownership'
import type { WslInstanceSummary } from '../../shared/wsl'

let platform: FakePlatform

beforeEach(() => {
  resetPlatformForTests()
  platform = fakePlatform()
  initPlatform(platform)
})
afterEach(() => resetPlatformForTests())

const list = (): Promise<WslInstanceSummary[]> =>
  platform.handlers[IPC.wslList]() as Promise<WslInstanceSummary[]>

const catalogue = (): Promise<unknown> => platform.handlers[IPC.wslCatalogue]() as Promise<unknown>

/** `wsl --list --verbose` output, in the UTF-16LE the real executable emits and in the fixed-width
 *  columns its parser reads: it takes NAME and STATE from the header's own offsets, so a row
 *  padded to a narrower name column silently reads the tail of a long name as the STATE. */
function installed(names: readonly string[]): Buffer {
  // Built from char codes rather than an escape, because every layer between here and the file
  // on disk eats one backslash, and a CRLF that silently became a real newline is a fixture that
  // tests something other than what it says.
  const CRLF = String.fromCharCode(13, 10)
  const rows = names.map((n) => '  ' + n.padEnd(23) + 'Stopped         2')
  const header = '  NAME                   STATE           VERSION'
  return utf16leFixture([header, ...rows].join(CRLF) + CRLF)
}

describe('the WSL list channel', () => {
  it('rejects when enumeration failed, rather than answering with an empty machine', async () => {
    const runtime = fakeWslRuntime({
      responses: {
        '--status': STATUS_OK,
        // Present but failing: exactly the case that must not be read as "nothing is installed".
        '--list --verbose': { stdout: Buffer.alloc(0), stderr: Buffer.from('access denied'), exitCode: 1 }
      }
    })
    startWslService({ runtime, ownership: inMemoryWslOwnershipStore([]) })
    await expect(list()).rejects.toThrow()
  })

  it('rejects when WSL is not installed at all, for the same reason', async () => {
    const runtime = fakeWslRuntime({ wslExePath: null })
    startWslService({ runtime, ownership: inMemoryWslOwnershipStore([]) })
    await expect(list()).rejects.toThrow(/not installed/i)
  })

  it('answers an empty list when the machine genuinely has none, so the refusal is not vacuous', async () => {
    const runtime = fakeWslRuntime({
      responses: { '--status': STATUS_OK, '--list --verbose': { stdout: installed([]), stderr: Buffer.alloc(0), exitCode: 0 } }
    })
    startWslService({ runtime, ownership: inMemoryWslOwnershipStore([]) })
    await expect(list()).resolves.toEqual([])
  })

  it('reports ownership from the ledger, never from the name', async () => {
    // `ding-pbx-console` is a real distribution on the machine this was written on, and the
    // ledger is empty -- so the only honest answer about every row here is "not ours".
    const runtime = fakeWslRuntime({
      responses: {
        '--status': STATUS_OK,
        '--list --verbose': {
          stdout: installed(['docker-desktop', 'ding-pbx-console', 'nodeterm-demo']),
          stderr: Buffer.alloc(0),
          exitCode: 0
        }
      }
    })
    startWslService({ runtime, ownership: inMemoryWslOwnershipStore([]) })
    const rows = await list()
    expect(rows.map((r) => r.name).sort()).toEqual(
      ['ding-pbx-console', 'docker-desktop', 'nodeterm-demo'].sort()
    )
    // Including the one whose name looks like ours. A prefix is not provenance.
    expect(rows.every((r) => r.ownedByApp === false)).toBe(true)
  })
})

describe('the WSL catalogue and creation progress channels', () => {
  it('rejects the catalogue with a typed template and executable facts', async () => {
    startWslService({ runtime: fakeWslRuntime({ wslExePath: null }), ownership: inMemoryWslOwnershipStore([]) })
    await expect(catalogue()).rejects.toMatchObject({
      code: 'not-installed',
      messageId: 'catalogueNotInstalled',
      facts: []
    })
  })

  it('classifies a command failure without flattening the wsl.exe fact', async () => {
    const runtime = fakeWslRuntime({
      responses: {
        '--status': STATUS_OK,
        '--list --online': { stdout: Buffer.alloc(0), stderr: Buffer.from('access denied'), exitCode: 1 }
      }
    })
    startWslService({ runtime, ownership: inMemoryWslOwnershipStore([]) })
    await expect(catalogue()).rejects.toMatchObject({
      code: 'command-failed', messageId: 'catalogueCommandFailed', facts: ['wsl.exe']
    })
  })

  it('classifies a parser failure while retaining the executable fact', async () => {
    const runtime = fakeWslRuntime({
      responses: {
        '--status': STATUS_OK,
        '--list --online': { stdout: utf16leFixture('not a WSL table\r\n'), stderr: Buffer.alloc(0), exitCode: 0 }
      }
    })
    startWslService({ runtime, ownership: inMemoryWslOwnershipStore([]) })
    await expect(catalogue()).rejects.toMatchObject({
      code: 'parse-failed', messageId: 'catalogueParseFailed', facts: ['wsl.exe']
    })
  })

  it('broadcasts progress ids and facts instead of pre-rendered English', async () => {
    const operationId = '123e4567-e89b-42d3-a456-426614174000'
    const runtime = fakeWslRuntime({
      responses: {
        '--status': STATUS_OK,
        '--list --verbose': VERBOSE_LIST_FIXTURE,
        '--install --distribution Ubuntu --name my-project --no-launch': {
          stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0
        }
      }
    })
    startWslService({ runtime, ownership: inMemoryWslOwnershipStore([]) })
    const result = await platform.handlers[IPC.wslCreate]({ operationId, catalogueId: 'Ubuntu', name: 'my-project' }) as { ok: boolean }
    expect(result).toEqual({ ok: true, name: 'my-project' })
    const progress = platform.sent
      .filter((entry) => entry.channel === IPC.wslCreateProgress)
      .map((entry) => entry.args[0])
    expect(progress.map((entry) => entry.message.id)).toEqual([
      'validating', 'checking', 'installing', 'recording', 'completed'
    ])
    const installing = progress.find((entry) => entry.message.id === 'installing')!
    expect(installing.operationId).toBe(operationId)
    expect(installing.message.params).toMatchObject({
      name: 'my-project', catalogue: 'Ubuntu', operationId
    })
    expect(installing.message.facts).toEqual(expect.arrayContaining(['wsl.exe', 'my-project', 'Ubuntu', operationId]))
    expect(progress.every((entry) => typeof entry.message === 'object' && typeof entry.message.id === 'string')).toBe(true)
  })

  it('returns a typed create failure without duplicating the English diagnostic', async () => {
    const operationId = '123e4567-e89b-42d3-a456-426614174001'
    const runtime = fakeWslRuntime({
      responses: {
        '--status': STATUS_OK,
        '--list --verbose': VERBOSE_LIST_FIXTURE,
        '--install --distribution Ubuntu --name my-project --no-launch': {
          stdout: Buffer.alloc(0), stderr: Buffer.from('permission denied'), exitCode: 1
        }
      }
    })
    startWslService({ runtime, ownership: inMemoryWslOwnershipStore([]) })
    const result = await platform.handlers[IPC.wslCreate]({ operationId, catalogueId: 'Ubuntu', name: 'my-project' }) as {
      ok: false
      error: { code: string; message: { id: string; params: Record<string, string>; facts: readonly string[] } }
    }
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('create-failed')
    expect(result.error.message.id).toBe('failed')
    expect(result.error.message.params.error).toBe('wsl.exe could not create "my-project" from "Ubuntu".')
    expect(result.error.message.facts).toEqual(expect.arrayContaining(['wsl.exe', 'my-project', 'Ubuntu']))
  })
})
