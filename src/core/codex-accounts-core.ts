import os from 'os'
import path from 'path'

const ACCOUNT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function assertCodexAccountId(id: string): void {
  if (!ACCOUNT_ID_RE.test(id)) throw new Error('Invalid Codex account id')
}

export function codexAccountHome(userDataDir: string, accountId: string): string {
  assertCodexAccountId(accountId)
  return path.join(userDataDir, 'codex-accounts', accountId)
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

/** tmux has a shared server env, so both values must be set explicitly per new Codex session. */
export function codexTmuxEnvArgs(userDataDir: string, accountId?: string): string[] {
  return Object.entries(codexSessionEnv(userDataDir, accountId)).flatMap(([key, value]) => [
    '-e',
    `${key}=${value}`
  ])
}
