import { randomUUID } from 'crypto'
import path from 'path'
import type { GitWorktreeOwnership } from '../shared/types'
import {
  readAtomicFileSnapshot,
  withCrossProcessLock,
  writeAtomicFileCompared
} from './fs-transaction-lock'

export interface WorktreePhysicalBinding {
  repoPath: string
  worktreePath: string
  commonDir: string
  adminDir: string
  repoGeneration: string
  worktreeGeneration: string
  commonDirGeneration: string
  adminDirGeneration: string
  branchRef: string
}

interface WorktreeOwnershipRecord extends WorktreePhysicalBinding {
  ownershipId: string
  directoryCreatedByApp: true
  branchCreatedByApp: boolean
  createdAt: string
}

interface WorktreeOwnershipDocument {
  version: 1
  records: WorktreeOwnershipRecord[]
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function parseDocument(data: Buffer): WorktreeOwnershipDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(data.toString('utf8'))
  } catch (cause) {
    throw new Error('The worktree ownership record is corrupt.', { cause })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The worktree ownership record has the wrong shape.')
  }
  const candidate = parsed as { version?: unknown; records?: unknown }
  if (candidate.version !== 1 || !Array.isArray(candidate.records)) {
    throw new Error('The worktree ownership record has an unsupported version.')
  }
  const ids = new Set<string>()
  const records = candidate.records.map((raw): WorktreeOwnershipRecord => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('The worktree ownership record contains an invalid entry.')
    }
    const record = raw as Partial<WorktreeOwnershipRecord>
    const strings: (keyof WorktreePhysicalBinding)[] = [
      'repoPath',
      'worktreePath',
      'commonDir',
      'adminDir',
      'repoGeneration',
      'worktreeGeneration',
      'commonDirGeneration',
      'adminDirGeneration',
      'branchRef'
    ]
    if (
      !isString(record.ownershipId) ||
      !UUID_V4.test(record.ownershipId) ||
      ids.has(record.ownershipId) ||
      record.directoryCreatedByApp !== true ||
      typeof record.branchCreatedByApp !== 'boolean' ||
      !isString(record.createdAt) ||
      !strings.every((key) => isString(record[key]))
    ) {
      throw new Error('The worktree ownership record contains an invalid entry.')
    }
    ids.add(record.ownershipId)
    return record as WorktreeOwnershipRecord
  })
  return { version: 1, records }
}

function sameDirectoryGeneration(
  record: WorktreeOwnershipRecord,
  binding: WorktreePhysicalBinding
): boolean {
  return (
    record.repoPath === binding.repoPath &&
    record.worktreePath === binding.worktreePath &&
    record.commonDir === binding.commonDir &&
    record.adminDir === binding.adminDir &&
    record.repoGeneration === binding.repoGeneration &&
    record.worktreeGeneration === binding.worktreeGeneration &&
    record.commonDirGeneration === binding.commonDirGeneration &&
    record.adminDirGeneration === binding.adminDirGeneration
  )
}

export class WorktreeOwnershipStore {
  constructor(private readonly filePath: () => string) {}

  file(): string {
    return path.resolve(this.filePath())
  }

  private async load(): Promise<{
    document: WorktreeOwnershipDocument
    revision: string
  }> {
    const snapshot = await readAtomicFileSnapshot(this.file())
    if (!snapshot.exists) {
      return { document: { version: 1, records: [] }, revision: snapshot.revision }
    }
    return { document: parseDocument(snapshot.data), revision: snapshot.revision }
  }

  async ownershipFor(binding: WorktreePhysicalBinding): Promise<GitWorktreeOwnership> {
    const { document } = await this.load()
    const record = document.records.find((candidate) =>
      sameDirectoryGeneration(candidate, binding)
    )
    return {
      ownershipId: record?.ownershipId,
      directoryCreatedByApp: !!record,
      branchCreatedByApp: !!record?.branchCreatedByApp && record.branchRef === binding.branchRef
    }
  }

  async recordCreated(
    binding: WorktreePhysicalBinding,
    branchCreatedByApp: boolean
  ): Promise<GitWorktreeOwnership> {
    const file = this.file()
    return withCrossProcessLock(file, async (lease) => {
      const { document, revision } = await this.load()
      const ownershipId = randomUUID()
      const record: WorktreeOwnershipRecord = {
        ...binding,
        ownershipId,
        directoryCreatedByApp: true,
        branchCreatedByApp,
        createdAt: new Date().toISOString()
      }
      // A physical directory generation can have only one origin record. Retain unrelated records
      // so another live worktree cannot lose ownership merely because this one was created.
      document.records = document.records.filter(
        (candidate) => !sameDirectoryGeneration(candidate, binding)
      )
      document.records.push(record)
      await writeAtomicFileCompared(
        file,
        JSON.stringify(document, null, 2),
        revision,
        lease,
        { mode: 0o600 }
      )
      return {
        ownershipId,
        directoryCreatedByApp: true,
        branchCreatedByApp
      }
    })
  }

  async forget(ownershipId: string | undefined): Promise<void> {
    if (!ownershipId) return
    const file = this.file()
    await withCrossProcessLock(file, async (lease) => {
      const { document, revision } = await this.load()
      const next = document.records.filter((record) => record.ownershipId !== ownershipId)
      if (next.length === document.records.length) return
      document.records = next
      await writeAtomicFileCompared(
        file,
        JSON.stringify(document, null, 2),
        revision,
        lease,
        { mode: 0o600 }
      )
    })
  }
}
