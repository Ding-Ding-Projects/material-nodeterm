import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { CorePlatform } from '../platform'
import type { CommandResult, CommandRunner } from './credentials'
import { IPC } from '../../shared/ipc'
import type {
  GitHubCliAccount,
  GitHubCliAccountsApi,
  GitHubCliAccountList,
  GitHubCliLoginSession,
  GitHubCliRefreshInput
} from '../../shared/github-issues'

const MAX_OUTPUT = 64 * 1024
const SESSION_TTL_MS = 15 * 60_000
const START_WAIT_MS = 8_000
const ALLOWED_HOST = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}[A-Za-z0-9]$/

type RawHost = {
  host?: unknown
  users?: unknown
}

type RawUser = {
  login?: unknown
  active?: unknown
  state?: unknown
  tokenSource?: unknown
}

type LoginProcess = {
  session: GitHubCliLoginSession
  process: ChildProcessWithoutNullStreams
  output: string
}

function bounded(value: string): string {
  return value.length <= MAX_OUTPUT ? value : value.slice(0, MAX_OUTPUT)
}

function safeHost(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 253 || !ALLOWED_HOST.test(value)) return null
  return value.toLowerCase()
}

function safeLogin(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(value) ? value : null
}

function parseJson(stdout: string): unknown {
  try { return JSON.parse(stdout) } catch { return null }
}

function parseHosts(stdout: string): Array<{ host: string; users: Array<{
  login: string
  active: boolean
  state: GitHubCliAccount['state']
  tokenSource?: string
}> }> {
  const parsed = parseJson(stdout)
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { hosts?: unknown }).hosts)) {
    return []
  }
  const result: Array<{ host: string; users: Array<{
    login: string
    active: boolean
    state: GitHubCliAccount['state']
    tokenSource?: string
  }> }> = []
  for (const candidate of (parsed as { hosts: unknown[] }).hosts) {
    if (!candidate || typeof candidate !== 'object') continue
    const host = safeHost((candidate as RawHost).host)
    const rawUsers = (candidate as RawHost).users
    if (!host || !Array.isArray(rawUsers)) continue
    const users = [] as Array<{
      login: string
      active: boolean
      state: GitHubCliAccount['state']
      tokenSource?: string
    }>
    for (const item of rawUsers) {
      if (!item || typeof item !== 'object') continue
      const login = safeLogin((item as RawUser).login)
      if (!login) continue
      const state = (item as RawUser).state === 'authenticated'
        ? 'authenticated'
        : (item as RawUser).state === 'unauthenticated' ? 'unauthenticated' : 'unknown'
      const tokenSource = typeof (item as RawUser).tokenSource === 'string'
        ? bounded((item as RawUser).tokenSource as string)
        : undefined
      users.push({ login, active: (item as RawUser).active === true, state, ...(tokenSource ? { tokenSource } : {}) })
    }
    result.push({ host, users })
  }
  return result
}

function parseHeaderScopes(stdout: string): string[] {
  const line = stdout.split(/\r?\n/).find((item) => /^x-oauth-scopes\s*:/i.test(item))
  if (!line) return []
  const value = line.slice(line.indexOf(':') + 1)
  return value.split(',').map((scope) => scope.trim()).filter(Boolean).slice(0, 100)
}

function parseLines(stdout: string): string[] {
  return stdout.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(line)).slice(0, 500)
}

function sanitizeError(result: CommandResult): string {
  const text = bounded(result.stderr || 'GitHub CLI command failed')
  return text.replace(/\b(?:gh[pous]_|github_pat_)[A-Za-z0-9_]+\b/g, '[credential omitted]')
}

export class GitHubCliAccountService {
  private readonly logins = new Map<string, LoginProcess>()

  constructor(
    private readonly run: CommandRunner,
    private readonly openExternal?: (url: string) => Promise<void>
  ) {}

  async listAccounts(): Promise<GitHubCliAccountList> {
    // Do not constrain this discovery to github.com: `gh` can retain several enterprise hosts and
    // the account list must tell the user about every stored host without reading credentials.
    const status = await this.run('gh', ['auth', 'status', '--json', 'hosts'])
    const discovered = parseHosts(status.stdout)
    if (!status.ok && discovered.length === 0) {
      return { accounts: [], active: null, ghInstalled: !/not found|not recognized/i.test(status.stderr), refreshedAt: Date.now(), error: sanitizeError(status) }
    }
    const accounts: GitHubCliAccount[] = []
    for (const hostEntry of discovered) {
      for (const user of hostEntry.users) {
        const account: GitHubCliAccount = {
          host: hostEntry.host,
          login: user.login,
          active: user.active,
          state: user.state,
          scopes: [],
          organizations: [],
          writableOwners: [],
          ...(user.tokenSource ? { tokenSource: user.tokenSource } : {})
        }
        if (user.state === 'authenticated') {
          const details = await this.inspectAccount(hostEntry.host, user.login, user.active)
          Object.assign(account, details)
        }
        accounts.push(account)
      }
    }
    const active = accounts.find((account) => account.active && account.state === 'authenticated') ?? null
    return { accounts, active, ghInstalled: true, refreshedAt: Date.now() }
  }

  async switchActive(host: string, login: string): Promise<GitHubCliAccountList> {
    this.assertAccount(host, login)
    const result = await this.run('gh', ['auth', 'switch', '--hostname', host, '--user', login])
    if (!result.ok) throw new Error(sanitizeError(result))
    return this.listAccounts()
  }

  async signOut(host: string, login: string): Promise<GitHubCliAccountList> {
    this.assertAccount(host, login)
    const result = await this.run('gh', ['auth', 'logout', '--hostname', host, '--user', login, '--yes'])
    if (!result.ok) throw new Error(sanitizeError(result))
    return this.listAccounts()
  }

  startLogin(): Promise<GitHubCliLoginSession> {
    return this.startInteractive(['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web'])
  }

  refreshAuthorization(input: GitHubCliRefreshInput): Promise<GitHubCliLoginSession> {
    this.assertAccount(input.host, input.login)
    const args = ['auth', 'refresh', '--hostname', input.host, '--user', input.login]
    if (input.scopes?.length) {
      const scopes = input.scopes.filter((scope) => /^[a-z][a-z0-9:._-]{0,63}$/i.test(scope)).slice(0, 50)
      if (scopes.length !== input.scopes.length) throw new Error('One or more requested scopes are invalid.')
      args.push('--scopes', scopes.join(','))
    }
    return this.startInteractive(args)
  }

  loginStatus(sessionId: string): GitHubCliLoginSession {
    const item = this.logins.get(sessionId)
    if (!item) return { id: sessionId, state: 'expired', startedAt: 0, expiresAt: 0 }
    if (Date.now() >= item.session.expiresAt && item.session.state === 'waiting') {
      item.session = { ...item.session, state: 'expired', message: 'The sign-in window expired. Start a new sign-in.' }
      item.process.kill()
      this.logins.delete(sessionId)
    }
    return { ...item.session }
  }

  cancelLogin(sessionId: string): Promise<void> {
    const item = this.logins.get(sessionId)
    if (!item) return Promise.resolve()
    item.session = { ...item.session, state: 'cancelled', message: 'Sign-in cancelled.' }
    item.process.kill()
    this.logins.delete(sessionId)
    return Promise.resolve()
  }

  register(platform: CorePlatform): GitHubCliAccountsApi {
    const api: GitHubCliAccountsApi = {
      list: () => this.listAccounts(),
      switchActive: (host, login) => this.switchActive(host, login),
      signOut: (host, login) => this.signOut(host, login),
      startLogin: () => this.startLogin(),
      loginStatus: (id) => this.loginStatus(id),
      cancelLogin: (id) => this.cancelLogin(id),
      refreshAuthorization: (input) => this.refreshAuthorization(input)
    }
    platform.handle(IPC.githubCliAccountsList, api.list)
    platform.handle(IPC.githubCliAccountsSwitch, api.switchActive)
    platform.handle(IPC.githubCliAccountsSignOut, api.signOut)
    platform.handle(IPC.githubCliAccountsStartLogin, api.startLogin)
    platform.handle(IPC.githubCliAccountsLoginStatus, api.loginStatus)
    platform.handle(IPC.githubCliAccountsCancelLogin, api.cancelLogin)
    platform.handle(IPC.githubCliAccountsRefresh, api.refreshAuthorization)
    return api
  }

  private async inspectAccount(
    host: string,
    login: string,
    alreadyActive: boolean
  ): Promise<Pick<GitHubCliAccount, 'scopes' | 'organizations' | 'writableOwners' | 'active'>> {
    const restore = alreadyActive ? null : await this.activeLogin(host)
    try {
      if (!alreadyActive) {
        const switched = await this.run('gh', ['auth', 'switch', '--hostname', host, '--user', login])
        if (!switched.ok) return { scopes: [], organizations: [], writableOwners: [], active: false }
      }
      const identity = await this.run('gh', ['api', '--hostname', host, 'user', '--include'])
      const scopes = identity.ok ? parseHeaderScopes(identity.stdout) : []
      const organizations = await this.run('gh', ['api', '--hostname', host, 'user/orgs', '--paginate', '--jq', '.[].login'])
      const writable = await this.run('gh', [
        'api', '--hostname', host, 'user/orgs', '--paginate', '--jq',
        '.[] | select(.permissions.push == true or .permissions.admin == true) | .login'
      ])
      const orgs = organizations.ok ? parseLines(organizations.stdout) : []
      const owners = writable.ok ? parseLines(writable.stdout) : []
      return { scopes, organizations: orgs, writableOwners: [login, ...owners.filter((owner) => owner !== login)], active: alreadyActive }
    } finally {
      if (restore) {
        await this.run('gh', ['auth', 'switch', '--hostname', host, '--user', restore]).catch(() => undefined)
      }
    }
  }

  private async activeLogin(host: string): Promise<string | null> {
    const status = await this.run('gh', ['auth', 'status', '--hostname', host, '--json', 'hosts'])
    const hostEntry = parseHosts(status.stdout).find((entry) => entry.host === host)
    return hostEntry?.users.find((user) => user.active)?.login ?? null
  }

  private assertAccount(host: string, login: string): void {
    if (!safeHost(host) || !safeLogin(login)) throw new Error('Invalid GitHub account target.')
  }

  private startInteractive(args: string[]): Promise<GitHubCliLoginSession> {
    const id = randomUUID()
    const startedAt = Date.now()
    const session: GitHubCliLoginSession = {
      id,
      state: 'starting',
      startedAt,
      expiresAt: startedAt + SESSION_TTL_MS
    }
    const child = spawn('gh', args, {
      shell: false,
      windowsHide: true,
      env: { ...process.env, GH_BROWSER: 'echo' }
    })
    const item: LoginProcess = { session, process: child, output: '' }
    this.logins.set(id, item)
    const consume = (chunk: Buffer): void => {
      item.output = bounded(`${item.output}${chunk.toString('utf8')}`)
      const code = item.output.match(/(?:one-time code|code)\s*:\s*([A-Z0-9-]{4,20})/i)?.[1]
      const uri = item.output.match(/https:\/\/github\.com\/login\/device[^\s\r\n]*/i)?.[0]
      if (code || uri) {
        item.session = {
          ...item.session,
          state: 'waiting',
          ...(code ? { userCode: code } : {}),
          ...(uri ? { verificationUri: uri } : {}),
          message: 'Approve this sign-in in your browser. Credentials stay in the GitHub CLI store.'
        }
        if (code && !item.session.opened) {
          item.session = { ...item.session, opened: true }
          if (this.openExternal) void this.openExternal(uri ?? 'https://github.com/login/device').catch(() => undefined)
          try { child.stdin.write('\n') } catch { /* the CLI may have exited after printing its challenge */ }
        }
      }
    }
    child.stdout.on('data', consume)
    child.stderr.on('data', consume)
    child.once('error', (error) => {
      item.session = { ...item.session, state: 'failed', message: bounded(error.message) }
    })
    child.once('exit', (code) => {
      if (item.session.state === 'cancelled' || item.session.state === 'expired') return
      item.session = {
        ...item.session,
        state: code === 0 ? 'completed' : 'failed',
        message: code === 0 ? 'Sign-in completed. Refresh the account list to verify it.' : 'GitHub CLI sign-in did not complete.'
      }
      setTimeout(() => this.logins.delete(id), 30_000)
    })
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ...item.session }), START_WAIT_MS)
      const check = (): void => {
        if (item.session.state !== 'starting') {
          clearTimeout(timer)
          resolve({ ...item.session })
          return
        }
        setTimeout(check, 50)
      }
      check()
    })
  }
}
