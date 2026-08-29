import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  ELECTRON_NATIVE_MODULES,
  MAX_REBUILD_ATTEMPTS,
  createNativeRebuildInvocation,
  isTransientMsbuildRuntimeFailure,
  rebuildElectronNativeModules,
  runElectronAbiProbe
} from './rebuild-electron-native.mjs'

const buildPath = path.resolve('native-rebuild-fixture')

describe('Electron native-module rebuild', () => {
  it('owns both native install lifecycles instead of compiling them before postinstall', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'))

    expect(packageJson.allowScripts).toMatchObject({
      'node-pty': false,
      'smart-whisper': false
    })
  })

  it('invokes electron-rebuild with the exact --only module set', async () => {
    const runAttemptImpl = vi.fn(async () => ({ code: 0, signal: null, output: '' }))
    const probeImpl = vi.fn(async () => {})

    await rebuildElectronNativeModules({
      buildPath,
      electronVersion: '42.9.1',
      runAttemptImpl,
      probeImpl
    })

    expect(runAttemptImpl).toHaveBeenCalledOnce()
    expect(probeImpl).toHaveBeenCalledOnce()

    const invocation = createNativeRebuildInvocation({
      buildPath,
      electronVersion: '42.9.1',
      electronRebuildCli: path.resolve('electron-rebuild-cli.js')
    })
    expect(ELECTRON_NATIVE_MODULES).toEqual(['node-pty', 'smart-whisper'])
    expect(invocation.args).toEqual([
      path.resolve('electron-rebuild-cli.js'),
      '--force',
      '--only',
      'node-pty,smart-whisper',
      '--version',
      '42.9.1',
      '--module-dir',
      buildPath
    ])
    expect(invocation.args).not.toContain('--which-module')
  })

  it('does not claim ABI proof when the rebuild fails', async () => {
    const probeImpl = vi.fn(async () => {})

    await expect(
      rebuildElectronNativeModules({
        buildPath,
        electronVersion: '42.9.1',
        runAttemptImpl: vi.fn(async () => ({
          code: 1,
          signal: null,
          output: 'error C2039: ordinary source compile failure'
        })),
        probeImpl
      })
    ).rejects.toThrow('electron-rebuild exited with code 1.')
    expect(probeImpl).not.toHaveBeenCalled()
  })

  it('retries one proven MSBuild runtime failure and then runs the ABI proof', async () => {
    const runAttemptImpl = vi
      .fn()
      .mockResolvedValueOnce({
        code: 1,
        signal: null,
        output:
          'MSBuild error MSB4018: System.InvalidProgramException: Common Language Runtime detected an invalid program.'
      })
      .mockResolvedValueOnce({ code: 0, signal: null, output: '' })
    const probeImpl = vi.fn(async () => {})

    await rebuildElectronNativeModules({
      buildPath,
      electronVersion: '42.9.1',
      runAttemptImpl,
      probeImpl
    })

    expect(MAX_REBUILD_ATTEMPTS).toBe(2)
    expect(runAttemptImpl).toHaveBeenCalledTimes(2)
    expect(probeImpl).toHaveBeenCalledOnce()
  })

  it('recognizes observed MSBuild CPP-task runtime shapes but not ordinary compile errors', () => {
    expect(
      isTransientMsbuildRuntimeFailure(
        'Microsoft.Build.CPPTasks.SetEnv: Method Execute does not have an implementation'
      )
    ).toBe(true)
    expect(
      isTransientMsbuildRuntimeFailure(
        'MSBuild error MSB4062: Method Execute in type Microsoft.Build.CPPTasks.VCMessage does not have an implementation'
      )
    ).toBe(true)
    expect(
      isTransientMsbuildRuntimeFailure(
        'Unhandled Exception: System.AccessViolationException at System.Text.RegularExpressions.CompiledRegexRunner.Go() in Microsoft.Build.BackEnd.TaskBuilder'
      )
    ).toBe(true)
    expect(
      isTransientMsbuildRuntimeFailure(
        'MSBuild stopped after System.AccessViolationException in a native compiler extension'
      )
    ).toBe(false)
    expect(
      isTransientMsbuildRuntimeFailure(
        'MSBuild error C2039: member does not exist in native source'
      )
    ).toBe(false)
  })

  it('runs the ABI probe under Electron-as-Node and propagates a rejected load', async () => {
    const child = new EventEmitter()
    const spawnImpl = vi.fn(() => child)
    const verdict = runElectronAbiProbe({
      buildPath,
      electronExecutable: path.resolve('electron.exe'),
      spawnImpl
    })

    expect(spawnImpl).toHaveBeenCalledOnce()
    expect(spawnImpl.mock.calls[0][1][0]).toBe('-e')
    expect(spawnImpl.mock.calls[0][2]).toMatchObject({
      cwd: buildPath,
      windowsHide: true,
      env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' })
    })

    child.emit('exit', 17, null)
    await expect(verdict).rejects.toThrow('Electron ABI probe exited with code 17.')
  })
})
