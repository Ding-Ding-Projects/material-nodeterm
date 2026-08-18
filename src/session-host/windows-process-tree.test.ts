import { spawn } from 'child_process'
import { describe, expect, it } from 'vitest'
import {
  WINDOWS_PROCESS_TREE_TERMINATION_TIMEOUT_MS,
  terminateWindowsProcessTree
} from './windows-process-tree'

/**
 * The Windows kill path had no test of its own, on the platform this app ships to.
 *
 * It is what `host.ts` actually calls to end a session — node-pty defers WindowsTerminal.kill()
 * until a terminal's first output, so a silent process would otherwise stay alive forever — and its
 * doc comment makes a strong safety claim: "success is acknowledged only after the root PID is also
 * observed absent. A timeout is always rejection." Nothing verified that. The one test that reaches
 * this path (host-routing's kill-acknowledgement case) is skipped on win32 precisely because it
 * fakes node-pty, which the Windows branch never calls.
 *
 * These use a REAL child process, because the claim being checked is about a real process actually
 * being gone. A fake cannot disagree with the implementation about that.
 */
describe('terminateWindowsProcessTree', () => {
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== 'ESRCH'
    }
  }

  it('refuses to run at all off Windows, rather than pretending to have killed something', async () => {
    if (process.platform === 'win32') return
    await expect(terminateWindowsProcessTree(999_999)).rejects.toThrow(/unavailable on this platform/)
  })

  it('refuses an invalid pid and its own process, before touching taskkill', async () => {
    // These guards run before the platform-specific work, so they hold everywhere and are the
    // cheapest place to prove the helper cannot be aimed at the host itself.
    await expect(terminateWindowsProcessTree(process.pid)).rejects.toThrow(/Refusing to terminate/)
    await expect(terminateWindowsProcessTree(0)).rejects.toThrow(/Refusing to terminate/)
    await expect(terminateWindowsProcessTree(-1)).rejects.toThrow(/Refusing to terminate/)
    await expect(terminateWindowsProcessTree(1.5)).rejects.toThrow(/Refusing to terminate/)
  })

  it.skipIf(process.platform !== 'win32')(
    'kills a real silent process and reports only after it is gone',
    async () => {
      // A process that produces no early output: `ping -n` just waits, which is the exact shape
      // this helper exists for, because node-pty defers its own kill() until a first write.
      const child = spawn('cmd.exe', ['/c', 'ping', '-n', '30', '127.0.0.1'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      const pid = child.pid
      expect(pid).toBeTypeOf('number')
      expect(alive(pid as number)).toBe(true)

      await terminateWindowsProcessTree(pid as number)
      expect(alive(pid as number)).toBe(false)
    },
    WINDOWS_PROCESS_TREE_TERMINATION_TIMEOUT_MS + 20_000
  )

  // WHAT THIS FILE DOES NOT PROVE, said plainly rather than left to look covered.
  //
  // The source claims "success is acknowledged only after the root PID is also observed absent",
  // implemented as a poll loop after taskkill returns. The test above was written believing it
  // guarded that. It does not: neutering the loop to `while (false)` leaves all four tests green,
  // because `taskkill /F` on a plain child is already finished by the time the promise settles, so
  // the process is absent whether or not anything waited for it.
  //
  // The loop only earns its keep in the race where taskkill returns before the kernel has reaped
  // the tree, and that race cannot be forced from outside the helper — which is why it is recorded
  // here instead of being covered by a test that would pass either way. Proving it needs
  // `processExists` injectable, a production change made for testability alone; that is a
  // deliberate trade, not an oversight. What IS covered is every path reachable without the race:
  // the platform refusal, the pid guards, a real silent process actually dying, and the refusal to
  // convert a taskkill failure into success.

  it.skipIf(process.platform !== 'win32')(
    'rejects for a pid that does not exist rather than reporting a kill it never made',
    async () => {
      // taskkill fails for an unknown pid, and the helper never converts an execution error into
      // success — the comment in the source says so, and this is what holds it to it.
      const child = spawn('cmd.exe', ['/c', 'exit'], { windowsHide: true, stdio: 'ignore' })
      const pid = child.pid as number
      await new Promise<void>((resolve) => child.once('exit', () => resolve()))
      await expect(terminateWindowsProcessTree(pid)).rejects.toThrow(/termination failed for PID/)
    },
    30_000
  )
})
