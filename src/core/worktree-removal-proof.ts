import { createHash, randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import type {
  GitWorktreeOwnership,
  GitWorktreeRemovalProof,
  GitWorktreeRemovalProofResult,
  GitWorktreeRemovalSummary
} from '../shared/types'
import { parseWorktreePorcelain } from '../shared/worktree'
import type { GitExecutor } from '../shared/worktree-ops'
import {
  WorktreeOwnershipStore,
  type WorktreePhysicalBinding
} from './worktree-ownership'

const MAX_PROOFS = 64
const PROOF_TTL_MS = 10 * 60_000

function codeOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : ''
}

export async function strictPathPresent(
  target: string,
  lstat: (path: string) => Promise<unknown> = fs.lstat
): Promise<boolean> {
  try {
    await lstat(target)
    return true
  } catch (error) {
    const code = codeOf(error)
    // ENOTDIR means a path component was replaced by a non-directory after the binding was
    // selected. That is changed/unreadable evidence, never proof that the target is absent.
    if (code === 'ENOENT') return false
    throw error
  }
}

export class WorktreeRemovalProofError extends Error {
  readonly code = 'worktree-removal-proof-unavailable' as const

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options)
  }
}

function unavailable(message: string, cause?: unknown): WorktreeRemovalProofError {
  return new WorktreeRemovalProofError(message, cause === undefined ? undefined : { cause })
}

function comparablePath(value: string): string {
  const normalized = path.resolve(value).normalize('NFC')
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

function samePath(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right)
}

function statGeneration(stat: import('fs').BigIntStats): string {
  return [stat.dev, stat.ino, stat.birthtimeNs, stat.mode].map(String).join(':')
}

async function canonicalDirectory(target: string, label: string): Promise<{
  path: string
  generation: string
}> {
  const resolved = path.resolve(target)
  let binding: import('fs').BigIntStats
  try {
    binding = await fs.lstat(resolved, { bigint: true })
  } catch (cause) {
    throw unavailable(`${label} could not be inspected.`, cause)
  }
  if (binding.isSymbolicLink() || !binding.isDirectory()) {
    throw unavailable(`${label} is not a directly bound directory.`)
  }
  let physical: string
  try {
    physical = await fs.realpath(resolved)
  } catch (cause) {
    throw unavailable(`${label} could not be resolved.`, cause)
  }
  if (!samePath(physical, resolved)) {
    throw unavailable(`${label} resolves through an unsupported filesystem alias.`)
  }
  const physicalStat = await fs.lstat(physical, { bigint: true })
  if (physicalStat.isSymbolicLink() || !physicalStat.isDirectory()) {
    throw unavailable(`${label} has an unsupported filesystem binding.`)
  }
  return { path: physical, generation: statGeneration(physicalStat) }
}

async function requiredGit(
  git: GitExecutor,
  cwd: string,
  args: string[],
  label: string
): Promise<string> {
  const result = await git(cwd, args)
  if (!result.ok) throw unavailable(`${label} could not be read.`)
  return result.out
}

function gitPath(cwd: string, value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw unavailable('Git returned an empty administrative path.')
  return path.resolve(cwd, trimmed)
}

function splitNul(value: string): string[] {
  return value.split('\0').filter(Boolean).sort()
}

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function addSafeBytes(summary: GitWorktreeRemovalSummary, size: bigint): void {
  if (size < 0n || size > BigInt(Number.MAX_SAFE_INTEGER - summary.bytes)) {
    throw unavailable('The worktree inventory is too large to disclose exactly.')
  }
  summary.bytes += Number(size)
}

function stableStat(stat: import('fs').BigIntStats): string {
  return [
    stat.dev,
    stat.ino,
    stat.mode,
    stat.nlink,
    stat.size,
    stat.mtimeNs,
    stat.ctimeNs,
    stat.birthtimeNs
  ].map(String).join(':')
}

/**
 * Stable identity carried into the disclosed inventory fingerprint. Volatile timestamps are
 * deliberately excluded here: `stableStat` already fences an entry while it is read, while the
 * content digest below must remain the fact that distinguishes same-size byte replacements. This
 * also keeps the byte-coverage Chut discriminating instead of letting a ctime change hide a missing
 * content hash.
 */
function inventoryStat(stat: import('fs').BigIntStats): string {
  return [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.birthtimeNs]
    .map(String)
    .join(':')
}

async function hashRegularFile(
  absolute: string,
  pathBefore: import('fs').BigIntStats
): Promise<string> {
  const handle = await fs.open(absolute, 'r')
  try {
    const before = await handle.stat({ bigint: true })
    if (
      !before.isFile() ||
      before.dev !== pathBefore.dev ||
      before.ino !== pathBefore.ino
    ) {
      throw unavailable('A worktree file changed identity while it was being measured.')
    }
    const hash = createHash('sha256')
    const stream = handle.createReadStream({ autoClose: false })
    for await (const chunk of stream) hash.update(chunk as Buffer)
    const after = await handle.stat({ bigint: true })
    const pathAfter = await fs.lstat(absolute, { bigint: true })
    if (
      stableStat(before) !== stableStat(after) ||
      after.dev !== pathAfter.dev ||
      after.ino !== pathAfter.ino ||
      stableStat(after) !== stableStat(pathAfter)
    ) {
      throw unavailable('A worktree file changed while it was being measured.')
    }
    return hash.digest('hex')
  } finally {
    await handle.close().catch(() => undefined)
  }
}

interface InventorySets {
  tracked: Set<string>
  untracked: Set<string>
  ignored: Set<string>
}

interface InventoryResult {
  fingerprint: string
  summary: GitWorktreeRemovalSummary
}

function fileClass(relative: string, sets: InventorySets): keyof Pick<
  GitWorktreeRemovalSummary,
  'trackedFiles' | 'untrackedFiles' | 'ignoredFiles' | 'otherFiles'
> {
  if (sets.tracked.has(relative)) return 'trackedFiles'
  if (sets.untracked.has(relative)) return 'untrackedFiles'
  if (sets.ignored.has(relative)) return 'ignoredFiles'
  return 'otherFiles'
}

async function inventoryTree(root: string, sets: InventorySets): Promise<InventoryResult> {
  const summary: GitWorktreeRemovalSummary = {
    trackedFiles: 0,
    untrackedFiles: 0,
    ignoredFiles: 0,
    otherFiles: 0,
    symlinks: 0,
    directories: 0,
    bytes: 0
  }
  const manifest: string[] = []

  const walk = async (absoluteDir: string, relativeDir: string): Promise<void> => {
    const dirBefore = await fs.lstat(absoluteDir, { bigint: true })
    if (!dirBefore.isDirectory() || dirBefore.isSymbolicLink()) {
      throw unavailable('The worktree directory changed while it was being measured.')
    }
    const opened = await fs.opendir(absoluteDir)
    const names: string[] = []
    try {
      for await (const entry of opened) names.push(entry.name)
    } finally {
      await opened.close().catch(() => undefined)
    }
    names.sort()
    const dirAfter = await fs.lstat(absoluteDir, { bigint: true })
    if (stableStat(dirBefore) !== stableStat(dirAfter)) {
      throw unavailable('The worktree directory changed while it was being measured.')
    }
    manifest.push(`d\0${relativeDir}\0${inventoryStat(dirAfter)}`)
    if (relativeDir) summary.directories += 1

    for (const name of names) {
      const absolute = path.join(absoluteDir, name)
      const relative = relativeDir ? `${relativeDir}/${name}` : name
      const before = await fs.lstat(absolute, { bigint: true })
      if (before.isDirectory() && !before.isSymbolicLink()) {
        await walk(absolute, relative)
        continue
      }
      if (before.isSymbolicLink()) {
        const target = await fs.readlink(absolute)
        const after = await fs.lstat(absolute, { bigint: true })
        if (stableStat(before) !== stableStat(after)) {
          throw unavailable('A worktree symlink changed while it was being measured.')
        }
        summary.symlinks += 1
        manifest.push(`l\0${relative}\0${inventoryStat(after)}\0${digest(target)}`)
        continue
      }
      if (!before.isFile()) {
        throw unavailable(`The worktree contains an unsupported filesystem entry: ${relative}`)
      }
      const content = await hashRegularFile(absolute, before)
      summary[fileClass(relative, sets)] += 1
      addSafeBytes(summary, before.size)
      manifest.push(`f\0${relative}\0${inventoryStat(before)}\0${content}`)
    }
  }

  await walk(root, '')
  return { fingerprint: digest(manifest.join('\0')), summary }
}

export interface MeasuredWorktreeRemoval {
  binding: WorktreePhysicalBinding
  branchTip: string
  indexFingerprint: string
  inventoryFingerprint: string
  inventorySetFingerprint: string
  summary: GitWorktreeRemovalSummary
  ownership: GitWorktreeOwnership
  fingerprint: string
}

async function physicalBinding(
  git: GitExecutor,
  repoPath: string,
  worktreePath: string
): Promise<WorktreePhysicalBinding & { branchTip: string }> {
  const repo = await canonicalDirectory(repoPath, 'The repository path')
  const worktree = await canonicalDirectory(worktreePath, 'The worktree path')
  if (samePath(repo.path, worktree.path)) {
    throw unavailable('The main repository checkout cannot be removed as a linked worktree.')
  }

  const [repoTopRaw, worktreeTopRaw, repoCommonRaw, worktreeCommonRaw, adminRaw, branchRefRaw, tipRaw] =
    await Promise.all([
      requiredGit(git, repo.path, ['rev-parse', '--show-toplevel'], 'The repository root'),
      requiredGit(git, worktree.path, ['rev-parse', '--show-toplevel'], 'The worktree root'),
      requiredGit(git, repo.path, ['rev-parse', '--git-common-dir'], 'The repository common directory'),
      requiredGit(git, worktree.path, ['rev-parse', '--git-common-dir'], 'The worktree common directory'),
      requiredGit(git, worktree.path, ['rev-parse', '--absolute-git-dir'], 'The worktree administrative directory'),
      requiredGit(git, worktree.path, ['symbolic-ref', '-q', 'HEAD'], 'The worktree branch'),
      requiredGit(git, worktree.path, ['rev-parse', '--verify', 'HEAD'], 'The worktree branch tip')
    ])

  const repoTop = await canonicalDirectory(gitPath(repo.path, repoTopRaw), 'The Git repository root')
  const worktreeTop = await canonicalDirectory(gitPath(worktree.path, worktreeTopRaw), 'The Git worktree root')
  if (!samePath(repo.path, repoTop.path) || !samePath(worktree.path, worktreeTop.path)) {
    throw unavailable('Git resolved a different repository or worktree path.')
  }
  const repoCommon = await canonicalDirectory(gitPath(repo.path, repoCommonRaw), 'The repository common directory')
  const worktreeCommon = await canonicalDirectory(gitPath(worktree.path, worktreeCommonRaw), 'The worktree common directory')
  if (!samePath(repoCommon.path, worktreeCommon.path)) {
    throw unavailable('The worktree does not belong to the disclosed repository.')
  }
  const admin = await canonicalDirectory(gitPath(worktree.path, adminRaw), 'The worktree administrative directory')
  const branchRef = branchRefRaw.trim()
  const branchTip = tipRaw.trim()
  if (!branchRef.startsWith('refs/heads/') || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(branchTip)) {
    throw unavailable('The worktree branch identity is unavailable.')
  }

  const listedRaw = await requiredGit(
    git,
    repo.path,
    ['worktree', 'list', '--porcelain'],
    'The worktree registration'
  )
  const matches: ReturnType<typeof parseWorktreePorcelain> = []
  for (const entry of parseWorktreePorcelain(listedRaw)) {
    let present: boolean
    try {
      present = await strictPathPresent(entry.path)
    } catch (cause) {
      throw unavailable('A registered worktree path could not be inspected.', cause)
    }
    if (!present) continue
    const candidate = await canonicalDirectory(entry.path, 'A registered worktree path')
    if (samePath(candidate.path, worktree.path)) matches.push(entry)
  }
  if (matches.length !== 1) throw unavailable('The exact worktree registration is unavailable.')
  const registration = matches[0]!
  if (registration.branchRef !== branchRef || registration.head !== branchTip) {
    throw unavailable('The worktree registration changed while it was being measured.')
  }

  return {
    repoPath: repo.path,
    worktreePath: worktree.path,
    commonDir: repoCommon.path,
    adminDir: admin.path,
    repoGeneration: repo.generation,
    worktreeGeneration: worktree.generation,
    commonDirGeneration: repoCommon.generation,
    adminDirGeneration: admin.generation,
    branchRef,
    branchTip
  }
}

export async function measureWorktreePhysicalBinding(
  git: GitExecutor,
  repoPath: string,
  worktreePath: string
): Promise<WorktreePhysicalBinding & { branchTip: string }> {
  return physicalBinding(git, repoPath, worktreePath)
}

async function measureOnce(
  git: GitExecutor,
  ownershipStore: WorktreeOwnershipStore,
  repoPath: string,
  worktreePath: string
): Promise<MeasuredWorktreeRemoval> {
  const physical = await physicalBinding(git, repoPath, worktreePath)
  const binding: WorktreePhysicalBinding = physical
  const [indexRaw, trackedRaw, untrackedRaw, ignoredRaw, ownership] = await Promise.all([
    requiredGit(git, physical.worktreePath, ['ls-files', '--stage', '-z'], 'The worktree index'),
    requiredGit(git, physical.worktreePath, ['ls-files', '-z'], 'The tracked-file inventory'),
    requiredGit(
      git,
      physical.worktreePath,
      ['ls-files', '--others', '--exclude-standard', '-z'],
      'The untracked-file inventory'
    ),
    requiredGit(
      git,
      physical.worktreePath,
      ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'],
      'The ignored-file inventory'
    ),
    ownershipStore.ownershipFor(binding)
  ])
  const tracked = splitNul(trackedRaw)
  const untracked = splitNul(untrackedRaw)
  const ignored = splitNul(ignoredRaw)
  const inventorySets = { tracked: new Set(tracked), untracked: new Set(untracked), ignored: new Set(ignored) }
  const inventory = await inventoryTree(physical.worktreePath, inventorySets)
  const inventorySetFingerprint = digest(JSON.stringify({ tracked, untracked, ignored }))
  const stable = {
    binding,
    branchTip: physical.branchTip,
    indexFingerprint: digest(indexRaw),
    inventoryFingerprint: inventory.fingerprint,
    inventorySetFingerprint,
    summary: inventory.summary,
    ownership
  }
  return { ...stable, fingerprint: digest(JSON.stringify(stable)) }
}

export async function measureStableWorktreeRemoval(
  git: GitExecutor,
  ownershipStore: WorktreeOwnershipStore,
  repoPath: string,
  worktreePath: string
): Promise<MeasuredWorktreeRemoval> {
  const first = await measureOnce(git, ownershipStore, repoPath, worktreePath)
  const second = await measureOnce(git, ownershipStore, repoPath, worktreePath)
  if (first.fingerprint !== second.fingerprint) {
    throw unavailable('The worktree changed while its removal proof was being measured.')
  }
  return second
}

function publicProof(token: string, measured: MeasuredWorktreeRemoval): GitWorktreeRemovalProof {
  return {
    version: 1,
    token,
    fingerprint: measured.fingerprint,
    repoPath: measured.binding.repoPath,
    worktreePath: measured.binding.worktreePath,
    commonDir: measured.binding.commonDir,
    adminDir: measured.binding.adminDir,
    branchRef: measured.binding.branchRef,
    branchTip: measured.branchTip,
    summary: { ...measured.summary },
    ownership: { ...measured.ownership }
  }
}

interface StoredProof {
  proof: GitWorktreeRemovalProof
  measured: MeasuredWorktreeRemoval
  expiresAt: number
}

export class WorktreeRemovalProofRegistry {
  private readonly proofs = new Map<string, StoredProof>()

  private purge(now = Date.now()): void {
    for (const [token, stored] of this.proofs) {
      if (stored.expiresAt <= now) this.proofs.delete(token)
    }
    while (this.proofs.size >= MAX_PROOFS) {
      const oldest = this.proofs.keys().next().value as string | undefined
      if (!oldest) break
      this.proofs.delete(oldest)
    }
  }

  async prepare(
    git: GitExecutor,
    ownershipStore: WorktreeOwnershipStore,
    repoPath: string,
    worktreePath: string
  ): Promise<GitWorktreeRemovalProofResult> {
    try {
      const measured = await measureStableWorktreeRemoval(
        git,
        ownershipStore,
        repoPath,
        worktreePath
      )
      this.purge()
      const token = randomUUID()
      const proof = publicProof(token, measured)
      this.proofs.set(token, {
        proof,
        measured,
        expiresAt: Date.now() + PROOF_TTL_MS
      })
      return { ok: true, message: '', proof }
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : 'The worktree could not be measured safely. Nothing was removed.'
      }
    }
  }

  consume(proof: GitWorktreeRemovalProof): MeasuredWorktreeRemoval {
    this.purge()
    const stored = this.proofs.get(proof.token)
    if (stored) this.proofs.delete(proof.token)
    if (
      !stored ||
      proof.version !== 1 ||
      JSON.stringify(stored.proof) !== JSON.stringify(proof)
    ) {
      throw unavailable('The worktree removal proof is missing, changed, expired, or already used.')
    }
    return stored.measured
  }
}
