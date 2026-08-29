import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'

// Guard for a bug that bit a developer for real: `startServer` merges the managed agent hooks
// into the user's REAL agent config dirs (~/.claude/settings.json et al), pointing them at
// `<dataDir>/agent-hooks/<agent>.sh`. A test booting the server with a temp `dataDir` and then
// removing it therefore left a DANGLING hook behind in the developer's own settings.json —
// which Claude Code runs on every tool call, so every later session on that machine died.
// `installHooks: false` is the opt-out; every server test must pass it. This test keeps the
// flag honest (and the default — a real deployment does need the hooks installed).
//
// `os.homedir()` is mocked, not `process.env.HOME`: Node's `os.homedir()` on Windows reads
// `USERPROFILE` (via the Win32 user-profile API), never `HOME`, so redirecting `HOME` was a
// no-op there. The second test below ("installs the hooks by default") would have gone
// straight past this test's own sandbox and written the skill file + AGENTS.md into the
// DEVELOPER'S REAL `~\.claude` / `~\.codex` on every Windows run — the exact catastrophe this
// file exists to guard against, on the one platform its guard didn't actually cover.
let testHome = ''
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  const homedir = (): string => testHome
  const base = (actual as unknown as { default?: typeof actual }).default ?? actual
  return { ...actual, homedir, default: { ...base, homedir } }
})
vi.mock('../../src/core/agents/hooks', () => ({ installManagedAgentHooks: vi.fn() }))

import os from 'os'
import { startServer } from '../../src/server/index'
import { installManagedAgentHooks } from '../../src/core/agents/hooks'

describe('startServer: managed hook install is opt-out-able', () => {
  let dataDir: string
  let close: (() => Promise<void>) | undefined

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-e2e-hookguard-'))
    testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-e2e-hookguard-home-'))
    vi.mocked(installManagedAgentHooks).mockClear()
  })

  afterEach(async () => {
    await close?.()
    close = undefined
    // AWAITED, and that is the load-bearing word. An earlier fix here added `maxRetries` to the
    // synchronous `fs.rmSync`, which made this pass — but for the wrong reason, and it would have
    // come back. Synchronous retries BLOCK the event loop, so they cannot let in-flight async work
    // in this same process finish and release what it holds; the loop waits for what it prevents.
    //
    // The holder is real and was found: a mirror publication opens
    // `agent-status.json.publication.sqlite3` under `dataDir` inside a BEGIN IMMEDIATE
    // transaction, and nothing awaits that flush. Four of this fixture's leftover directories in
    // TEMP still carry that database, which is what says the sync retry was luck rather than a
    // fix. Diagnosed in src/server/handlers/index.test.ts.
    await fsp.rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    await fsp.rm(testHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  const boot = (installHooks?: boolean) =>
    startServer({
      port: 0,
      host: '127.0.0.1',
      dataDir,
      rendererDir: path.join(dataDir, 'no-renderer'),
      insecureHttp: false,
      passwordSeed: 'hookguard-pw',
      ...(installHooks === undefined ? {} : { installHooks })
    })

  it('does NOT touch the real agent config dirs when installHooks is false', async () => {
    const srv = await boot(false)
    close = srv.close
    expect(installManagedAgentHooks).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(testHome, '.claude', 'skills', 'get-linked-context', 'SKILL.md'))).toBe(false)
    expect(fs.existsSync(path.join(testHome, '.codex', 'AGENTS.md'))).toBe(false)
  }, 30_000)

  it('installs the hooks by default (real deployments need them)', async () => {
    const srv = await boot(undefined)
    close = srv.close
    expect(installManagedAgentHooks).toHaveBeenCalledOnce()
    expect(fs.existsSync(path.join(testHome, '.claude', 'skills', 'get-linked-context', 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(testHome, '.codex', 'AGENTS.md'))).toBe(true)
  }, 30_000)
})
