import { promises as fs } from 'node:fs'
import path from 'node:path'
import { clearAtomicTarget, renameAtomic, sweepStaleTempFiles, tempNameFor } from '../core/fs-atomic'
import type { GitHubSecretStore } from '../core/github/credentials'
import type { CorePlatform } from '../core/platform'
import type { GitHubHostController } from '../core/github/host'
import { IPC } from '../shared/ipc'

const FILE_NAME = 'github-issues-token.json'

export class ServerGitHubSecretError extends Error {
  constructor(readonly code: 'invalid-token' | 'clear-incomplete') {
    super(code)
  }
}

function validToken(token: string): boolean {
  return token.trim() === token && token.length > 0 && token.length <= 4096 && !/[\r\n\0]/.test(token)
}

export class ServerGitHubSecretStore implements GitHubSecretStore {
  readonly availability = 'restricted-file' as const

  /** Mutations run FIFO (the WorkspaceStore.saveChain idiom): a clear's rm must never land inside
   *  an in-flight save's write-to-rename window — the parked rename would resurrect the PAT the
   *  UI just reported cleared. Each caller still sees only its own mutation's failure. */
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly userDataDir: string) {}

  private chained<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn)
    this.chain = run.catch(() => {})
    return run
  }

  private get filePath(): string {
    return path.join(this.userDataDir, FILE_NAME)
  }

  save(token: string): Promise<void> {
    return this.chained(() => this.saveNow(token))
  }

  private async saveNow(token: string): Promise<void> {
    if (!validToken(token)) throw new ServerGitHubSecretError('invalid-token')
    await fs.mkdir(this.userDataDir, { recursive: true })
    await sweepStaleTempFiles(this.filePath)
    // The store's per-instance chain orders this write against its sibling mutations; the per-call
    // temp name covers the writers the chain cannot see — a second `nodeterm-server --data-dir X`
    // process on the same dir, even across a PID namespace, and a crash between tmp-write and
    // rename. With a shared name one writer's rename publishes the other's
    // half-written PAT, or moves the file out from under it entirely and the loser's rename fails.
    // The rename itself now retries a transient Windows sharing-violation error — see
    // src/core/fs-atomic.ts.
    const temporary = tempNameFor(this.filePath)
    try {
      await fs.writeFile(temporary, JSON.stringify({ version: 1, token }), {
        encoding: 'utf-8',
        mode: 0o600
      })
      await fs.chmod(temporary, 0o600)
      await renameAtomic(temporary, this.filePath)
    } catch (error) {
      // A failed write MUST remove its own temp, because here a leaked temp IS a leaked PAT: a
      // unique name is never written again, so only this cleanup (or a later sweep after the age
      // grace and an owner pid no longer visible here mark it abandoned) will collect it. The error propagates.
      await fs.rm(temporary, { force: true }).catch(() => {})
      throw error
    }
    await fs.chmod(this.filePath, 0o600)
  }

  clear(): Promise<void> {
    return this.chained(async () => {
      const result = await clearAtomicTarget(this.filePath)
      if (!result.cleared) throw new ServerGitHubSecretError('clear-incomplete')
    })
  }

  async readForHost(): Promise<string | null> {
    try {
      const value: unknown = JSON.parse(await fs.readFile(this.filePath, 'utf-8'))
      const token = value && typeof value === 'object' &&
        (value as { version?: unknown }).version === 1
        ? (value as { token?: unknown }).token
        : null
      return typeof token === 'string' && validToken(token) ? token : null
    } catch {
      return null
    }
  }
}

type Controller = Pick<GitHubHostController,
  'status' | 'approve' | 'revoke' | 'selectProvider' | 'saveToken' | 'clearToken'>

export function registerServerGitHubControl(
  platform: CorePlatform,
  controller: Controller
): void {
  platform.handle(IPC.githubControlStatus, (projectId?: string) => controller.status(projectId))
  platform.handle(IPC.githubControlApprove, (input) => controller.approve(input))
  platform.handle(IPC.githubControlRevoke, (input) => controller.revoke(input))
  platform.handle(IPC.githubControlSelectProvider, (input) => controller.selectProvider(input))
  platform.handle(IPC.githubControlSaveToken, (token: string) => controller.saveToken(token))
  platform.handle(IPC.githubControlClearToken, () => controller.clearToken())
}
