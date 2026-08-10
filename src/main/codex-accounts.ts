import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { ipcMain, type WebContents } from 'electron'
import { IPC } from '../shared/ipc'
import {
  assertCodexAccountId,
  commitCodexRolloutExposure,
  codexAccountHome,
  codexHomeForAccount,
  codexSessionEnv,
  codexSocketForAccount,
  ensureSharedCodexDaemon,
  legacyCodexAccountHome,
  migrateLegacyCodexAccountHome,
  migrateLegacyCodexAccountHomes,
  planCodexRolloutExposure,
  type CodexRolloutExposurePlan
} from '../core/codex-accounts-core'
import { readCodexAccountAt, readCodexThreadAt } from '../core/codex-session-name'
import { platform } from '../core/platform'
import { findInLoginPath } from '../core/pty-manager'

const execFileP = promisify(execFile)
const LOGIN_POLL_MS = 2000
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const SHARED_ENTRIES = ['config.toml', 'AGENTS.md', 'skills', 'plugins', 'packages', 'rules', 'hooks.json']
const SWITCH_RESERVATION_TTL_MS = 60_000
const waiters = new Map<string, { cancelled: boolean }>()
type PendingSwitchExposure = {
  exposure?: CodexRolloutExposurePlan
  sourceAccountId?: string
  targetAccountId?: string
  committed: boolean
  owner: WebContents
  ownerDestroyed: () => void
  timer: ReturnType<typeof setTimeout>
}
const pendingSwitchExposures = new Map<string, PendingSwitchExposure>()
const removingCodexAccounts = new Set<string>()

function releasePendingSwitch(token: string): void {
  const pending = pendingSwitchExposures.get(token)
  if (!pending) return
  pendingSwitchExposures.delete(token)
  clearTimeout(pending.timer)
  if (!pending.owner.isDestroyed()) pending.owner.removeListener('destroyed', pending.ownerDestroyed)
}

export function localCodexAccountHome(accountId: string): string {
  return codexAccountHome(platform().userDataDir, accountId)
}

export function localCodexSocket(accountId?: string): string {
  return codexSocketForAccount(platform().userDataDir, accountId)
}

export async function ensureCodexAccountDaemon(accountId?: string): Promise<void> {
  if (accountId) migrateLegacyCodexAccountHome(platform().userDataDir, accountId)
  const socket = localCodexSocket(accountId)
  await ensureSharedCodexDaemon(
    async () => (await readCodexAccountAt(socket, 1000)) !== null,
    async () => {
      const codex = await findInLoginPath('codex')
      if (!codex) throw new Error('Codex CLI unavailable')
      await execFileP(codex, ['app-server', 'daemon', 'start'], {
        cwd: os.homedir(),
        env: { ...process.env, ...codexSessionEnv(platform().userDataDir, accountId) },
        timeout: 15_000,
        maxBuffer: 1024 * 1024
      })
    }
  )
}

async function initializeAccountHome(id: string): Promise<string> {
  migrateLegacyCodexAccountHome(platform().userDataDir, id)
  const home = localCodexAccountHome(id)
  await fs.mkdir(home, { recursive: true, mode: 0o700 })
  await fs.chmod(home, 0o700)
  const sourceHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex')
  for (const name of SHARED_ENTRIES) {
    const source = path.join(sourceHome, name)
    const target = path.join(home, name)
    try {
      await fs.lstat(source)
      await fs.symlink(source, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' &&
          (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  return home
}

async function accountIdentity(accountId?: string): Promise<{ email: string | null } | null> {
  await ensureCodexAccountDaemon(accountId)
  return readCodexAccountAt(localCodexSocket(accountId), 5000)
}

async function existingManagedIdentity(id: string): Promise<{ email: string | null } | null> {
  assertCodexAccountId(id)
  try {
    migrateLegacyCodexAccountHome(platform().userDataDir, id)
    const auth = await fs.lstat(path.join(localCodexAccountHome(id), 'auth.json'))
    if (!auth.isFile() || auth.isSymbolicLink()) return null
    return await accountIdentity(id)
  } catch {
    return null
  }
}

export function initCodexAccounts(): void {
  // Synchronous before renderer hydration/PTY restore: legacy long CODEX_HOMEs cannot host the
  // app-server Unix socket, and an already persisted managed node must see its migrated home on
  // its very first spawn.
  migrateLegacyCodexAccountHomes(platform().userDataDir)

  ipcMain.handle(IPC.codexAccountsAdd, async () => {
    const id = randomUUID()
    return { id, home: await initializeAccountHome(id) }
  })

  ipcMain.handle(IPC.codexAccountsWaitLogin, async (_event, id: string) => {
    assertCodexAccountId(id)
    const home = localCodexAccountHome(id)
    const waiter = { cancelled: false }
    waiters.set(id, waiter)
    const deadline = Date.now() + LOGIN_TIMEOUT_MS
    try {
      while (!waiter.cancelled && Date.now() < deadline) {
        try {
          const auth = await fs.lstat(path.join(home, 'auth.json'))
          if (auth.isFile() && !auth.isSymbolicLink()) {
            const identity = await accountIdentity(id)
            if (identity) return identity
          }
        } catch {
          // Login has not produced a credential file yet, or its daemon is not ready.
        }
        await new Promise((resolve) => setTimeout(resolve, LOGIN_POLL_MS))
      }
      return null
    } finally {
      waiters.delete(id)
    }
  })

  ipcMain.handle(IPC.codexAccountsCancelWait, (_event, id: string) => {
    const waiter = waiters.get(id)
    if (waiter) waiter.cancelled = true
  })

  ipcMain.handle(IPC.codexAccountsIdentity, (_event, id: string) => existingManagedIdentity(id))

  ipcMain.handle(IPC.codexAccountsRemove, async (_event, id: string) => {
    assertCodexAccountId(id)
    if ([...pendingSwitchExposures.values()].some((pending) =>
      pending.sourceAccountId === id || pending.targetAccountId === id)) {
      throw new Error('Codex account is reserved by an account switch')
    }
    if (removingCodexAccounts.has(id)) throw new Error('Codex account removal is already in progress')
    removingCodexAccounts.add(id)
    try {
      const waiter = waiters.get(id)
      if (waiter) waiter.cancelled = true
      try {
        const codex = await findInLoginPath('codex')
        if (codex) {
          await execFileP(codex, ['app-server', 'daemon', 'stop'], {
            cwd: os.homedir(),
            env: { ...process.env, CODEX_HOME: localCodexAccountHome(id) },
            timeout: 10_000,
            maxBuffer: 1024 * 1024
          })
        }
      } catch {
        // A stopped/missing daemon is already the desired state.
      }
      const home = localCodexAccountHome(id)
      const legacy = legacyCodexAccountHome(platform().userDataDir, id)
      await fs.rm(home, { recursive: true, force: true })
      if (legacy !== home) await fs.rm(legacy, { recursive: true, force: true })
    } finally {
      removingCodexAccounts.delete(id)
    }
  })

  ipcMain.handle(IPC.codexAccountsSystemIdentity, () => accountIdentity())

  ipcMain.handle(IPC.codexAccountsCommitSwitch, (event, token: string) => {
    const pending = pendingSwitchExposures.get(token)
    if (!pending?.exposure || pending.owner.id !== event.sender.id) {
      throw new Error('Codex account switch preparation expired')
    }
    commitCodexRolloutExposure(pending.exposure)
    pending.committed = true
  })

  ipcMain.handle(IPC.codexAccountsFinishSwitch, (event, token: string) => {
    const pending = pendingSwitchExposures.get(token)
    if (!pending?.committed || pending.owner.id !== event.sender.id) {
      throw new Error('Codex account switch was not committed')
    }
    releasePendingSwitch(token)
  })

  ipcMain.handle(IPC.codexAccountsRollbackSwitch, (event, token: string) => {
    const pending = pendingSwitchExposures.get(token)
    if (pending?.owner.id === event.sender.id) releasePendingSwitch(token)
  })

  ipcMain.handle(
    IPC.codexAccountsSwitchThread,
    async (
      event,
      threadId: string,
      cwd: string,
      sourceAccountId?: string,
      targetAccountId?: string
    ) => {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(threadId) || !path.isAbsolute(cwd)) {
        throw new Error('Invalid Codex account switch request')
      }
      if (sourceAccountId) assertCodexAccountId(sourceAccountId)
      if (targetAccountId) assertCodexAccountId(targetAccountId)
      if (sourceAccountId === targetAccountId) return { threadId }
      if ((sourceAccountId && removingCodexAccounts.has(sourceAccountId)) ||
          (targetAccountId && removingCodexAccounts.has(targetAccountId))) {
        throw new Error('Codex account removal is in progress')
      }
      const rollbackToken = randomUUID()
      const ownerDestroyed = (): void => releasePendingSwitch(rollbackToken)
      const timer = setTimeout(() => releasePendingSwitch(rollbackToken), SWITCH_RESERVATION_TTL_MS)
      timer.unref?.()
      event.sender.once('destroyed', ownerDestroyed)
      pendingSwitchExposures.set(rollbackToken, {
        sourceAccountId,
        targetAccountId,
        committed: false,
        owner: event.sender,
        ownerDestroyed,
        timer
      })
      try {
        await ensureCodexAccountDaemon(sourceAccountId)
        await ensureCodexAccountDaemon(targetAccountId)
        const source = await readCodexThreadAt(localCodexSocket(sourceAccountId), threadId, 5000)
        if (!source?.path) throw new Error('Source Codex conversation is unavailable')
        const exposure = planCodexRolloutExposure(
          codexHomeForAccount(platform().userDataDir, sourceAccountId),
          codexHomeForAccount(platform().userDataDir, targetAccountId),
          source.path,
          threadId
        )
        const pending = pendingSwitchExposures.get(rollbackToken)
        if (!pending) throw new Error('Codex account switch preparation expired')
        pending.exposure = exposure
        return { threadId, rollbackToken }
      } catch (error) {
        releasePendingSwitch(rollbackToken)
        throw error
      }
    }
  )
}
