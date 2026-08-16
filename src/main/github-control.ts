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
import type { GitHubSecretAvailability } from '../shared/github-issues'
import { IPC } from '../shared/ipc'
import type { GitHubHostController } from '../core/github/host'

const FILE_NAME = 'github-issues-token.json'

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  getSelectedStorageBackend?(): string
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export class GitHubSecretError extends Error {
  constructor(readonly code: 'invalid-token' | 'keyring-locked' | 'clear-incomplete') {
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
}

export class ElectronGitHubSecretStore implements GitHubSecretStore {
  /** Mutations run FIFO (the WorkspaceStore.saveChain idiom): a clear's rm must never land inside
   *  an in-flight save's write-to-rename window — the parked rename would resurrect the PAT the
   *  UI just reported cleared — and save's read-modify-write of the document kind stays
   *  consistent. Each caller still sees only its own mutation's failure. */
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly userDataDir: string,
    private readonly safeStorage: SafeStorageLike
  ) {}

  private chained<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn)
    this.chain = run.catch(() => {})
    return run
  }

  get availability(): GitHubSecretAvailability {
    return this.canEncrypt() ? 'encrypted' : 'restricted-file'
  }

  private get filePath(): string {
    return path.join(this.userDataDir, FILE_NAME)
  }

  save(token: string): Promise<void> {
    return this.chained(() =>
      withCrossProcessLock(this.filePath, (lease) => this.saveNow(token, lease))
    )
  }

  private async saveNow(token: string, lease: CrossProcessLease): Promise<void> {
    if (!validGitHubToken(token)) throw new GitHubSecretError('invalid-token')
    const current = await this.readDocumentSnapshot()
    if (current.document?.kind === 'safe-storage' && !this.canEncrypt()) {
      throw new GitHubSecretError('keyring-locked')
    }
    if (current.document?.kind === 'safe-storage') {
      // A syntactically valid envelope can still carry undecryptable keyring bytes. Preserve that
      // evidence instead of accepting a replacement as though the prior credential were absent.
      this.decryptDocument(current.document)
    }
    const document: GitHubTokenDocument = this.canEncrypt()
      ? {
          version: 1,
          kind: 'safe-storage',
          value: this.safeStorage.encryptString(token).toString('base64')
        }
      : { version: 1, kind: 'restricted-file', token }
    await atomicWrite(this.filePath, document, current.revision, lease)
  }

  clear(): Promise<void> {
    return this.chained(() =>
      withCrossProcessLock(this.filePath, async (lease) => {
        await lease.fence()
        const result = await clearAtomicTarget(this.filePath)
        if (!result.cleared) throw new GitHubSecretError('clear-incomplete')
      })
    )
  }

  async readForHost(): Promise<string | null> {
    const document = await this.readDocument()
    if (!document) return null
    if (document.kind === 'restricted-file') return document.token
    if (!this.canEncrypt()) throw new GitHubSecretError('keyring-locked')
    return this.decryptDocument(document)
  }

  private decryptDocument(document: Extract<GitHubTokenDocument, { kind: 'safe-storage' }>): string {
    try {
      const token = this.safeStorage.decryptString(Buffer.from(document.value, 'base64'))
      if (!validGitHubToken(token)) throw new GitHubTokenDocumentError()
      return token
    } catch (error) {
      if (error instanceof GitHubTokenDocumentError) throw error
      throw new GitHubTokenDocumentError('The encrypted GitHub credential could not be decrypted.')
    }
  }

  private canEncrypt(): boolean {
    if (!this.safeStorage.isEncryptionAvailable()) return false
    try {
      return this.safeStorage.getSelectedStorageBackend?.() !== 'basic_text'
    } catch {
      return false
    }
  }

  private async readDocument(): Promise<GitHubTokenDocument | null> {
    return (await this.readDocumentSnapshot()).document
  }

  private async readDocumentSnapshot(): Promise<{
    document: GitHubTokenDocument | null
    revision: string
  }> {
    const snapshot = await readAtomicFileSnapshot(this.filePath)
    if (!snapshot.exists) return { document: null, revision: snapshot.revision }
    let value: unknown
    try {
      value = JSON.parse(snapshot.data.toString('utf8'))
    } catch (cause) {
      throw new GitHubTokenDocumentError('The stored GitHub credential document is corrupt.', { cause })
    }
    return { document: parseGitHubTokenDocument(value), revision: snapshot.revision }
  }
}

export class GitHubControlAccessError extends Error {
  readonly code = 'E_FORBIDDEN'

  constructor() {
    super('GitHub control is available only to the local main window')
  }
}

type IpcMainLike = {
  handle(channel: string, handler: (event: { sender: { id: number } }, ...args: any[]) => unknown): void
}

type Controller = Pick<GitHubHostController,
  'status' | 'approve' | 'revoke' | 'selectProvider' | 'saveToken' | 'clearToken'>

export function registerElectronGitHubControl(
  ipc: IpcMainLike,
  mainWindowId: () => number | undefined,
  controller: Controller
): void {
  const local = <T extends unknown[]>(action: (...args: T) => unknown) =>
    (event: { sender: { id: number } }, ...args: T): unknown => {
      if (mainWindowId() !== event.sender.id) throw new GitHubControlAccessError()
      return action(...args)
    }
  ipc.handle(IPC.githubControlStatus, local((projectId?: string) => controller.status(projectId)))
  ipc.handle(IPC.githubControlApprove, local((input) => controller.approve(input)))
  ipc.handle(IPC.githubControlRevoke, local((input) => controller.revoke(input)))
  ipc.handle(IPC.githubControlSelectProvider, local((input) => controller.selectProvider(input)))
  ipc.handle(IPC.githubControlSaveToken, local((token: string) => controller.saveToken(token)))
  ipc.handle(IPC.githubControlClearToken, local(() => controller.clearToken()))
}
