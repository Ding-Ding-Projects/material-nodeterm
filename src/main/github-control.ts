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
import type { SecretStore } from '../core/secret-store'
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

type TokenDocument =
  | { version: 1; kind: 'safe-storage'; value: string }
  | { version: 1; kind: 'restricted-file'; token: string }

/*
export class SecretStoreError extends Error {
  constructor(readonly code: 'invalid-token' | 'keyring-locked') {
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
} */
/**
 * Remove temp files no writer in THIS process owns: the legacy fixed `<file>.tmp` (written by
 * builds before per-call names) and any `<file>.<pid>.<seq>[.<uuid>].tmp` whose pid is not ours.
 * Best effort — a failure here must never break a save.
 *
 * The token file is not config: an orphan here is a live PAT at 0600 that nothing will ever
 * overwrite, because a unique name is never written twice. So it has to be collected rather than
 * left. Temps bearing our own pid are untouchable: one may belong to a concurrent write sitting
 * between its `writeFile` and its `rename`, and deleting it would recreate the exact race the
 * unique names fixed. A foreign pid can in theory be a second LIVE process on the same dir; that
 * setup has no lock to begin with, and the worst case is that process's rename failing cleanly
 * (ENOENT, rethrown to its caller) instead of a forgotten PAT sitting on disk forever.
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

async function atomicWrite(file: string, document: TokenDocument): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await sweepStaleTmp(file)
  // The store's per-instance chain orders this write against its sibling mutations; the per-call
  // temp name covers the writers the chain cannot see — a second app process on the same
  // userDataDir (every process's counter starts at 0, hence the pid) and a crash between
  // tmp-write and rename. With a shared name one writer's rename publishes the other's
  // half-written PAT, or moves the file out from under it entirely and the loser's rename fails.
  const temporary = tempNameFor(file)
  try {
    await fs.writeFile(temporary, JSON.stringify(document), { encoding: 'utf-8', mode: 0o600 })
    await fs.chmod(temporary, 0o600)
    await renameAtomic(temporary, file)
  } catch (error) {
    // A failed write MUST remove its own temp, because here a leaked temp IS a leaked PAT: a
    // unique name is never written again, so only this cleanup (or a later run's sweep above, once
    // the pid is dead) will ever collect it. The error still propagates.
    await fs.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
  await fs.chmod(file, 0o600)
}

/** Generic Electron secret store: safeStorage ciphertext when a real OS keyring is available,
 *  otherwise an owner-only file. GitHub and the model gateway use distinct file names but share
 *  the exact same validation, atomic-write, locked-keyring, and stale-temp behavior. */
export class ElectronSecretStore implements SecretStore {
  /** Mutations run FIFO (the WorkspaceStore.saveChain idiom): a clear's rm must never land inside
   *  an in-flight save's write-to-rename window — the parked rename would resurrect the PAT the
   *  UI just reported cleared — and save's read-modify-write of the document kind stays
   *  consistent. Each caller still sees only its own mutation's failure. */
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly userDataDir: string,
    private readonly safeStorage: SafeStorageLike,
    private readonly fileName: string
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
    return path.join(this.userDataDir, this.fileName)
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
    await atomicWrite(this.filePath, document)
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

export class ElectronGitHubSecretStore extends ElectronSecretStore implements GitHubSecretStore {
  constructor(userDataDir: string, safeStorage: SafeStorageLike) {
    super(userDataDir, safeStorage, FILE_NAME)
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
