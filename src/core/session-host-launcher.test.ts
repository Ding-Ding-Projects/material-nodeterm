import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareSessionHostRuntime, spawnSessionHost } from './session-host-launcher'

describe('stable session-host runtime', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function fixture() {
    const root = mkdtempSync(path.join(os.tmpdir(), 'nodeterm-session-host-runtime-'))
    roots.push(root)
    const install = path.join(root, 'install', 'app-1.0.0')
    const hostDir = path.join(install, 'resources', 'session-host')
    const nativeDir = path.join(hostDir, 'node_modules', 'node-pty')
    mkdirSync(nativeDir, { recursive: true })
    const executablePath = path.join(install, 'nodeterm.exe')
    const scriptPath = path.join(hostDir, 'host.cjs')
    writeFileSync(executablePath, 'fixture executable')
    writeFileSync(scriptPath, 'fixture host bundle')
    writeFileSync(path.join(nativeDir, 'package.json'), '{"name":"node-pty"}')
    return {
      executablePath,
      scriptPath,
      userDataDir: path.join(root, 'state'),
      runtimeDir: path.join(root, 'local-runtime'),
    }
  }

  it('launches a packaged host only from the verified staged copy', async () => {
    const input = fixture()
    const staged = {
      dir: path.join(input.runtimeDir, 'app-1.0.0-abc'),
      exe: path.join(input.runtimeDir, 'app-1.0.0-abc', 'session-host-runtime.exe'),
      script: path.join(input.runtimeDir, 'app-1.0.0-abc', 'resources', 'session-host', 'host.cjs'),
    }
    const stage = vi.fn(async () => staged)
    const prepared = await prepareSessionHostRuntime({ ...input, appVersion: '1.0.0', stage })
    expect(prepared).toEqual({ executablePath: staged.exe, scriptPath: staged.script })
    expect(stage).toHaveBeenCalledWith(
      expect.objectContaining({
        execPath: path.resolve(input.executablePath),
        script: path.resolve(input.scriptPath),
        runtimeRoot: path.resolve(input.runtimeDir),
        appVersion: '1.0.0',
      }),
    )
  })

  it('refuses, never falls back to the install directory, when no staged runtime exists', async () => {
    const input = fixture()
    await expect(
      prepareSessionHostRuntime({ ...input, stage: async () => null }),
    ).rejects.toThrow('never launched from the replaceable install directory')
    await expect(
      prepareSessionHostRuntime({ ...input, stage: () => new Promise(() => {}), waitMs: 5 }),
    ).rejects.toThrow('never launched from the replaceable install directory')
  })

  it('keeps the dev launch (no staging root) on the running executable and repo bundle', async () => {
    const input = fixture()
    const stage = vi.fn()
    const prepared = await prepareSessionHostRuntime({ ...input, runtimeDir: null, stage })
    expect(prepared).toEqual({
      executablePath: path.resolve(input.executablePath),
      scriptPath: path.resolve(input.scriptPath),
    })
    expect(stage).not.toHaveBeenCalled()
  })

  it('refuses a stable runtime inside the replaceable install or persistent-state tree', async () => {
    const input = fixture()
    await expect(
      prepareSessionHostRuntime({
        ...input,
        runtimeDir: path.join(path.dirname(input.executablePath), 'runtime'),
      }),
    ).rejects.toThrow('overlaps')
    await expect(
      prepareSessionHostRuntime({ ...input, runtimeDir: path.join(input.userDataDir, 'runtime') }),
    ).rejects.toThrow('overlaps')
  })

  it('spawns the stable executable and bundle rather than process.execPath', () => {
    const unref = vi.fn()
    const spawnImpl = vi.fn(() => ({ unref, on: vi.fn() })) as any
    spawnSessionHost(
      'C:\\stable\\session-host-runtime.exe',
      'C:\\stable\\session-host\\host.cjs',
      'C:\\state',
      spawnImpl,
    )

    expect(spawnImpl).toHaveBeenCalledWith(
      'C:\\stable\\session-host-runtime.exe',
      ['C:\\stable\\session-host\\host.cjs', 'C:\\state'],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }),
      }),
    )
    expect(unref).toHaveBeenCalledOnce()
  })

  it('returns a spawn failure instead of swallowing it', () => {
    const spawnImpl = vi.fn(() => {
      throw Object.assign(new Error('spawn EACCES'), { code: 'EACCES' })
    }) as any
    const result = spawnSessionHost('exe', 'host.cjs', 'state', spawnImpl)
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ message: 'spawn EACCES' }) })
    expect(
      spawnSessionHost('exe', 'host.cjs', 'state', vi.fn(() => ({ unref: vi.fn(), on: vi.fn() })) as any),
    ).toEqual({ ok: true })
  })

  it('listens for the asynchronous spawn error instead of letting it crash the process', () => {
    let onError: ((error: Error) => void) | undefined
    const child = {
      unref: vi.fn(),
      on: vi.fn((event: string, listener: (error: Error) => void) => {
        if (event === 'error') onError = listener
      }),
    }
    const result = spawnSessionHost('exe', 'host.cjs', 'state', vi.fn(() => child) as any)
    expect(child.on).toHaveBeenCalledWith('error', expect.any(Function))
    onError?.(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))
    expect(result).toEqual({ ok: true, asyncError: expect.objectContaining({ message: 'spawn ENOENT' }) })
  })
})
