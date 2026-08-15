import { promises as fs } from 'node:fs'
import path from 'node:path'
import { clearAtomicTarget, renameAtomic, sweepStaleTempFiles, tempNameFor } from '../core/fs-atomic'
import type { GitHubSecretStore } from '../core/github/credentials'
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

type TokenDocument =
  | { version: 1; kind: 'safe-storage'; value: string }
  | { version: 1; kind: 'restricted-file'; token: string }

export class GitHubSecretError extends Error {
  constructor(readonly code: 'invalid-token' | 'keyring-locked' | 'clear-incomplete') {
    super(code)
  }
}

function validToken(token: string): boolean {
  return token.trim() === token && token.length > 0 && token.length <= 4096 && !/[\r\n\0]/.test(token)
}

async function atomicWrite(file: string, document: TokenDocument): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await sweepStaleTempFiles(file)
  // The store's per-instance chain orders this write against its sibling mutations; the per-call
  // temp name covers the writers the chain cannot see — a second app process on the same
  // userDataDir, even across a PID namespace, and a crash between tmp-write and rename. With a
  // shared name one writer's rename publishes the other's
  // half-written PAT, or moves the file out from under it entirely and the loser's rename fails.
  // The rename itself now retries a transient Windows sharing-violation error — see src/core/fs-atomic.ts.
  const temporary = tempNameFor(file)
  try {
    await fs.writeFile(temporary, JSON.stringify(document), { encoding: 'utf-8', mode: 0o600 })
    await fs.chmod(temporary, 0o600)
    await renameAtomic(temporary, file)
  } catch (error) {
    // A failed write MUST remove its own temp, because here a leaked temp IS a leaked PAT: a
    // unique name is never written again, so only this cleanup (or a later sweep after the age
    // grace and an owner pid no longer visible here mark it abandoned) will collect it. The error propagates.
    await fs.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
  await fs.chmod(file, 0o600)
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
    return this.chained(() => this.saveNow(token))
  }

  private async saveNow(token: string): Promise<void> {
    if (!validToken(token)) throw new GitHubSecretError('invalid-token')
    const current = await this.readDocument()
    if (current?.kind === 'safe-storage' && !this.canEncrypt()) {
      throw new GitHubSecretError('keyring-locked')
    }
    const document: TokenDocument = this.canEncrypt()
      ? {
          version: 1,
          kind: 'safe-storage',
          value: this.safeStorage.encryptString(token).toString('base64')
        }
      : { version: 1, kind: 'restricted-file', token }
    await atomicWrite(this.filePath, document)
  }

  clear(): Promise<void> {
    return this.chained(async () => {
      const result = await clearAtomicTarget(this.filePath)
      if (!result.cleared) throw new GitHubSecretError('clear-incomplete')
    })
  }

  async readForHost(): Promise<string | null> {
    const document = await this.readDocument()
    if (!document) return null
    if (document.kind === 'restricted-file') return validToken(document.token) ? document.token : null
    if (!this.canEncrypt()) return null
    try {
      const token = this.safeStorage.decryptString(Buffer.from(document.value, 'base64'))
      return validToken(token) ? token : null
    } catch {
      return null
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

  private async readDocument(): Promise<TokenDocument | null> {
    try {
      const value: unknown = JSON.parse(await fs.readFile(this.filePath, 'utf-8'))
      if (!value || typeof value !== 'object') return null
      const document = value as Partial<TokenDocument>
      if (document.version !== 1) return null
      if (document.kind === 'safe-storage' && typeof document.value === 'string') {
        return document as TokenDocument
      }
      if (document.kind === 'restricted-file' && typeof document.token === 'string') {
        return document as TokenDocument
      }
      return null
    } catch {
      return null
    }
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
