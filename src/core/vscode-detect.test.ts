/**
 * "Open in Visual Studio Code" — detection + launch, exercised through the injected
 * subprocess/filesystem seam (VsCodeDeps) so the LOGIC is proven on any machine regardless of
 * what happens to be installed there. The contract under test is the external-editor handoff:
 * detect installed editors (PATH first, then the platform's well-known install paths, each
 * verified by actually running `--version`), open a folder as VS Code's workspace root, and
 * degrade with a clear message — never a throw — when nothing is found.
 */
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { detectVsCode, openInVsCode, type VsCodeDeps, type VsCodeInstall } from './vscode-detect'
import { registerVsCodeHandlers } from './vscode-handlers'
import { IPC } from '../shared/ipc'
import type { CorePlatform } from './platform'

interface FakeOptions {
  platform: NodeJS.Platform
  /** exec resolves (as a successful `--version`) only for commands this returns true for. */
  respondsTo?: (cmd: string) => boolean
  /** existsSync answers true only for paths this returns true for. */
  existing?: (p: string) => boolean
  env?: Record<string, string | undefined>
  home?: string
}

function fakeDeps(opts: FakeOptions): { deps: VsCodeDeps; execCalls: { cmd: string; args: string[] }[] } {
  const execCalls: { cmd: string; args: string[] }[] = []
  const deps: VsCodeDeps = {
    platform: opts.platform,
    homedir: () => opts.home ?? path.join('FAKE_HOME'),
    env: opts.env ?? {},
    existsSync: (p) => opts.existing?.(p) ?? false,
    exec: async (cmd, args) => {
      execCalls.push({ cmd, args })
      if (opts.respondsTo?.(cmd)) return { stdout: '1.99.0\nabc\n x64\n', stderr: '' }
      throw new Error(`spawn ${cmd} ENOENT`)
    }
  }
  return { deps, execCalls }
}

describe('detectVsCode', () => {
  it('reports a VS Code answering --version on PATH, marked fromPath', async () => {
    const { deps } = fakeDeps({ platform: 'linux', respondsTo: (c) => c === 'code' })
    const found = await detectVsCode(deps)
    expect(found).toEqual([{ command: 'code', kind: 'code', fromPath: true }])
  })

  it('detects a PORTABLE build: no well-known install path exists, only the PATH command answers', async () => {
    // A portable/unregistered build is reachable only through PATH (the module's own documented
    // contract) — existsSync answers false for every fixed install path, and detection must not
    // need one.
    const { deps, execCalls } = fakeDeps({
      platform: 'linux',
      respondsTo: (c) => c === 'code',
      existing: () => false
    })
    const found = await detectVsCode(deps)
    expect(found).toEqual([{ command: 'code', kind: 'code', fromPath: true }])
    // Nothing path-shaped was ever launched: every probe was a bare PATH command.
    expect(execCalls.every((c) => !c.cmd.includes('/') && !c.cmd.includes('\\'))).toBe(true)
  })

  it('finds the per-user Windows install when PATH has nothing', async () => {
    const localAppData = path.join('FAKE_LOCALAPPDATA')
    const perUser = path.join(localAppData, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd')
    const { deps } = fakeDeps({
      platform: 'win32',
      env: { LOCALAPPDATA: localAppData },
      existing: (p) => p === perUser,
      respondsTo: (c) => c === perUser
    })
    const found = await detectVsCode(deps)
    expect(found).toEqual([{ command: perUser, kind: 'code', fromPath: false }])
  })

  it('falls back to homedir AppData/Local when LOCALAPPDATA is unset', async () => {
    const home = path.join('FAKE_HOME')
    const perUser = path.join(home, 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd')
    const { deps } = fakeDeps({
      platform: 'win32',
      home,
      env: {},
      existing: (p) => p === perUser,
      respondsTo: (c) => c === perUser
    })
    const found = await detectVsCode(deps)
    expect(found).toEqual([{ command: perUser, kind: 'code', fromPath: false }])
  })

  it('detects the Insiders build as its own kind', async () => {
    const { deps } = fakeDeps({ platform: 'linux', respondsTo: (c) => c === 'code-insiders' })
    const found = await detectVsCode(deps)
    expect(found).toEqual([{ command: 'code-insiders', kind: 'code-insiders', fromPath: true }])
  })

  it('a well-known path that exists but fails --version is never reported (stale shortcut)', async () => {
    const { deps, execCalls } = fakeDeps({
      platform: 'linux',
      respondsTo: () => false,
      existing: (p) => p === '/usr/bin/code'
    })
    const found = await detectVsCode(deps)
    expect(found).toEqual([])
    // The verification was genuinely ATTEMPTED — existence alone must never be trusted.
    expect(execCalls.some((c) => c.cmd === '/usr/bin/code' && c.args[0] === '--version')).toBe(true)
  })

  it('one PATH hit per kind suppresses the well-known probe for that kind', async () => {
    const { deps, execCalls } = fakeDeps({
      platform: 'linux',
      respondsTo: (c) => c === 'code' || c === '/usr/bin/code',
      existing: (p) => p === '/usr/bin/code'
    })
    const found = await detectVsCode(deps)
    expect(found).toEqual([{ command: 'code', kind: 'code', fromPath: true }])
    expect(execCalls.some((c) => c.cmd === '/usr/bin/code')).toBe(false)
  })

  it('NOT FOUND: returns an empty array — never throws — when nothing is installed', async () => {
    const { deps } = fakeDeps({ platform: 'linux' })
    await expect(detectVsCode(deps)).resolves.toEqual([])
  })
})

describe('openInVsCode', () => {
  const install: VsCodeInstall = { command: 'code', kind: 'code', fromPath: true }

  it('opens a folder as the workspace root: the bare directory path, in a new window', async () => {
    // VS Code's CLI opens a bare directory argument as the workspace root — no special flag —
    // so the ONE thing to pin is that the path is passed whole and un-mangled, with `-n`.
    const { deps, execCalls } = fakeDeps({ platform: 'linux', respondsTo: () => true })
    const dir = path.join('some', 'project', 'folder')
    const result = await openInVsCode(dir, install, deps)
    expect(result).toEqual({ ok: true })
    expect(execCalls).toEqual([{ cmd: 'code', args: ['-n', dir] }])
  })

  it('detects an install when none is passed, then launches it', async () => {
    const { deps, execCalls } = fakeDeps({ platform: 'linux', respondsTo: (c) => c === 'code' })
    const result = await openInVsCode('a-file.txt', undefined, deps)
    expect(result).toEqual({ ok: true })
    const last = execCalls[execCalls.length - 1]
    expect(last).toEqual({ cmd: 'code', args: ['-n', 'a-file.txt'] })
  })

  it('NOT FOUND degrades with a clear message — where to get VS Code and the PATH route — never a throw', async () => {
    const { deps } = fakeDeps({ platform: 'linux' })
    const result = await openInVsCode('a-file.txt', undefined, deps)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toMatch(/not found/i)
    expect(result.error).toContain('code.visualstudio.com')
    expect(result.error).toContain('PATH')
  })

  it('a launch failure reports the real error instead of throwing', async () => {
    const deps: VsCodeDeps = {
      platform: 'linux',
      exec: async () => {
        throw new Error('boom: display server refused')
      }
    }
    const result = await openInVsCode('a-file.txt', install, deps)
    expect(result).toEqual({ ok: false, error: 'boom: display server refused' })
  })
})

describe('registerVsCodeHandlers', () => {
  it('registers both vscode channels on the platform seam (Desktop AND Server Edition boot path)', () => {
    const handled = new Map<string, (...args: unknown[]) => unknown>()
    const platform = {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
        handled.set(channel, fn)
      }
    } as unknown as CorePlatform
    registerVsCodeHandlers(platform)
    expect(handled.has(IPC.vscodeDetect)).toBe(true)
    expect(handled.has(IPC.vscodeOpen)).toBe(true)
    expect(typeof handled.get(IPC.vscodeDetect)).toBe('function')
    expect(typeof handled.get(IPC.vscodeOpen)).toBe('function')
  })
})
