import { promises as fs } from 'node:fs'
import path from 'node:path'
import { clearAtomicTarget, sweepStaleTempFiles } from '../core/fs-atomic'
import {
  readAtomicFileSnapshot,
  withCrossProcessLock,
  writeAtomicFileCompared,
  type CrossProcessLease
} from '../core/fs-transaction-lock'
import type { GitHubSecretStore } from '../core/github/credentials'
import {
  GitHubTokenDocumentError,
  parseGitHubTokenDocument,
  validGitHubToken,
  type GitHubTokenDocument
} from '../core/github/token-document'
import type { CorePlatform } from '../core/platform'
import type { GitHubHostController } from '../core/github/host'
import { IPC } from '../shared/ipc'

const FILE_NAME = 'github-issues-token.json'

export class ServerGitHubSecretError extends Error {
  constructor(readonly code: 'invalid-token' | 'clear-incomplete') {
    super(code)
  }
}

async function atomicWrite(file: string, document: GitHubTokenDocument, expectedRevision: string, lease: CrossProcessLease): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await sweepStaleTempFiles(file)
  await writeAtomicFileCompared(file, JSON.stringify(document), expectedRevision, lease, { encoding: 'utf8', mode: 0o600 })
}

export class ServerGitHubSecretStore implements GitHubSecretStore {
  readonly availability = 'restricted-file' as const
  private chain: Promise<unknown> = Promise.resolve()
  constructor(private readonly userDataDir: string) {}
  private chained<T>(fn: () => Promise<T>): Promise<T> { const run = this.chain.then(fn); this.chain = run.catch(() => {}); return run }
  private get filePath(): string { return path.join(this.userDataDir, FILE_NAME) }
  save(token: string): Promise<void> { return this.chained(() => withCrossProcessLock(this.filePath, (lease) => this.saveNow(token, lease))) }
  private async saveNow(token: string, lease: CrossProcessLease): Promise<void> {
    if (!validGitHubToken(token)) throw new ServerGitHubSecretError('invalid-token')
    const current = await readAtomicFileSnapshot(this.filePath)
    if (current.exists) {
      let value: unknown
      try { value = JSON.parse(current.data.toString('utf8')) } catch (cause) { throw new GitHubTokenDocumentError('The stored GitHub credential document is corrupt.', { cause }) }
      const existing = parseGitHubTokenDocument(value)
      if (existing.kind === 'safe-storage') throw new GitHubTokenDocumentError('The stored GitHub credential requires Desktop keyring access and was preserved.')
    }
    await atomicWrite(this.filePath, { version: 1, kind: 'restricted-file', token }, current.revision, lease)
  }
  clear(): Promise<void> { return this.chained(() => withCrossProcessLock(this.filePath, async (lease) => { await lease.fence(); const result = await clearAtomicTarget(this.filePath); if (!result.cleared) throw new ServerGitHubSecretError('clear-incomplete') })) }
  async readForHost(): Promise<string | null> {
    const snapshot = await readAtomicFileSnapshot(this.filePath)
    if (!snapshot.exists) return null
    let value: unknown
    try { value = JSON.parse(snapshot.data.toString('utf8')) } catch (cause) { throw new GitHubTokenDocumentError('The stored GitHub credential document is corrupt.', { cause }) }
    const document = parseGitHubTokenDocument(value)
    if (document.kind === 'safe-storage') throw new GitHubTokenDocumentError('The stored GitHub credential requires Desktop keyring access.')
    return document.token
  }
}

type Controller = Pick<GitHubHostController, 'status' | 'approve' | 'revoke' | 'selectProvider' | 'saveToken' | 'clearToken'>
export function registerServerGitHubControl(platform: CorePlatform, controller: Controller): void {
  platform.handle(IPC.githubControlStatus, (projectId?: string) => controller.status(projectId))
  platform.handle(IPC.githubControlApprove, (input) => controller.approve(input))
  platform.handle(IPC.githubControlRevoke, (input) => controller.revoke(input))
  platform.handle(IPC.githubControlSelectProvider, (input) => controller.selectProvider(input))
  platform.handle(IPC.githubControlSaveToken, (token: string) => controller.saveToken(token))
  platform.handle(IPC.githubControlClearToken, () => controller.clearToken())
}
