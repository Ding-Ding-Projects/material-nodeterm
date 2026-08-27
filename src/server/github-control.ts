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
import { renameAtomic, tempNameFor } from '../core/fs-atomic'
import type { GitHubSecretStore } from '../core/github/credentials'
import type { SecretStore } from '../core/secret-store'
import type { CorePlatform } from '../core/platform'
import type { GitHubHostController } from '../core/github/host'
import { IPC } from '../shared/ipc'

const FILE_NAME = 'github-issues-token.json'

export class ServerGitHubSecretError extends Error {
  constructor(readonly code: 'invalid-token' | 'clear-incomplete') {
export class ServerSecretStoreError extends Error {
  constructor(readonly code: 'invalid-token') {
    super(code)
  }
}

async function atomicWrite(
  file: string,
  document: GitHubTokenDocument,
  expectedRevision: string,
  lease: CrossProcessLease
): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await sweepStaleTempFiles(file)
  await writeAtomicFileCompared(file, JSON.stringify(document), expectedRevision, lease, {
    encoding: 'utf8',
    mode: 0o600
  })
function validToken(token: string): boolean {
  return token.trim() === token && token.length > 0 && token.length <= 4096 && !/[\r\n\0]/.test(token)
}

/**
 * Remove temp files no writer in THIS process owns: the legacy fixed `<file>.tmp` (written by
 * builds before per-call names) and any `<file>.<pid>.<seq>[.<uuid>].tmp` whose pid is not ours.
 * Best effort — a failure here must never break a save.
 *
 * The token file is not config: an orphan here is a live PAT at 0600 that nothing will ever
 * overwrite, because a unique name is never written twice. So it has to be collected rather than
 * left. Temps bearing our own pid are untouchable: one may belong to a concurrent write sitting
 * between its `writeFile` and its `rename`, and deleting it would recreate the exact race the
 * unique names fixed. A foreign pid can be a second LIVE server on the same data dir; that setup
 * has no lock to begin with, and the worst case is that process's rename failing cleanly (ENOENT,
 * rethrown to its caller) instead of a forgotten PAT sitting on disk forever.
 */
async function sweepStaleTmp(target: string): Promise<void> {
  try {
    const directory = path.dirname(target)
    const base = path.basename(target)
    for (const entry of await fs.readdir(directory)) {
      if (!entry.startsWith(base) || !entry.endsWith('.tmp')) continue
      const middle = entry.slice(base.length, -'.tmp'.length) // '' or '.<pid>.<seq>[.<uuid>]'
      const owner =
        /^\.(\d+)\.\d+(?:\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?$/
          .exec(middle)?.[1]
      if (middle === '' || (owner && owner !== String(process.pid))) {
        await fs.rm(path.join(directory, entry), { force: true }).catch(() => undefined)
      }
    }
  } catch {
    // A dir we cannot read is not a reason to fail (or skip) the write below.
  }
}

/** Generic headless secret store. Server Edition has no OS keyring, so callers receive the same
 *  owner-only atomic file semantics instead of copying the GitHub token implementation. */
export class ServerSecretStore implements SecretStore {
  readonly availability = 'restricted-file' as const

  /** Mutations run FIFO (the WorkspaceStore.saveChain idiom): a clear's rm must never land inside
   *  an in-flight save's write-to-rename window — the parked rename would resurrect the PAT the
   *  UI just reported cleared. Each caller still sees only its own mutation's failure. */
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly userDataDir: string,
    private readonly fileName: string
  ) {}

  private chained<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn)
    this.chain = run.catch(() => {})
    return run
  }

  private get filePath(): string {
    return path.join(this.userDataDir, this.fileName)
  }

  save(token: string): Promise<void> {
    return this.chained(() =>
      withCrossProcessLock(this.filePath, (lease) => this.saveNow(token, lease))
    )
  }

  private async saveNow(token: string, lease: CrossProcessLease): Promise<void> {
    if (!validGitHubToken(token)) throw new ServerGitHubSecretError('invalid-token')
    const current = await readAtomicFileSnapshot(this.filePath)
    if (current.exists) {
      let value: unknown
      try {
        value = JSON.parse(current.data.toString('utf8'))
      } catch (cause) {
        throw new GitHubTokenDocumentError('The stored GitHub credential document is corrupt.', {
          cause
        })
      }
      const existing = parseGitHubTokenDocument(value)
      if (existing.kind === 'safe-storage') {
        throw new GitHubTokenDocumentError(
          'The stored GitHub credential requires Desktop keyring access and was preserved.'
        )
      }
  private async saveNow(token: string): Promise<void> {
    if (!validToken(token)) throw new ServerSecretStoreError('invalid-token')
    await fs.mkdir(this.userDataDir, { recursive: true })
    await sweepStaleTmp(this.filePath)
    // The store's per-instance chain orders this write against its sibling mutations; the per-call
    // temp name covers the writers the chain cannot see — a second `nodeterm-server --data-dir X`
    // process on the same dir (every process's counter starts at 0, hence the pid) and a crash
    // between tmp-write and rename. With a shared name one writer's rename publishes the other's
    // half-written PAT, or moves the file out from under it entirely and the loser's rename fails.
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
      // unique name is never written again, so only this cleanup (or a later run's sweep above,
      // once the pid is dead) will ever collect it. The error still propagates.
      await fs.rm(temporary, { force: true }).catch(() => {})
      throw error
    }
    await atomicWrite(
      this.filePath,
      { version: 1, kind: 'restricted-file', token },
      current.revision,
      lease
    )
  }

  clear(): Promise<void> {
    return this.chained(() =>
      withCrossProcessLock(this.filePath, async (lease) => {
        await lease.fence()
        const result = await clearAtomicTarget(this.filePath)
        if (!result.cleared) throw new ServerGitHubSecretError('clear-incomplete')
      })
    )
  }

  async readForHost(): Promise<string | null> {
    const snapshot = await readAtomicFileSnapshot(this.filePath)
    if (!snapshot.exists) return null
    let value: unknown
    try {
      value = JSON.parse(snapshot.data.toString('utf8'))
    } catch (cause) {
      throw new GitHubTokenDocumentError('The stored GitHub credential document is corrupt.', {
        cause
      })
    }
    const document = parseGitHubTokenDocument(value)
    if (document.kind === 'safe-storage') {
      throw new GitHubTokenDocumentError(
        'The stored GitHub credential requires Desktop keyring access.'
      )
    }
    return document.token
  }
}

export class ServerGitHubSecretStore extends ServerSecretStore implements GitHubSecretStore {
  constructor(userDataDir: string) {
    super(userDataDir, FILE_NAME)
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
