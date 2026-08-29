import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: execFileMock }))

import { UniGetUiClient, UniGetUiClientError, optionValue } from './client'
import { UniGetUiUniverseStore } from './store'

describe('UniGetUiClient input boundaries', () => {
  it('rejects option values that could become CLI flags', () => {
    expect(() => optionValue('--source=evil')).toThrow(UniGetUiClientError)
    expect(() => optionValue('value with spaces')).toThrow(UniGetUiClientError)
    expect(optionValue('https://packages.example.test/source')).toBe('https://packages.example.test/source')
  })

  it('rejects option values before a package command is spawned', async () => {
    const store = new UniGetUiUniverseStore(path.join(tmpdir(), 'nt-unigetui-option-test'))
    const client = new UniGetUiClient(store)
    await expect(client.packageInstall('contoso.tool', { source: '--evil' })).rejects.toMatchObject({ health: 'malformed' })
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('re-validates navigation and reorder values at the interpolation site', async () => {
    const store = new UniGetUiUniverseStore(path.join(tmpdir(), 'nt-unigetui-client-test'))
    const client = new UniGetUiClient(store)
    await expect(client.navigate('not-a-page' as never)).rejects.toMatchObject({ health: 'malformed' })
    await expect(client.operationReorder('operation-1', 'run-now;bad' as never)).rejects.toMatchObject({ health: 'malformed' })
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('delegates universe state to the injected persistent store', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nt-unigetui-client-state-'))
    try {
      const client = new UniGetUiClient(new UniGetUiUniverseStore(dir))
      await client.saveUniverseState({ schemaVersion: 1, selectedPage: 'logs', search: 'history', regexEnabled: false, regexPattern: '', regexFlags: '', updatedAt: 0 })
      const reloaded = await new UniGetUiUniverseStore(dir).load()
      expect(reloaded.selectedPage).toBe('logs')
      expect(reloaded.search).toBe('history')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('UniGetUiClient executable discovery', () => {
  let dir: string
  let previousPath: string | undefined
  let previousLocalAppData: string | undefined
  let previousProgramFiles: string | undefined
  let previousProgramFilesX86: string | undefined
  let previousProgramW6432: string | undefined

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'nt-unigetui-client-'))
    previousPath = process.env.PATH
    previousLocalAppData = process.env.LOCALAPPDATA
    previousProgramFiles = process.env.ProgramFiles
    previousProgramFilesX86 = process.env['ProgramFiles(x86)']
    previousProgramW6432 = process.env.ProgramW6432
    execFileMock.mockReset()
    execFileMock.mockImplementation((_file: string, _args: string[], _options: unknown, callback: (error: Error) => void) => {
      const error = Object.assign(new Error('missing executable'), { code: 'ENOENT' })
      callback(error)
    })
  })

  afterEach(async () => {
    process.env.PATH = previousPath
    process.env.LOCALAPPDATA = previousLocalAppData
    process.env.ProgramFiles = previousProgramFiles
    process.env['ProgramFiles(x86)'] = previousProgramFilesX86
    process.env.ProgramW6432 = previousProgramW6432
    await rm(dir, { recursive: true, force: true })
  })

  it.skipIf(process.platform !== 'win32')('prefers a regular file under a known installation root over PATH', async () => {
    const trustedRoot = path.join(dir, 'trusted')
    const pathRoot = path.join(dir, 'path')
    await mkdir(path.join(trustedRoot, 'UniGetUI'), { recursive: true })
    await mkdir(pathRoot, { recursive: true })
    const trustedExecutable = path.join(trustedRoot, 'UniGetUI', 'unigetui.exe')
    const pathExecutable = path.join(pathRoot, 'unigetui.exe')
    await writeFile(trustedExecutable, 'trusted')
    await writeFile(pathExecutable, 'path')
    process.env.LOCALAPPDATA = trustedRoot
    process.env.ProgramFiles = ''
    process.env['ProgramFiles(x86)'] = ''
    process.env.ProgramW6432 = ''
    process.env.PATH = pathRoot

    const client = new UniGetUiClient(new UniGetUiUniverseStore(path.join(dir, 'data')))
    const status = await client.status()
    expect(status.executable).toBe(trustedExecutable)
  })

  it.skipIf(process.platform !== 'win32')('skips directories and invalidates a cached executable after ENOENT', async () => {
    const pathRoot = path.join(dir, 'path')
    const executablePath = path.join(pathRoot, 'unigetui.exe')
    await mkdir(executablePath, { recursive: true })
    process.env.LOCALAPPDATA = ''
    process.env.ProgramFiles = ''
    process.env['ProgramFiles(x86)'] = ''
    process.env.ProgramW6432 = ''
    process.env.PATH = pathRoot

    const client = new UniGetUiClient(new UniGetUiUniverseStore(path.join(dir, 'data')))
    expect((await client.status()).executable).toBeNull()
    await rm(executablePath, { recursive: true, force: true })
    await writeFile(executablePath, 'regular file')
    await expect((client as unknown as { runRaw(args: string[]): Promise<unknown> }).runRaw(['status'])).rejects.toThrow()
    expect((client as unknown as { executable: string | null }).executable).toBeNull()
  })
})
