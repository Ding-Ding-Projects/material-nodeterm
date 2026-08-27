// Injectable OS boundary for every wsl.exe-driven module in this package.
//
// Nothing else in src/core/wsl talks to child_process or the filesystem directly, every module
// takes a WslRuntime and calls it. That is what makes the whole package testable without ever
// spawning a real wsl.exe (which would be actively dangerous in a suite: this machine carries real
// distributions, and a test that shells out for real could terminate or unregister one of them).

import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'

export const WSL_COMMAND_TIMEOUT_MS = 15_000
export const WSL_INSTALL_TIMEOUT_MS = 10 * 60_000
export const WSL_COMMAND_MAX_BUFFER = 4 * 1024 * 1024

export interface WslCommandResult {
  stdout: Buffer
  stderr: Buffer
  exitCode: number | null
  error?: Error
}

export interface WslExecOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

/** Everything a wsl.exe-driven module needs from the operating system, all replaceable in tests. */
export interface WslRuntime {
  readonly platform: NodeJS.Platform
  /** Resolves the absolute path to wsl.exe, or null when it could not be found. */
  findWslExecutable(): Promise<string | null>
  /** Runs `wslExe <args>` and captures raw output. Never throws; failures are in the result. */
  execFile(wslExe: string, args: readonly string[], options?: WslExecOptions): Promise<WslCommandResult>
}

function buffer(value: Buffer | string | undefined): Buffer {
  if (Buffer.isBuffer(value)) return value
  return Buffer.from(value ?? '', 'utf8')
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    const stat = await fs.stat(candidate)
    return stat.isFile()
  } catch {
    return false
  }
}

/**
 * Default production runtime. wsl.exe always lives under `%SystemRoot%\System32`, so resolution
 * is a single fixed-path stat rather than a PATH walk, there is no legitimate reason to prefer a
 * different `wsl.exe` found earlier on PATH, and trusting PATH here would let an attacker-planted
 * `wsl.exe` earlier on PATH intercept every distribution-management command.
 */
export function defaultWslRuntime(): WslRuntime {
  return {
    platform: process.platform,
    findWslExecutable: async () => {
      const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
      const candidate = path.win32.join(systemRoot, 'System32', 'wsl.exe')
      return (await isFile(candidate)) ? candidate : null
    },
    execFile: (wslExe, args, options) =>
      new Promise((resolve) => {
        execFile(
          wslExe,
          [...args],
          {
            encoding: 'buffer',
            windowsHide: true,
            timeout: options?.timeoutMs ?? WSL_COMMAND_TIMEOUT_MS,
            maxBuffer: WSL_COMMAND_MAX_BUFFER,
            signal: options?.signal
          },
          (error, stdout, stderr) => {
            const errorCode: unknown = error ? (error as { code?: unknown }).code : undefined
            const exitCode = error ? (typeof errorCode === 'number' ? errorCode : null) : 0
            resolve({
              stdout: buffer(stdout),
              stderr: buffer(stderr),
              exitCode,
              ...(error ? { error } : {})
            })
          }
        )
      })
  }
}
