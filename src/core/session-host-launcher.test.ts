import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
      runtimeDir: path.join(root, 'local-runtime', 'app-1.0.0'),
    }
  }

  it('publishes a complete runtime outside the replaceable app directory and reuses it', async () => {
    const input = fixture()
    const first = await prepareSessionHostRuntime(input)
    expect(first.executablePath).toBe(path.join(input.runtimeDir, 'session-host-runtime.exe'))
    expect(first.scriptPath).toBe(path.join(input.runtimeDir, 'session-host', 'host.cjs'))
    expect(readFileSync(first.executablePath, 'utf8')).toBe('fixture executable')
    expect(readFileSync(first.scriptPath, 'utf8')).toBe('fixture host bundle')
    expect(existsSync(path.join(input.runtimeDir, 'session-host-runtime.json'))).toBe(true)

    const second = await prepareSessionHostRuntime(input)
    expect(second).toEqual(first)
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
    const spawnImpl = vi.fn(() => ({ unref })) as any
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
})
