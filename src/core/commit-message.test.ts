import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { localAgentCwd } from './commit-message'

/**
 * The 2026-08-05 report: "AI commit message" failed on every SSH project with
 *
 *     Error: spawn /Users/enes/.local/bin/claude ENOENT
 *
 * which reads as "claude is not installed" and is not. Node reports a MISSING WORKING DIRECTORY as
 * `spawn <command> ENOENT`, naming the binary rather than the directory — and the directory was an
 * SSH project's cwd, a path that exists on the server and not on the Mac doing the spawning.
 *
 * The agent spawn is local by design (only the git reads route over the ControlMaster, and the diff
 * is inside the prompt by then), so the fix is to not hand it a remote path.
 */
describe('localAgentCwd', () => {
  it('uses the project folder for a LOCAL project', () => {
    expect(localAgentCwd('/Users/enes/code/app', false, '/Users/enes')).toBe('/Users/enes/code/app')
  })

  it('falls back to home for a REMOTE project — that path is on the server', () => {
    expect(localAgentCwd('/root/nodeterm', true, '/Users/enes')).toBe('/Users/enes')
  })

  it('falls back to home for a project with no folder at all', () => {
    // The pre-existing `cwd || os.homedir()` behaviour, kept.
    expect(localAgentCwd('', false, '/Users/enes')).toBe('/Users/enes')
  })
})

describe('runAgent — where the agent is actually spawned', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  /**
   * Drives the REAL `runAgent` with `child_process.spawn` mocked, so what is asserted is the
   * directory the process would have been started in — the thing the bug was about. The helper
   * test above cannot catch a regression that stops CALLING the helper; this one can.
   */
  async function spawnCwdFor(cwd: string, remote: boolean): Promise<string | undefined> {
    // FIRST, before the mock: this file imports `commit-message` statically for `localAgentCwd`, so
    // without a reset the dynamic import below would hand back that already-loaded instance — the
    // one that closed over the REAL `spawn` at import time. The mock would then be installed and
    // never consulted, and the test would silently run the configured command and observe nothing.
    vi.resetModules()
    let seen: string | undefined
    vi.doMock('child_process', async () => {
      const actual = await vi.importActual<typeof import('child_process')>('child_process')
      return {
        ...actual,
        default: actual,
        spawn: (_bin: string, _args: string[], opts: { cwd: string }) => {
          seen = opts.cwd
          // A mocked spawn would otherwise accept a POSIX-only path on Windows and let the cwd
          // assertion certify a directory the real child_process API could never enter.
          expect(fs.statSync(opts.cwd).isDirectory()).toBe(true)
          // The narrowest fake that lets `spawnAgent`'s promise settle: streams it reads, and a
          // close event carrying a usable message so the run does not take the error path.
          const listeners: Record<string, Array<(...a: unknown[]) => void>> = {}
          const child = {
            stdout: { on: (_e: string, cb: (d: Buffer) => void) => cb(Buffer.from('a message')) },
            stderr: { on: () => {} },
            stdin: { write: () => {}, end: () => {} },
            kill: () => {},
            on: (e: string, cb: (...a: unknown[]) => void) => {
              ;(listeners[e] ??= []).push(cb)
              if (e === 'close') setTimeout(() => cb(0), 0)
            }
          }
          return child
        }
      }
    })
    // Both imports have to come AFTER `doMock`, and from the SAME fresh registry: `doMock` reloads
    // the whole graph, so a resolver set through the statically-imported module would be written to
    // a different instance than the one the reloaded `commit-message` reads.
    const remoteGit = await import('./remote-ssh/remote-git')
    remoteGit.setGitRemoteResolver(remote ? () => ({}) as never : null)
    const { runAgent } = await import('./commit-message')
    // `node` rather than the claude/codex branches: `planAgent` resolves a real bare executable
    // before spawning, and Node is necessarily available to the process running this test.
    await runAgent('prompt', cwd, {
      commitAgent: 'custom',
      commitAgentCommand: 'node',
      commitPromptExtra: ''
    } as never)
    return seen
  }

  it('spawns in the project folder for a local project', async () => {
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-commit-message-'))
    try {
      expect(path.dirname(localDir)).toBe(os.tmpdir())
      expect(await spawnCwdFor(localDir, false)).toBe(localDir)
    } finally {
      fs.rmSync(localDir, { recursive: true, force: true })
    }
  })

  it('does NOT spawn in an SSH project’s remote path — that is the ENOENT', async () => {
    // `/root/nodeterm` exists on the server and nowhere on the machine doing the spawning.
    expect(await spawnCwdFor('/root/nodeterm', true)).toBe(os.homedir())
  })
})
