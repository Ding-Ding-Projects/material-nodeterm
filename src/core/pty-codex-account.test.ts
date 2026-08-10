import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../shared/ipc'
import type { PtyCreateOptions, PtyCreateResult } from '../shared/types'
import {
  codexAccountHome,
  codexUsageAccounts,
  needsCodexAccountScope
} from './codex-accounts-core'
import { initPlatform, resetPlatformForTests } from './platform'
import { fakePlatform, type FakePlatform } from './platform-fake'

const spawned: Array<{ args: string[]; env: Record<string, string> }> = []

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
    fs.rmSync(userDataDir, { recursive: true, force: true })
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
