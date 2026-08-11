import { createHash, randomUUID } from 'crypto'
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync
} from 'fs'
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

export function migrateLegacyCodexAccountHomes(userDataDir: string, shortRoot?: string): void {
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
  return path.join(
    codexHomeForAccount(userDataDir, accountId),
    'app-server-control',
    'app-server-control.sock'
  )
}

/** Short, deterministic remote homes keep the app-server Unix socket below SUN_LEN. */
export function remoteCodexHome(remoteHome: string, accountId?: string): string {
  if (!path.posix.isAbsolute(remoteHome)) throw new Error('Remote home must be absolute')
  if (!accountId) return path.posix.join(remoteHome, '.codex')
  assertCodexAccountId(accountId)
  const digest = createHash('sha256').update(accountId).digest('hex').slice(0, 16)
  return path.posix.join(remoteHome, '.nodeterm', 'cx', digest)
}

export function remoteCodexSocket(remoteHome: string, accountId?: string): string {
  return path.posix.join(
    remoteCodexHome(remoteHome, accountId),
    'app-server-control',
    'app-server-control.sock'
  )
}

export function remoteCodexSessionEnv(
  remoteHome: string,
  accountId?: string
): { CODEX_HOME: string; NODETERM_CODEX_ACCOUNT_ID: string } {
  return {
    CODEX_HOME: remoteCodexHome(remoteHome, accountId),
    NODETERM_CODEX_ACCOUNT_ID: accountId ?? ''
  }
}

export function remoteCodexTmuxEnvArgs(remoteHome: string, accountId?: string): string[] {
  return Object.entries(remoteCodexSessionEnv(remoteHome, accountId)).flatMap(([key, value]) => [
    '-e',
    `${key}=${value}`
  ])
}

function containedRelativePath(root: string, candidate: string): string | null {
  const relative = path.relative(root, candidate)
  return relative &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
    ? relative
    : null
}

export interface CodexRolloutExposurePlan {
  sourcePath: string
  targetSessionsRoot: string
  targetRelativePath: string
  targetPath: string
  sourceDev: number
  sourceIno: number
}

/** Validate a cross-account rollout before the renderer's second idle check. No files mutate. */
export function planCodexRolloutExposure(
  sourceHome: string,
  targetHome: string,
  sourcePath: string,
  threadId: string
): CodexRolloutExposurePlan {
  if (
    !path.isAbsolute(sourceHome) ||
    !path.isAbsolute(targetHome) ||
    !path.isAbsolute(sourcePath) ||
    !ACCOUNT_ID_RE.test(threadId) ||
    !path.basename(sourcePath).endsWith(`${threadId}.jsonl`)
  ) {
    throw new Error('Invalid Codex rollout exposure request')
  }
  if (!lstatSync(sourcePath).isFile()) throw new Error('Source Codex rollout is not a regular file')
  const sourceSessions = realpathSync(path.join(sourceHome, 'sessions'))
  const canonicalSource = realpathSync(sourcePath)
  const relative = containedRelativePath(sourceSessions, canonicalSource)
  if (!relative) throw new Error('Source Codex rollout is outside its account home')
  const sourceStat = statSync(canonicalSource)
  const targetSessionsRoot = path.join(realpathSync(targetHome), 'sessions')
  return {
    sourcePath: canonicalSource,
    targetSessionsRoot,
    targetRelativePath: relative,
    targetPath: path.join(targetSessionsRoot, relative),
    sourceDev: sourceStat.dev,
    sourceIno: sourceStat.ino
  }
}

/** Commit after the renderer revalidates idle/session state. Hardlinks are atomic and survive
 * deletion of either account home because every link names the same inode independently. */
export function commitCodexRolloutExposure(
  plan: CodexRolloutExposurePlan,
  linkFile: typeof linkSync = linkSync
): void {
  const isVerifiedRollout = (candidate: string): boolean => {
    try {
      const entry = lstatSync(candidate)
      const linked = statSync(candidate)
      return (
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        linked.dev === plan.sourceDev &&
        linked.ino === plan.sourceIno
      )
    } catch {
      return false
    }
  }
  const sourceEntry = lstatSync(plan.sourcePath)
  if (!sourceEntry.isFile() || sourceEntry.isSymbolicLink()) {
    throw new Error('Source Codex rollout changed before account switch commit')
  }
  const current = statSync(plan.sourcePath)
  if (current.dev !== plan.sourceDev || current.ino !== plan.sourceIno) {
    throw new Error('Source Codex rollout changed before account switch commit')
  }
  const segments = path.dirname(plan.targetRelativePath).split(path.sep).filter(Boolean)
  let currentDir = plan.targetSessionsRoot
  for (const segment of ['', ...segments]) {
    if (segment) currentDir = path.join(currentDir, segment)
    if (!existsSync(currentDir)) mkdirSync(currentDir, { mode: 0o700 })
    const entry = lstatSync(currentDir)
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error('Target Codex rollout path contains an unsafe directory')
    }
  }
  if (existsSync(plan.targetPath)) {
    if (!isVerifiedRollout(plan.targetPath)) {
      throw new Error('Target Codex account already has a different rollout for this thread')
    }
    return
  }
  const temporaryPath = path.join(
    path.dirname(plan.targetPath),
    `.${path.basename(plan.targetPath)}.${randomUUID()}.nodeterm-link`
  )
  linkFile(plan.sourcePath, temporaryPath)
  const createdTemporary = lstatSync(temporaryPath)
  const temporaryStillOurs = (): boolean => {
    try {
      const currentTemporary = lstatSync(temporaryPath)
      return (
        currentTemporary.dev === createdTemporary.dev &&
        currentTemporary.ino === createdTemporary.ino
      )
    } catch {
      return false
    }
  }
  try {
    if (!isVerifiedRollout(temporaryPath)) {
      throw new Error('Temporary Codex rollout did not preserve the verified source inode')
    }
    try {
      // link(2) is no-overwrite. Publishing from the verified private name prevents cleanup from
      // ever deleting an unrelated entry raced into the final pathname.
      linkFile(temporaryPath, plan.targetPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !isVerifiedRollout(plan.targetPath))
        throw error
    }
    if (!isVerifiedRollout(plan.targetPath)) {
      throw new Error('Target Codex rollout did not preserve the verified source inode')
    }
  } finally {
    // The private pathname may itself have been replaced. Delete it only while it still names
    // the exact inode created by our link(2), even when a source race made that inode invalid.
    if (temporaryStillOurs()) {
      try {
        unlinkSync(temporaryPath)
      } catch {}
    }
  }
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
