import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'

export const WINDOWS_PROCESS_TREE_TERMINATION_TIMEOUT_MS = 8_000

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Force-terminate a Windows process tree independently of node-pty's `WindowsTerminal.kill()`.
 * node-pty defers that method until its first output marks the terminal ready, so a valid silent
 * process can otherwise remain alive forever. `taskkill /T /F` owns tree traversal; success is
 * acknowledged only after the root PID is also observed absent. A timeout is always rejection.
 */
export async function terminateWindowsProcessTree(pid: number): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('Windows process-tree termination is unavailable on this platform')
  }
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) {
    throw new Error(`Refusing to terminate invalid Windows process id ${String(pid)}`)
  }

  const systemRoot = process.env.SystemRoot
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) {
    throw new Error('Cannot resolve the trusted Windows SystemRoot')
  }
  const taskkillPath = path.win32.join(systemRoot, 'System32', 'taskkill.exe')
  if (!path.win32.isAbsolute(taskkillPath) || !fs.existsSync(taskkillPath)) {
    throw new Error('Cannot resolve the trusted Windows taskkill executable')
  }

  const deadline = Date.now() + WINDOWS_PROCESS_TREE_TERMINATION_TIMEOUT_MS
  const taskkillError = await new Promise<Error | null>((resolve) => {
    execFile(
      taskkillPath,
      ['/PID', String(pid), '/T', '/F'],
      {
        windowsHide: true,
        timeout: WINDOWS_PROCESS_TREE_TERMINATION_TIMEOUT_MS,
        maxBuffer: 64 * 1024
      },
      (error) => resolve(error)
    )
  })

  // Do not turn root absence into proof that `/T` killed every descendant: taskkill can remove
  // the root and still fail on a protected child. A concurrent natural exit is resolved by the
  // host's real onExit path; this helper never converts an execution error into success.
  if (taskkillError) {
    throw new Error(
      `Windows process-tree termination failed for PID ${pid}: ${taskkillError.message}`
    )
  }
  while (processExists(pid)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Windows process tree for PID ${pid} is still alive after ` +
          `${WINDOWS_PROCESS_TREE_TERMINATION_TIMEOUT_MS}ms`
      )
    }
    await delay(25)
  }
}
