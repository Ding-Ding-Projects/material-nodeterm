import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, renameSync } from 'fs'
import os from 'os'
import path from 'path'

const ACCOUNT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function assertCodexAccountId(id: string): void {
  if (!ACCOUNT_ID_RE.test(id)) throw new Error('Invalid Codex account id')
}

export function legacyCodexAccountHome(userDataDir: string, accountId: string): string {
  assertCodexAccountId(accountId)
  return path.join(userDataDir, 'codex-accounts', accountId)
}

/**
 * `app-server-control.sock` lives below CODEX_HOME and macOS rejects Unix socket paths at
 * SUN_LEN. The normal Electron userData path plus a UUID is already too long, so managed
 * accounts use a deterministic short home. Include userDataDir in the digest to keep separate
 * NodeTerm profiles isolated while avoiding a global static account directory.
 */
export function codexAccountHome(
  userDataDir: string,
  accountId: string,
  shortRoot = path.join(os.homedir(), '.nodeterm', 'cx')
): string {
  assertCodexAccountId(accountId)
  const digest = createHash('sha256')
    .update(userDataDir)
    .update('\0')
    .update(accountId)
    .digest('hex')
    .slice(0, 16)
  return path.join(shortRoot, digest)
}

export function migrateLegacyCodexAccountHome(
  userDataDir: string,
  accountId: string,
  shortRoot?: string
): string {
  const legacy = legacyCodexAccountHome(userDataDir, accountId)
  const target = codexAccountHome(userDataDir, accountId, shortRoot)
  if (legacy === target || !existsSync(legacy) || existsSync(target)) return target
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  renameSync(legacy, target)
  return target
}

export function migrateLegacyCodexAccountHomes(
  userDataDir: string,
  shortRoot?: string
): void {
  const legacyRoot = path.join(userDataDir, 'codex-accounts')
  let entries: Array<{ name: string; isDirectory(): boolean }>
  try {
    entries = readdirSync(legacyRoot, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      migrateLegacyCodexAccountHome(userDataDir, entry.name, shortRoot)
    } catch {
      // Invalid/unmovable entries remain untouched and therefore fail closed.
    }
  }
}

export function systemCodexHome(): string {
  const configured = process.env.CODEX_HOME?.trim()
  return configured && path.isAbsolute(configured) ? configured : path.join(os.homedir(), '.codex')
}

export function codexHomeForAccount(userDataDir: string, accountId?: string): string {
  return accountId ? codexAccountHome(userDataDir, accountId) : systemCodexHome()
}

export function codexSocketForAccount(userDataDir: string, accountId?: string): string {
  return path.join(codexHomeForAccount(userDataDir, accountId), 'app-server-control', 'app-server-control.sock')
}

/** Explicit per-session env. The empty account id means system and overwrites inherited scope. */
export function codexSessionEnv(
  userDataDir: string,
  accountId?: string
): { CODEX_HOME: string; NODETERM_CODEX_ACCOUNT_ID: string } {
  return {
    CODEX_HOME: codexHomeForAccount(userDataDir, accountId),
    NODETERM_CODEX_ACCOUNT_ID: accountId ?? ''
  }
}

/** Codex agents need an explicit system-or-managed scope; a plain login terminal needs it when
 * it carries a managed account id. Sharing this predicate keeps tmux and plain PTYs aligned. */
export function needsCodexAccountScope(agentId?: string, accountId?: string): boolean {
  return agentId === 'codex' || !!accountId
}

/** Usage discovery follows actual account homes, not the renderer's eventually-consistent
 * `pending` marker. A completed auth file can exist after a restart before settings reconciles;
 * the provider itself safely reports `unavailable` when the home is not logged in yet. */
export function codexUsageAccounts(
  accounts: ReadonlyArray<{
    id: string
    label: string
    email?: string | null
    pending?: boolean
  }>,
  homeFor: (accountId: string) => string
): Array<{ id: string; home: string; label: string; email?: string | null }> {
  return accounts.map((account) => ({
    id: account.id,
    home: homeFor(account.id),
    label: account.label,
    email: account.email
  }))
}

/** tmux has a shared server env, so both values must be set explicitly per new Codex session. */
export function codexTmuxEnvArgs(userDataDir: string, accountId?: string): string[] {
  return Object.entries(codexSessionEnv(userDataDir, accountId)).flatMap(([key, value]) => [
    '-e',
    `${key}=${value}`
  ])
}

/** Reuse a healthy account-scoped daemon; start one only when its control RPC is unavailable. */
export async function ensureSharedCodexDaemon(
  probe: () => Promise<boolean>,
  start: () => Promise<void>
): Promise<void> {
  if (await probe()) return
  await start()
}
