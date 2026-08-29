import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  APPLICATION_BUILD_MAX_ATTEMPTS,
  APPLICATION_BUILD_RETRY_DELAY_MS,
  APPLICATION_BUILD_TRANSIENT_EXIT_CODE,
  isTransientApplicationBuildExitCode,
  runApplicationBuildWithRetry,
} from './windows-installer.mjs'

function exitError(exitCode) {
  const error = new Error(`application build exited with code ${exitCode}`)
  error.exitCode = exitCode
  return error
}

describe('Windows installer application-build runtime retry', () => {
  it('packages the already ABI-proven native tree without a broad electron-builder rebuild', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'))

    expect(packageJson.build.npmRebuild).toBe(false)
  })

  it('retries the measured host-runtime exit once with clean output and a fresh process', async () => {
    const build = vi
      .fn()
      .mockRejectedValueOnce(exitError(APPLICATION_BUILD_TRANSIENT_EXIT_CODE))
      .mockResolvedValueOnce(undefined)
    const cleanOutput = vi.fn(async () => {})
    const waitImpl = vi.fn(async () => {})

    await runApplicationBuildWithRetry({ build, cleanOutput, waitImpl })

    expect(APPLICATION_BUILD_MAX_ATTEMPTS).toBe(2)
    expect(build).toHaveBeenCalledTimes(2)
    expect(cleanOutput).toHaveBeenCalledOnce()
    expect(waitImpl).toHaveBeenCalledOnce()
    expect(waitImpl).toHaveBeenCalledWith(APPLICATION_BUILD_RETRY_DELAY_MS)
  })

  it('accepts the signed representation of the exact measured status', () => {
    expect(isTransientApplicationBuildExitCode(3221226505)).toBe(true)
    expect(isTransientApplicationBuildExitCode(-1073740791)).toBe(true)
  })

  it('refuses ordinary build errors immediately without deleting output', async () => {
    const failure = exitError(1)
    const build = vi.fn(async () => {
      throw failure
    })
    const cleanOutput = vi.fn(async () => {})
    const waitImpl = vi.fn(async () => {})

    await expect(runApplicationBuildWithRetry({ build, cleanOutput, waitImpl })).rejects.toBe(failure)
    expect(build).toHaveBeenCalledOnce()
    expect(cleanOutput).not.toHaveBeenCalled()
    expect(waitImpl).not.toHaveBeenCalled()
  })

  it('propagates a repeated measured host-runtime exit after the bounded retry', async () => {
    const failure = exitError(APPLICATION_BUILD_TRANSIENT_EXIT_CODE)
    const build = vi.fn(async () => {
      throw failure
    })
    const cleanOutput = vi.fn(async () => {})
    const waitImpl = vi.fn(async () => {})

    await expect(runApplicationBuildWithRetry({ build, cleanOutput, waitImpl })).rejects.toBe(failure)
    expect(build).toHaveBeenCalledTimes(2)
    expect(cleanOutput).toHaveBeenCalledOnce()
    expect(waitImpl).toHaveBeenCalledOnce()
  })

  it('does not broaden the measured process-status allowlist', () => {
    expect(isTransientApplicationBuildExitCode(0)).toBe(false)
    expect(isTransientApplicationBuildExitCode(1)).toBe(false)
    expect(isTransientApplicationBuildExitCode(4294967295)).toBe(false)
    expect(isTransientApplicationBuildExitCode(3221225477)).toBe(false)
  })
})
