import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import {
  assertCodexAccountId,
  codexAccountHome,
  codexSessionEnv,
  codexSocketForAccount
} from '../core/codex-accounts-core'
import {
  forkCodexThreadFromPathAt,
  readCodexAccountAt,
  readCodexThreadAt
} from '../core/codex-session-name'
import { platform } from '../core/platform'
import { findInLoginPath } from '../core/pty-manager'

const execFileP = promisify(execFile)
const LOGIN_POLL_MS = 2000
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const SHARED_ENTRIES = ['config.toml', 'AGENTS.md', 'skills', 'plugins', 'packages', 'rules', 'hooks.json']
const waiters = new Map<string, { cancelled: boolean }>()

export function localCodexAccountHome(accountId: string): string {
  return codexAccountHome(platform().userDataDir, accountId)
}

export function localCodexSocket(accountId?: string): string {
  return codexSocketForAccount(platform().userDataDir, accountId)
}

export async function ensureCodexAccountDaemon(accountId?: string): Promise<void> {
  if (accountId) assertCodexAccountId(accountId)
  const codex = await findInLoginPath('codex')
  if (!codex) throw new Error('Codex CLI unavailable')
  await execFileP(codex, ['app-server', 'daemon', 'start'], {
    env: { ...process.env, ...codexSessionEnv(platform().userDataDir, accountId) },
    timeout: 15_000,
    maxBuffer: 1024 * 1024
  })
}

async function initializeAccountHome(id: string): Promise<string> {
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
    const auth = await fs.lstat(path.join(localCodexAccountHome(id), 'auth.json'))
    if (!auth.isFile() || auth.isSymbolicLink()) return null
    return await accountIdentity(id)
  } catch {
    return null
  }
}

export function initCodexAccounts(): void {
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
    const waiter = waiters.get(id)
    if (waiter) waiter.cancelled = true
    try {
      const codex = await findInLoginPath('codex')
      if (codex) {
        await execFileP(codex, ['app-server', 'daemon', 'stop'], {
          env: { ...process.env, CODEX_HOME: localCodexAccountHome(id) },
          timeout: 10_000,
          maxBuffer: 1024 * 1024
        })
      }
    } catch {
      // A stopped/missing daemon is already the desired state.
    }
    await fs.rm(localCodexAccountHome(id), { recursive: true, force: true })
  })

  ipcMain.handle(IPC.codexAccountsSystemIdentity, () => accountIdentity())

  ipcMain.handle(
    IPC.codexAccountsForkThread,
    async (
      _event,
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
      if (sourceAccountId === targetAccountId) return threadId
      await ensureCodexAccountDaemon(sourceAccountId)
      await ensureCodexAccountDaemon(targetAccountId)
      const source = await readCodexThreadAt(localCodexSocket(sourceAccountId), threadId, 5000)
      if (!source?.path) throw new Error('Source Codex conversation is unavailable')
      return forkCodexThreadFromPathAt(
        localCodexSocket(targetAccountId),
        source.path,
        cwd,
        10_000
      )
    }
  )
}
