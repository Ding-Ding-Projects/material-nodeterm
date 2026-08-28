import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../shared/ipc'
import type { PtyCreateOptions, PtyCreateResult } from '../shared/types'
import {
  codexAccountHome,
  codexUsageAccounts,
  needsCodexAccountScope,
  isCodexScopeRefusal,
  resolveCodexSessionScope
} from './codex-accounts-core'
import { initPlatform, resetPlatformForTests } from './platform'
import { fakePlatform, type FakePlatform } from './platform-fake'

const spawned: Array<{ args: string[]; env: Record<string, string> }> = []

// Pin the persistence backend: without this the suite silently tests whichever backend this
// machine has built, not the plain-shell path it was written for. See the fixture for the full
// explanation and the 78-pass -> 73-fail incident that prompted it.
vi.mock('./session-host-backend', async () =>
  (await import('./__fixtures__/no-session-host')).noSessionHost()
)

vi.mock('node-pty', () => ({
  spawn: (_file: string, args: string[], options: { env: Record<string, string> }) => {
    spawned.push({ args, env: options.env })
    return {
      onData: () => {},
      onExit: () => {},
      write: () => {},
      resize: () => {},
      pause: () => {},
      resume: () => {},
      kill: () => {},
      pid: 4321
    }
  }
}))

describe('PTY Codex account isolation', () => {
  let platform: FakePlatform
  let userDataDir: string

  beforeEach(async () => {
    spawned.length = 0
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeterm-codex-pty-'))
    platform = fakePlatform({ userDataDir })
    initPlatform(platform)
    const { PtyManager } = await import('./pty-manager')
    new PtyManager().registerIpc()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetPlatformForTests()
    fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  const create = (options: Partial<PtyCreateOptions>): Promise<PtyCreateResult> =>
    platform.handlers[IPC.ptyCreate](1, {
      cols: 80,
      rows: 24,
      persistKey: `node-${Math.random()}`,
      agentId: 'codex',
      ...options
    }) as Promise<PtyCreateResult>

  it('fails closed without spawning when an explicitly selected account home is missing', async () => {
    const result = await create({ codexAccountId: 'account-a' })
    expect(result).toMatchObject({ sessionId: '', fresh: false, unavailable: 'codex-account' })
    expect(spawned).toHaveLength(0)
  })

  it('uses explicit system scope instead of an inherited managed scope', async () => {
    vi.stubEnv('NODETERM_CODEX_ACCOUNT_ID', 'inherited-wrong-account')
    const result = await create({})
    expect(result.unavailable).toBeUndefined()
    expect(spawned).toHaveLength(1)
    expect(spawned[0].env.NODETERM_CODEX_ACCOUNT_ID).toBe('')
    expect(path.isAbsolute(spawned[0].env.CODEX_HOME)).toBe(true)
  })

  it('spawns against only the selected managed home', async () => {
    const home = codexAccountHome(userDataDir, 'account-a')
    fs.mkdirSync(home, { recursive: true })
    const result = await create({ codexAccountId: 'account-a' })
    expect(result.unavailable).toBeUndefined()
    expect(spawned).toHaveLength(1)
    expect(spawned[0].env).toMatchObject({
      CODEX_HOME: home,
      NODETERM_CODEX_ACCOUNT_ID: 'account-a'
    })
  })

  it('scopes a plain account-login terminal to its managed home', async () => {
    const home = codexAccountHome(userDataDir, 'account-a')
    fs.mkdirSync(home, { recursive: true })
    const result = await create({ agentId: undefined, codexAccountId: 'account-a' })
    expect(result.unavailable).toBeUndefined()
    expect(spawned).toHaveLength(1)
    expect(spawned[0].env).toMatchObject({
      CODEX_HOME: home,
      NODETERM_CODEX_ACCOUNT_ID: 'account-a'
    })
    expect(needsCodexAccountScope(undefined, 'account-a')).toBe(true)
  })

  it('fails a plain account-login terminal closed when its home is missing', async () => {
    const result = await create({ agentId: undefined, codexAccountId: 'account-a' })
    expect(result).toMatchObject({ sessionId: '', fresh: false, unavailable: 'codex-account' })
    expect(spawned).toHaveLength(0)
  })

  it('keeps an authenticated home discoverable while its UI marker is still pending', () => {
    expect(
      codexUsageAccounts(
        [{ id: 'account-a', label: 'Pending row', pending: true }],
        (id) => codexAccountHome(userDataDir, id)
      )
    ).toEqual([
      {
        id: 'account-a',
        home: codexAccountHome(userDataDir, 'account-a'),
        label: 'Pending row',
        email: undefined
      }
    ])
  })
})

// Property 4 (S6 §5) / Decision 2: an EXPLICITLY selected managed Codex account whose home is
// missing REFUSES — it never falls back to the system home. This pins the fail-closed spawn scope
// at the model layer (`resolveCodexSessionScope`), where the later pty-manager PR consumes it. The
// PR-1 model ships inert, so this tests the resolver against a REAL temp filesystem rather than a
// full PtyManager spawn (nothing spawns against the model yet).
describe('Codex spawn scope resolves fail-closed', () => {
  let userDataDir: string

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeterm-codex-scope-'))
  })
  afterEach(() => {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  })

  it('fails closed without spawning when an explicitly selected account home is missing', () => {
    // The short home is deliberately NOT created.
    const scope = resolveCodexSessionScope(userDataDir, 'account-a', fs.existsSync)
    expect(isCodexScopeRefusal(scope)).toBe(true)
    expect(scope).toEqual({ unavailable: 'codex-account' })
    // Decision 2: the refusal must NOT be the system home under any key.
    expect((scope as { CODEX_HOME?: string }).CODEX_HOME).toBeUndefined()
  })

  it('spawns against only the selected managed home once it exists', () => {
    const home = codexAccountHome(userDataDir, 'account-a')
    fs.mkdirSync(home, { recursive: true })
    const scope = resolveCodexSessionScope(userDataDir, 'account-a', fs.existsSync)
    expect(isCodexScopeRefusal(scope)).toBe(false)
    expect(scope).toEqual({ CODEX_HOME: home, NODETERM_CODEX_ACCOUNT_ID: 'account-a' })
  })

  it('uses explicit system scope instead of an inherited managed scope', () => {
    // No account id ⇒ system scope, and it ALWAYS resolves (never refuses), explicitly clearing
    // any managed NODETERM_CODEX_ACCOUNT_ID a parent process leaked in.
    const scope = resolveCodexSessionScope(userDataDir, undefined, fs.existsSync)
    expect(isCodexScopeRefusal(scope)).toBe(false)
    expect(scope).toMatchObject({ NODETERM_CODEX_ACCOUNT_ID: '' })
    expect(path.isAbsolute((scope as { CODEX_HOME: string }).CODEX_HOME)).toBe(true)
  })

  it('refuses an unsafe explicit account id before touching the filesystem', () => {
    expect(() => resolveCodexSessionScope(userDataDir, '../escape', fs.existsSync)).toThrow(
      'Invalid Codex account id'
    )
  })
})
