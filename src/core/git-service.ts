import { execFile, spawn } from 'child_process'
import { createHash, randomUUID } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { IPC } from '../shared/ipc'
import type {
  GitFileChange,
  GitResult,
  GitStatus,
  GitWorktreeRemovalMeasurement,
  GitWorktreeRemovalProofResult,
  GitWorktreeRemovalRequest
} from '../shared/types'
import { loadGitHistoryFromExecutor } from '../shared/git-history'
import * as worktreeOps from '../shared/worktree-ops'
import type { WorktreeListResult } from '../shared/worktree'
import { branchParentConfigKey, isValidGitRef } from '../shared/worktree'
import {
  DEPENDENCY_MAX_OUTPUT_BYTES,
  dependencyOperationAvailability,
  planDependencyOperation,
  type DependencyOperationPhase,
  type DependencyOperationProgress,
  type DependencyOperationRequest,
  type DependencyOperationResult
} from '../shared/dependency-operations'
import type { GitHistoryOptions, GitHistoryResult } from '../shared/git-history'
import { resolveGitRemote, runRemoteGit } from './remote-ssh/remote-git'
import { platform } from './platform'
import { gitRemovalFingerprint } from './git-removal-proof'
import { withCrossProcessLock } from './fs-transaction-lock'
import { WorktreeOwnershipStore } from './worktree-ownership'
import {
  measureStableWorktreeRemoval,
  measureWorktreePhysicalBinding,
  strictPathPresent,
  WorktreeRemovalProofRegistry
} from './worktree-removal-proof'
import {
  isValidCloneUrl,
  expandCloneUrl,
  deriveRepoDirName,
  parseCloneProgress,
  stripAnsiCodes
} from '../shared/clone-url'
import { discoverNestedRepositories } from './git-repository-discovery'

const run = promisify(execFile)

async function filesystemGeneration(target: string): Promise<string | null> {
  try {
    const real = await fs.promises.realpath(target)
    const stat = await fs.promises.lstat(real)
    return [real, stat.dev, stat.ino, stat.birthtimeMs, stat.mode].join('|')
  } catch {
    return null
  }
}

async function hashUntrackedFiles(cwd: string, nulPaths: string): Promise<string | null> {
  const root = path.resolve(cwd)
  const hash = (await import('crypto')).createHash('sha256')
  try {
    for (const relative of nulPaths.split('\0').filter(Boolean).sort()) {
      const absolute = path.resolve(root, relative)
      const rel = path.relative(root, absolute)
      if (!rel || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null
      const before = await fs.promises.lstat(absolute)
      hash.update(relative)
      hash.update('\0')
      hash.update([before.mode, before.size, before.birthtimeMs].join('|'))
      if (before.isSymbolicLink()) {
        hash.update(await fs.promises.readlink(absolute))
      } else if (before.isFile()) {
        await new Promise<void>((resolve, reject) => {
          const stream = fs.createReadStream(absolute)
          stream.on('data', (chunk) => hash.update(chunk))
          stream.on('error', reject)
          stream.on('end', resolve)
        })
      } else {
        return null
      }
      const after = await fs.promises.lstat(absolute)
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs
      ) return null
    }
    return hash.digest('hex')
  } catch {
    return null
  }
}

function findBin(names: string[]): string | null {
  for (const c of names) {
    try {
      if (fs.existsSync(c)) return c
    } catch {
      // ignore
    }
  }
  return null
}

const GH_PATH = findBin(['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh'])

// GUI apps on macOS don't inherit the shell PATH, so a git credential helper installed by
// Homebrew (e.g. `gh auth git-credential`, or osxkeychain shims) wouldn't be found by our
// `git` subprocess — making push/pull fail even when the user is authed. Prepend the common
// bin dirs. GIT_TERMINAL_PROMPT=0 makes auth failures error out fast instead of hanging on a
// username prompt (there's no TTY here).
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin${process.env.PATH ? `:${process.env.PATH}` : ''}`,
  GIT_TERMINAL_PROMPT: '0'
}

// Single-flight registry for the one clone the app runs at a time. Module-scoped so a
// macOS window re-creation can't orphan it.
type ActiveClone = {
  child: import('child_process').ChildProcess | null
  clonePath: string
  aborted: boolean
}
let activeClone: ActiveClone | null = null

// `gh auth status` is a network-touching CLI call (it validates the token against the GitHub
// API — measured ~700ms even on a fast link) but auth state changes rarely, so cache it.
const GH_AUTH_TTL_MS = 10 * 60_000
let ghAuthedCache: { value: boolean; at: number } | null = null
let ghAuthedInFlight: Promise<boolean> | null = null

async function ghAuthed(): Promise<boolean> {
  if (!GH_PATH) return false
  const now = Date.now()
  if (ghAuthedCache && now - ghAuthedCache.at < GH_AUTH_TTL_MS) return ghAuthedCache.value
  if (ghAuthedInFlight) return ghAuthedInFlight
  ghAuthedInFlight = (async () => {
    let value = false
    try {
      await run(GH_PATH, ['auth', 'status'], { env: GIT_ENV, maxBuffer: 1024 * 1024 })
      value = true
    } catch {
      value = false
    }
    ghAuthedCache = { value, at: Date.now() }
    ghAuthedInFlight = null
    return value
  })()
  return ghAuthedInFlight
}

/**
 * Stale-while-revalidate view of `ghAuthed` for the status() hot path: `status()` must never
 * block the file list on a GitHub API round-trip. Returns the cached answer immediately (even
 * expired — auth state changes rarely, a stale answer beats a blank panel) and refreshes the
 * cache in the background so the panel's next refresh sees the real value. Only the very first
 * call ever (no cache at all) reports `false` while the probe runs; that flips one refresh later.
 */
function ghAuthedSwr(): boolean {
  if (!GH_PATH) return false
  const fresh = !!ghAuthedCache && Date.now() - ghAuthedCache.at < GH_AUTH_TTL_MS
  if (!fresh) void ghAuthed().catch(() => {})
  return ghAuthedCache?.value ?? false
}

interface Exec {
  ok: boolean
  out: string
  err: string
}

async function git(cwd: string, args: string[], maxOutputBytes = 20 * 1024 * 1024, signal?: AbortSignal): Promise<Exec> {
  // SSH projects route every pure-git op over the project's ControlMaster. runRemoteGit returns
  // the same { ok, out, err } shape, so the rest of GitService is transport-agnostic. Local path
  // (and gh ops) are untouched when no remote owns this cwd.
  const ref = resolveGitRemote(cwd)
  if (ref) {
    const r = await runRemoteGit(ref, cwd, args, maxOutputBytes)
    return { ok: r.ok, out: r.out, err: r.err }
  }
  try {
    const { stdout } = await run('git', args, { cwd, env: GIT_ENV, maxBuffer: maxOutputBytes, signal })
    return { ok: true, out: stdout.replace(/\n$/, ''), err: '' }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, out: (err.stdout ?? '').trim(), err: (err.stderr || err.message || '').trim() }
  }
}

/**
 * Is this repo answered by a REMOTE git (the `git` executor above routes over the project's
 * ControlMaster when `resolveGitRemote` claims the cwd)?
 *
 * It matters because the worktree ops are handed a `pathExists` — and the only `pathExists` this
 * process has is `fs.existsSync`, which can answer about THIS MACHINE and nothing else. Pairing a
 * remote git with a local stat is a loaded gun: every listed worktree's directory would come back
 * missing, so every entry is `prunable: true` ("everything is gone"), and the callers act on that
 * as fact — every bound group struck out as missing, `worktreeRemove` answering `worktreeGone` for
 * a worktree that is alive and well on the host (and the renderer then destroying its terminals'
 * tmux sessions and rewriting their persisted cwds).
 *
 * Worktrees are unsupported in SSH projects in v1 and the renderer gates all of these ops, so this
 * is unreachable today — it is the tripwire for whoever lifts that restriction. Until a remote
 * `pathExists` exists (a `test -e` over the ControlMaster), the ops REFUSE for a remote repo rather
 * than answer about the wrong machine: a refusal is a failed op, which every caller already handles,
 * and — crucially — is never dressed up as `worktreeGone`, so nothing is destroyed on a bad guess.
 */
const isRemoteRepo = (repoPath: string): boolean => !!resolveGitRemote(repoPath)

/**
 * What the worktree ops answer for a repo that lives on an SSH host. See `isRemoteRepo`.
 *
 * A plain failed op — and NEVER `worktreeGone`, which is the one field the renderer reads as proof
 * that a directory is gone (it destroys the descendant terminals' tmux sessions and rewrites their
 * persisted cwds on it). A refusal knows nothing about the host's filesystem, so it must not claim
 * to.
 */
const REMOTE_WORKTREE_REFUSAL = (): worktreeOps.WorktreeOpResult => ({
  ok: false,
  message: 'Worktrees are not supported in SSH projects. Nothing was changed.'
})

const NESTED_REPOSITORY_MAX_DEPTH = 3
const NESTED_REPOSITORY_MAX_DIRECTORIES = 512
const NESTED_REPOSITORY_DEFAULT_PAGE_SIZE = 64
const NESTED_REPOSITORY_MAX_PAGE_SIZE = 128
const NESTED_REPOSITORY_BLOCKLIST = new Set([
  '.git',
  '.nodeterm',
  'node_modules',
  'dist',
  'build',
  'out',
  '.cache',
  '.venv'
])

function sameLocalPath(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const resolved = path.resolve(value)
    const root = path.parse(resolved).root
    return resolved.length > root.length ? resolved.replace(/[\\/]$/, '') : resolved
  }
  const a = normalize(left)
  const b = normalize(right)
  return process.platform === 'win32' ? a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US') : a === b
}

async function safeNestedDirectory(
  root: string,
  parent: string,
  name: string
): Promise<'directory' | 'skip' | 'error'> {
  const candidate = path.join(parent, name)
  const relative = path.relative(root, candidate)
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return 'skip'
  try {
    const stat = await fs.promises.lstat(candidate)
    if (!stat.isDirectory() || stat.isSymbolicLink()) return 'skip'
    // Junctions and other reparse points may not report as symbolic links through every Windows
    // filesystem provider. Inspect first, then compare realpath, so traversal never follows one.
    const real = await fs.promises.realpath(candidate)
    return sameLocalPath(real, candidate) ? 'directory' : 'skip'
  } catch {
    return 'error'
  }
}

function parseRepoName(url: string, fallback: string): string {
  const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/)
  return m ? m[1] : fallback
}

/**
 * Reject branch/ref names that could smuggle CLI flags (leading `-`) or are not
 * valid git refs. Defends against argv flag injection on `git switch …`.
 */
function isValidRef(name: string): boolean {
  const n = name.trim()
  if (!n || n.startsWith('-')) return false
  return !/[\s~^:?*[\\]|\.\.|^\/|\/$|@\{/.test(n)
}

function isBoundedDependencyRef(name: string): boolean {
  const value = name.trim()
  return value.length > 0 && value.length <= 256 && isValidGitRef(value)
}

/** path -> {added, deleted} from `git diff --numstat` output. */
function parseNumstat(out: string): Map<string, { added: number; deleted: number }> {
  const map = new Map<string, { added: number; deleted: number }>()
  for (const line of out.split('\n').filter(Boolean)) {
    const [a, d, ...rest] = line.split('\t')
    const p = rest.join('\t')
    map.set(p, { added: Number(a) || 0, deleted: Number(d) || 0 })
  }
  return map
}

/**
 * Read the user's stored github.com HTTPS token from git's credential helper
 * (macOS keychain etc.) so we can hand it to `gh` as GH_TOKEN — letting someone
 * who can already push over HTTPS publish a new repo without a separate
 * `gh auth login`. Returns null if no HTTPS credential is stored (e.g. SSH-only).
 * Never logs the token. `git credential fill` reads the query from stdin.
 */
function githubTokenFromGitCredentials(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    let out = ''
    const child = spawn('git', ['credential', 'fill'], { cwd: cwd || undefined, env: GIT_ENV })
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.stdout.on('data', (d) => {
      out += d.toString()
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', () => {
      clearTimeout(timer)
      const line = out.split('\n').find((l) => l.startsWith('password='))
      const token = line ? line.slice('password='.length).trim() : ''
      resolve(token || null)
    })
    child.stdin.write('protocol=https\nhost=github.com\n\n')
    child.stdin.end()
  })
}

/**
 * Per-project git operations using the system `git` (and `gh` for publishing).
 * The repo root is the active project's working directory.
 */
export class GitService {
  private readonly worktreeOwnership = new WorktreeOwnershipStore(() =>
    path.join(platform().userDataDir, 'git-worktree-ownership.json')
  )
  private readonly worktreeProofs = new WorktreeRemovalProofRegistry()
  private readonly dependencyOperations = new Map<
    string,
    { controller: AbortController; started: boolean; request: DependencyOperationRequest }
  >()

  /** One physical repository gets one kernel-backed removal transaction in every app process. */
  private worktreeRemovalLock(commonDir: string): string {
    const key = createHash('sha256').update(path.resolve(commonDir)).digest('hex')
    return path.join(platform().userDataDir, 'git-worktree-removal-locks', `${key}.resource`)
  }

  registerIpc(): void {
    platform().handle(IPC.gitStatus, (cwd: string) => this.status(cwd))
    platform().handle(IPC.gitDiscoverRepositories, (cwd: string) => this.discoverRepositories(cwd))
    platform().handle(IPC.gitInit, (cwd: string) => this.init(cwd))
    platform().handle(IPC.gitClone, (parentDir: string, url: string) => this.clone(parentDir, url))
    platform().handle(IPC.gitCloneAbort, () => this.cloneAbort())
    platform().handle(IPC.gitCloneDefaultParent, () => this.cloneDefaultParent())
    platform().handle(IPC.gitCommit, (cwd: string, message: string) => this.commit(cwd, message))
    platform().handle(IPC.gitPush, (cwd: string) => this.push(cwd))
    platform().handle(IPC.gitPull, (cwd: string) => this.pull(cwd))
    platform().handle(IPC.gitSync, (cwd: string) => this.sync(cwd))
    platform().handle(IPC.gitPublish, (cwd: string, name: string, isPrivate: boolean) =>
      this.publish(cwd, name, isPrivate)
    )
    platform().handle(IPC.gitStage, (cwd: string, paths: string[]) => this.stage(cwd, paths))
    platform().handle(IPC.gitUnstage, (cwd: string, paths: string[]) => this.unstage(cwd, paths))
    platform().handle(IPC.gitStageAll, (cwd: string) => this.stageAll(cwd))
    platform().handle(IPC.gitUnstageAll, (cwd: string) => this.unstageAll(cwd))
    platform().handle(IPC.gitDiff, (cwd: string, p: string, staged: boolean, untracked: boolean) =>
      this.diff(cwd, p, staged, untracked)
    )
    platform().handle(IPC.gitDiscard, (cwd: string, p: string, untracked: boolean) =>
      this.discard(cwd, p, untracked)
    )
    platform().handle(IPC.gitSwitchBranch, (cwd: string, name: string) =>
      this.switchBranch(cwd, name)
    )
    platform().handle(IPC.gitCreateBranch, (cwd: string, name: string) =>
      this.createBranch(cwd, name)
    )
    platform().handle(IPC.gitShowFile, (cwd: string, ref: string, p: string) =>
      this.showFile(cwd, ref, p)
    )
    platform().handle(IPC.gitHistory, (cwd: string, options) => this.history(cwd, options))
    platform().handle(IPC.gitCommitFiles, (cwd: string, oid: string) => this.commitFiles(cwd, oid))
    platform().handle(IPC.gitRemoteCommitUrl, (cwd: string, sha: string) =>
      this.remoteCommitUrl(cwd, sha)
    )
    platform().handle(IPC.gitMerge, (cwd: string, ref: string) => this.merge(cwd, ref))
    platform().handle(IPC.gitRebase, (cwd: string, onto: string) => this.rebase(cwd, onto))
    platform().handle(IPC.gitDeleteBranch, (cwd: string, name: string, force: boolean) =>
      this.deleteBranch(cwd, name, force)
    )
    platform().handle(IPC.gitRenameBranch, (cwd: string, newName: string) =>
      this.renameBranch(cwd, newName)
    )
    platform().handle(IPC.gitFetch, (cwd: string) => this.fetch(cwd))
    platform().handle(IPC.gitForcePush, (cwd: string) => this.forcePush(cwd))
    platform().handle(IPC.gitStashPush, (cwd: string) => this.stashPush(cwd))
    platform().handle(IPC.gitStashPop, (cwd: string) => this.stashPop(cwd))
    platform().handle(IPC.gitRevert, (cwd: string, oid: string) => this.revert(cwd, oid))
    platform().handle(IPC.gitBranchAt, (cwd: string, name: string, oid: string) =>
      this.branchAt(cwd, name, oid)
    )
    platform().handle(IPC.gitCheckoutCommit, (cwd: string, oid: string) =>
      this.checkoutCommit(cwd, oid)
    )
    platform().handle(IPC.gitRepoRoot, (cwd: string) => this.repoRoot(cwd))
    platform().handle(IPC.gitDiscoverNestedRepos, (cwd: string) => this.discoverNestedRepos(cwd))
    platform().handle(IPC.gitWorktreeList, (repoPath: string) => this.worktreeList(repoPath))
    platform().handle(IPC.gitWorktreeAdd, (repoPath: string, wtPath: string, branch: string, baseRef: string, isNew: boolean) =>
      this.worktreeAdd(repoPath, wtPath, branch, baseRef, isNew)
    )
    platform().handle(IPC.gitWorktreeMerge, (repoPath: string, branch: string, baseRef: string, push?: boolean) =>
      this.worktreeMerge(repoPath, branch, baseRef, push)
    )
    platform().handle(IPC.gitWorktreeRemovalProof, (repoPath: string, wtPath: string) =>
      this.worktreeRemovalProof(repoPath, wtPath)
    )
    platform().handle(IPC.gitWorktreeRemove, (repoPath: string, wtPath: string, request: GitWorktreeRemovalRequest) =>
      this.worktreeRemove(repoPath, wtPath, request)
    )
    platform().handle(IPC.gitSetBranchParent, (repoPath: string, child: string, parent: string) =>
      this.setBranchParent(repoPath, child, parent)
    )
    platform().handle(IPC.gitUnsetBranchParent, (repoPath: string, child: string) =>
      this.unsetBranchParent(repoPath, child)
    )
    platform().handle(IPC.gitSyncBranch, (cwd: string, child: string) => this.syncBranch(cwd, child))
    platform().handle(IPC.gitProposeBranch, (cwd: string, child: string) => this.proposeBranch(cwd, child))
    platform().handle(IPC.gitShipBranch, (cwd: string, child: string, parent: string) =>
      this.shipBranch(cwd, child, parent)
    )
    platform().handle(
      IPC.gitDependencyOperation,
      (request: DependencyOperationRequest) => this.dependencyOperation(request)
    )
    platform().handle(IPC.gitDependencyCancel, (operationId: string) =>
      this.cancelDependencyOperation(operationId)
    )
  }

  repoRoot(cwd: string) {
    return worktreeOps.repoRoot(git, cwd)
  }

  /**
   * Find child repositories for a project folder that is not itself a checkout (and also expose
   * nested repositories inside a normal checkout). The scan is deliberately shallow and bounded:
   * it follows real directories only, skips generated/dependency trees, verifies every `.git`
   * marker with Git, and never treats a failed read as an empty successful scan.
   */
  async discoverNestedRepos(
    cwd: string,
    options: import('../shared/types').GitNestedRepositoryDiscoveryOptions = {}
  ): Promise<import('../shared/types').GitNestedRepositoryDiscovery> {
    const empty = {
      repositories: [],
      scannedDirectories: 0,
      limited: false,
      nextCursor: null
    }
    if (!cwd) return { ...empty, ok: false, message: 'A project folder is required.' }
    if (isRemoteRepo(cwd)) {
      return {
        ...empty,
        ok: false,
        message: 'Nested repository discovery is unavailable for SSH projects.'
      }
    }
    const root = path.resolve(cwd)
    try {
      const stat = await fs.promises.stat(root)
      if (!stat.isDirectory()) return { ...empty, ok: false, message: 'The project folder is not a directory.' }
    } catch {
      return { ...empty, ok: false, message: 'The project folder could not be read.' }
    }

    const rawLimit = Number(options.limit)
    const limit = Number.isFinite(rawLimit)
      ? Math.min(NESTED_REPOSITORY_MAX_PAGE_SIZE, Math.max(1, Math.floor(rawLimit)))
      : NESTED_REPOSITORY_DEFAULT_PAGE_SIZE
    const rawCursor = options.cursor == null || options.cursor === '' ? '0' : options.cursor
    if (!/^\d+$/.test(rawCursor)) {
      return { ...empty, ok: false, message: 'The nested repository page cursor is invalid.' }
    }
    const offset = Number(rawCursor)
    if (!Number.isSafeInteger(offset)) {
      return { ...empty, ok: false, message: 'The nested repository page cursor is out of range.' }
    }

    const queue: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }]
    const repositories: import('../shared/types').GitNestedRepository[] = []
    let readable = true
    let scannedDirectories = 0
    let limited = false
    while (queue.length > 0 && scannedDirectories < NESTED_REPOSITORY_MAX_DIRECTORIES) {
      const current = queue.shift() as { directory: string; depth: number }
      scannedDirectories += 1
      let entries: import('fs').Dirent[]
      try {
        entries = await fs.promises.readdir(current.directory, { withFileTypes: true })
      } catch {
        readable = false
        continue
      }

      const hasGitMarker = entries.some((entry) => entry.name === '.git')
      if (current.depth > 0 && hasGitMarker) {
        const rootResult = await git(current.directory, ['rev-parse', '--show-toplevel'])
        if (rootResult.ok && sameLocalPath(rootResult.out.trim(), current.directory)) {
          const relativePath = path.relative(root, current.directory).replace(/\\/g, '/')
          if (relativePath && !repositories.some((repo) => sameLocalPath(repo.path, current.directory))) {
            repositories.push({
              path: current.directory,
              relativePath,
              name: path.basename(current.directory)
            })
          }
        } else if (!rootResult.ok) {
          readable = false
        }
      }

      if (current.depth >= NESTED_REPOSITORY_MAX_DEPTH) continue
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || NESTED_REPOSITORY_BLOCKLIST.has(entry.name)) continue
        const safety = await safeNestedDirectory(root, current.directory, entry.name)
        if (safety === 'error') {
          readable = false
          continue
        }
        if (safety === 'skip') continue
        queue.push({ directory: path.join(current.directory, entry.name), depth: current.depth + 1 })
        if (queue.length + scannedDirectories >= NESTED_REPOSITORY_MAX_DIRECTORIES) {
          limited = true
          break
        }
      }
    }

    if (queue.length > 0) limited = true
    repositories.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    if (offset > repositories.length) {
      return {
        repositories: [],
        scannedDirectories,
        limited,
        nextCursor: null,
        ok: false,
        message: 'The nested repository page cursor is out of range.'
      }
    }
    const page = repositories.slice(offset, offset + limit)
    const nextCursor = offset + page.length < repositories.length ? String(offset + page.length) : null
    if (!readable) {
      return {
        ok: false,
        repositories: page,
        scannedDirectories,
        limited,
        nextCursor,
        message: `Nested repository discovery could not read every folder within ${NESTED_REPOSITORY_MAX_DEPTH} levels.`
      }
    }
    return {
      ok: true,
      repositories: page,
      scannedDirectories,
      limited,
      nextCursor,
      message: limited ? `Nested repository discovery stopped at its ${NESTED_REPOSITORY_MAX_DIRECTORIES}-directory safety limit.` : undefined
    }
  }
  worktreeList(repoPath: string): Promise<WorktreeListResult> {
    // A repo on an SSH host cannot be stat'd from here (see `isRemoteRepo`): answer "the read
    // failed", which is exactly what it is — NOT an empty list, which every caller would read as
    // "there are no worktrees".
    if (isRemoteRepo(repoPath)) return Promise.resolve({ ok: false, entries: [] })
    // `pathExists` is git's `prunable` flag's fallback for git < 2.36 (see worktree-ops): without
    // it, an old git reports a deleted worktree directory as healthy and every consumer of
    // `prunable` (staleness, orphan adoption) believes it. It answers about the LOCAL filesystem —
    // hence the remote refusal above, since `git` itself would route over ssh.
    //
    // The `{ ok, entries }` shape rides all the way out to the renderer on purpose: an `entries: []`
    // that came from a FAILED `git worktree list` is not "there are no worktrees", and the store on
    // the other side of this IPC would otherwise mark every bound group missing on one bad read.
    return worktreeOps.listWorktrees(git, repoPath, strictPathPresent)
  }
  worktreeAdd(
    repoPath: string,
    wtPath: string,
    branch: string,
    baseRef: string,
    isNew: boolean
  ): Promise<GitResult> {
    // `wtPath` is computed from the LOCAL data dir, so adding it through a remote git would create a
    // worktree at a nonsense path on the host. Refuse (see `isRemoteRepo`).
    if (isRemoteRepo(repoPath)) return Promise.resolve(REMOTE_WORKTREE_REFUSAL())
    return this.createOwnedWorktree(repoPath, wtPath, branch, baseRef, isNew)
  }

  private async createOwnedWorktree(
    repoPath: string,
    wtPath: string,
    branch: string,
    baseRef: string,
    isNew: boolean
  ): Promise<GitResult> {
    const created = await worktreeOps.worktreeAdd(git, repoPath, wtPath, branch, baseRef, isNew)
    if (!created.ok) return created
    try {
      const binding = await measureWorktreePhysicalBinding(git, repoPath, wtPath)
      const worktreeOwnership = await this.worktreeOwnership.recordCreated(binding, isNew)
      return { ...created, worktreeOwnership }
    } catch (error) {
      return {
        ok: false,
        message:
          'The worktree was created, but its machine-local ownership record could not be ' +
          'verified. It was left on disk and no deletion authority was granted.'
      }
    }
  }
  worktreeMerge(
    repoPath: string,
    branch: string,
    baseRef: string,
    push = false
  ): Promise<worktreeOps.WorktreeOpResult> {
    if (isRemoteRepo(repoPath)) return Promise.resolve(REMOTE_WORKTREE_REFUSAL())
    // `pathExists` is git's `prunable` flag's fallback for git < 2.36 (see worktree-ops) — and the
    // only thing that stops a merge into a base checkout whose directory is gone. LOCAL-only: see
    // `isRemoteRepo` for why a remote repo is refused above instead of stat'd here.
    return worktreeOps.worktreeMerge(git, repoPath, branch, baseRef, push, strictPathPresent)
  }

  worktreeRemovalProof(
    repoPath: string,
    wtPath: string
  ): Promise<GitWorktreeRemovalProofResult> {
    if (isRemoteRepo(repoPath)) {
      return Promise.resolve({ ok: false, message: REMOTE_WORKTREE_REFUSAL().message })
    }
    return this.worktreeProofs.prepare(git, this.worktreeOwnership, repoPath, wtPath)
  }

  async worktreeRemove(
    repoPath: string,
    wtPath: string,
    request: GitWorktreeRemovalRequest
  ): Promise<GitResult> {
    // Refuse — and note what the refusal does NOT say: `worktreeGone`. A local stat of a remote
    // worktree would claim exactly that, and the renderer treats it as proof the directory is gone.
    if (isRemoteRepo(repoPath)) return REMOTE_WORKTREE_REFUSAL()
    if (!request || typeof request !== 'object') {
      return { ok: false, message: 'A worktree removal request is required. Nothing was changed.' }
    }
    if (request.mode === 'prune') {
      return worktreeOps.worktreeRemove(
        git,
        repoPath,
        wtPath,
        os.homedir(),
        false,
        true,
        strictPathPresent
      )
    }
    if (
      request.mode !== 'remove' ||
      !request.proof ||
      typeof request.deleteBranch !== 'boolean'
    ) {
      return { ok: false, message: 'A fresh worktree removal proof is required. Nothing was changed.' }
    }

    try {
      // Consume synchronously before the first await: one token can enter at most one mutation.
      const prepared = this.worktreeProofs.consume(request.proof)
      return await withCrossProcessLock(
        this.worktreeRemovalLock(prepared.binding.commonDir),
        async (lease) => {
          const verify = async () => {
            const current = await measureStableWorktreeRemoval(
              git,
              this.worktreeOwnership,
              repoPath,
              wtPath
            )
            if (current.fingerprint !== prepared.fingerprint) {
              throw new Error('The worktree changed after its removal proof was shown.')
            }
            await lease.fence()
          }
          await verify()
          const result = await worktreeOps.worktreeRemove(
            git,
            prepared.binding.repoPath,
            prepared.binding.worktreePath,
            os.homedir(),
            request.deleteBranch && prepared.ownership.branchCreatedByApp,
            false,
            strictPathPresent,
            {
              branchRef: prepared.binding.branchRef,
              branchTip: prepared.branchTip
            },
            verify
          )
          if (result.worktreeGone || result.ok) {
            try {
              await this.worktreeOwnership.forget(prepared.ownership.ownershipId)
            } catch {
              // The directory mutation already happened. Never let post-publication bookkeeping
              // turn that fact into “Nothing was removed” or make the renderer retain live
              // sessions against a path that is gone. The stale record is still generation-bound
              // and cannot authorize a replacement checkout; surface the cleanup warning instead.
              return {
                ...result,
                worktreeGone: true,
                message:
                  `${result.message} The machine-local ownership record could not be cleared; ` +
                  'future removal proofs stay unavailable until that record can be repaired.'
              }
            }
          }
          return result
        }
      )
    } catch (error) {
      return {
        ok: false,
        message: `${error instanceof Error ? error.message : 'The worktree could not be revalidated.'} Nothing was removed.`
      }
    }
  }

  /**
   * Store a branch dependency in the repository's shared config. The config key is derived only
   * after both branch values pass the same Git ref validation used by ordinary branch operations.
   */
  async setBranchParent(repoPath: string, child: string, parent: string): Promise<GitResult> {
    const key = branchParentConfigKey(child)
    const parentName = parent.trim()
    if (repoPath.trim().length > 4096 || !key || !isBoundedDependencyRef(parentName) || !isBoundedDependencyRef(child)) {
      return { ok: false, message: 'Invalid branch name.' }
    }
    const result = await git(repoPath, ['config', key, parentName], DEPENDENCY_MAX_OUTPUT_BYTES)
    return result.ok
      ? { ok: true, message: `Set ${child.trim()} parent to ${parentName}.` }
      : fail(result)
  }

  /** Clear a branch dependency projection. Clearing an absent key is idempotent. */
  async unsetBranchParent(repoPath: string, child: string): Promise<GitResult> {
    const key = branchParentConfigKey(child)
    if (repoPath.trim().length > 4096 || !key || !isBoundedDependencyRef(child)) return { ok: false, message: 'Invalid branch name.' }
    const result = await git(repoPath, ['config', '--unset', key], DEPENDENCY_MAX_OUTPUT_BYTES)
    if (result.ok || /exit code 5|not found/i.test(result.err)) {
      return { ok: true, message: `Cleared parent of ${child.trim()}.` }
    }
    return fail(result)
  }

  /** Rebase one child branch onto the parent recorded by its dependency projection. */
  async syncBranch(cwd: string, child: string): Promise<GitResult> {
    const childName = child.trim()
    const key = branchParentConfigKey(childName)
    if (cwd.trim().length > 4096 || !key || !isBoundedDependencyRef(childName)) return { ok: false, message: 'Invalid branch name.' }
    const parentResult = await git(cwd, ['config', '--get', key], DEPENDENCY_MAX_OUTPUT_BYTES)
    const parentName = parentResult.out.trim()
    if (!parentResult.ok || !parentName) {
      return {
        ok: false,
        message: `No parent configured for ${childName}. Declare the dependency first.`
      }
    }
    if (!isBoundedDependencyRef(parentName)) return { ok: false, message: 'Invalid parent branch.' }
    const result = await git(cwd, ['rebase', parentName], DEPENDENCY_MAX_OUTPUT_BYTES)
    if (result.ok) return { ok: true, message: result.out || `Rebased ${childName} onto ${parentName}.` }
    if (/conflict|could not apply|merge/i.test(result.err)) {
      return {
        ok: false,
        message:
          'Rebase stopped on a conflict. Resolve it in this terminal, then run ' +
          '`git rebase --continue` (or `git rebase --abort` to give up). ' +
          `Parent: ${parentName}.`
      }
    }
    return fail(result)
  }

  /** Open a pull request from the dependency child to its configured parent. */
  async proposeBranch(cwd: string, child: string): Promise<GitResult> {
    const childName = child.trim()
    const key = branchParentConfigKey(childName)
    if (cwd.trim().length > 4096 || !key || !isBoundedDependencyRef(childName)) return { ok: false, message: 'Invalid branch name.' }
    if (!GH_PATH) return { ok: false, message: 'GitHub CLI (gh) not found.' }
    const parentResult = await git(cwd, ['config', '--get', key])
    const parentName = parentResult.out.trim()
    if (!parentResult.ok || !parentName) {
      return {
        ok: false,
        message: `No parent configured for ${childName}. Declare the dependency first.`
      }
    }
    if (!isBoundedDependencyRef(parentName)) return { ok: false, message: 'Invalid parent branch.' }

    const env: NodeJS.ProcessEnv = { ...GIT_ENV }
    if (!(await ghAuthed())) {
      const token = await githubTokenFromGitCredentials(cwd)
      if (!token) return { ok: false, message: 'Sign in to GitHub to propose.', needsAuth: true }
      env.GH_TOKEN = token
    }
    try {
      await run(
        GH_PATH,
        [
          'pr',
          'create',
          '--base',
          parentName,
          '--head',
          childName,
          '--title',
          childName,
          '--body',
          `This pull request stacks ${childName} on ${parentName}.`
        ],
        { cwd, env, maxBuffer: DEPENDENCY_MAX_OUTPUT_BYTES }
      )
      return { ok: true, message: `Opened a pull request for ${childName} against ${parentName}.` }
    } catch (error) {
      const detail = error as { stderr?: string; message?: string }
      const message = (detail.stderr || detail.message || 'gh failed').trim()
      if (/\balready exists/i.test(message)) {
        return { ok: false, message: 'A pull request already exists for this branch.' }
      }
      if (/\b(401|403)\b|unauthor|forbidden|auth|token|scope|HTTP 4/i.test(message)) {
        return { ok: false, message, needsAuth: true }
      }
      return { ok: false, message }
    }
  }

  /** Fast-forward the configured parent checkout to the child branch. */
  async shipBranch(cwd: string, child: string, parent: string): Promise<GitResult> {
    const childName = child.trim()
    const parentName = parent.trim()
    if (cwd.trim().length > 4096 || !isBoundedDependencyRef(childName) || !isBoundedDependencyRef(parentName)) {
      return { ok: false, message: 'Invalid branch name.' }
    }
    const head = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], DEPENDENCY_MAX_OUTPUT_BYTES)
    if (!head.ok || head.out.trim() !== parentName) {
      return { ok: false, message: `The target checkout is not on parent branch ${parentName}.` }
    }
    const result = await git(cwd, ['merge', '--ff-only', childName], DEPENDENCY_MAX_OUTPUT_BYTES)
    return result.ok
      ? { ok: true, message: result.out || `Shipped ${childName} into ${parentName} by fast-forward.` }
      : fail(result)
  }

  private emitDependencyProgress(progress: DependencyOperationProgress): void {
    platform().broadcast(IPC.gitDependencyProgress, progress)
  }

  /** Execute one validated dependency plan with bounded output and a cancellable local process. */
  private async executeDependencyPlan(
    plan: NonNullable<ReturnType<typeof planDependencyOperation>>,
    signal: AbortSignal
  ): Promise<GitResult> {
    if (signal.aborted) return { ok: false, message: 'Dependency operation was cancelled before execution.' }
    if (plan.operationId === 'propose') {
      if (!GH_PATH) return { ok: false, message: 'GitHub CLI (gh) is unavailable on this machine.' }
      const auth = await ghAuthed()
      if (signal.aborted) return { ok: false, message: 'Dependency operation was cancelled before execution.' }
      const env: NodeJS.ProcessEnv = { ...GIT_ENV }
      if (!auth) {
        const token = await githubTokenFromGitCredentials(plan.cwd)
        if (!token) return { ok: false, message: 'GitHub sign-in is unavailable for this operation.' }
        env.GH_TOKEN = token
      }
      try {
        const { stdout } = await run(GH_PATH, [...plan.args], {
          cwd: plan.cwd,
          env,
          maxBuffer: DEPENDENCY_MAX_OUTPUT_BYTES,
          signal
        })
        return { ok: true, message: stdout.trim() || 'Pull request proposed.' }
      } catch (error) {
        const detail = error as { stderr?: string; message?: string }
        return fail({ ok: false, out: '', err: (detail.stderr || detail.message || 'gh failed').trim() })
      }
    }
    if (plan.operationId === 'ship') {
      const head = await git(plan.cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], plan.maxOutputBytes, signal)
      if (!head.ok || head.out.trim() !== plan.branch.parent) {
        return { ok: false, message: `The target checkout is not on parent branch ${plan.branch.parent}.` }
      }
    }
    const result = await git(plan.cwd, [...plan.args], plan.maxOutputBytes, signal)
    if (result.ok) return { ok: true, message: result.out || 'Dependency operation completed.' }
    if (plan.operationId === 'clear-parent' && /exit code 5|not found/i.test(result.err)) {
      return { ok: true, message: 'Branch parent was already clear.' }
    }
    if (plan.operationId === 'sync' && /conflict|could not apply|merge/i.test(result.err)) {
      return {
        ok: false,
        message:
          'Rebase stopped on a conflict. Resolve it in this terminal, then run ' +
          '`git rebase --continue` (or `git rebase --abort` to give up). ' +
          `Parent: ${plan.branch.parent}.`
      }
    }
    return fail(result)
  }

  /** Run one project-owned dependency link operation with explicit progress and cancellation state. */
  async dependencyOperation(request: DependencyOperationRequest): Promise<DependencyOperationResult> {
    const operation = request.operation
    const projectId = request.projectId.trim()
    const linkId = request.linkId.trim()
    const unavailable = (message: string): DependencyOperationResult => ({
      ok: false,
      operationId: null,
      operation,
      phase: 'unavailable',
      message,
      projectId,
      linkId
    })
    const plan = planDependencyOperation(request)
    if (!plan) {
      const reason = dependencyOperationAvailability(request).reason ?? 'Dependency operation is unavailable.'
      return unavailable(reason)
    }
    const operationId = randomUUID()
    const controller = new AbortController()
    this.dependencyOperations.set(operationId, { controller, started: false, request })
    const emit = (phase: DependencyOperationPhase, completed: number, message: string): void => {
      this.emitDependencyProgress({ operationId, operation, phase, completed, total: 1, message })
    }
    emit('queued', 0, 'Dependency operation queued.')
    await Promise.resolve()
    const state = this.dependencyOperations.get(operationId)
    if (!state || state.controller.signal.aborted) {
      this.dependencyOperations.delete(operationId)
      emit('cancelled', 0, 'Dependency operation cancelled before execution.')
      return { ok: false, operationId, operation, phase: 'cancelled', message: 'Dependency operation cancelled before execution.', projectId, linkId }
    }
    state.started = true
    emit('running', 0, 'Dependency operation is running.')
    try {
      const result = await this.executeDependencyPlan(plan, controller.signal)
      const phase: DependencyOperationPhase = result.ok
        ? 'completed'
        : controller.signal.aborted
          ? 'cancelled'
          : 'failed'
      emit(phase, result.ok ? 1 : 0, result.message)
      return { ok: result.ok, operationId, operation, phase, message: result.message, projectId, linkId }
    } finally {
      this.dependencyOperations.delete(operationId)
    }
  }

  /** Cancel only a queued operation. A running Git process is reported as non-cancellable. */
  async cancelDependencyOperation(operationId: string): Promise<boolean> {
    if (typeof operationId !== 'string' || operationId.length < 1 || operationId.length > 128) return false
    const state = this.dependencyOperations.get(operationId)
    if (!state || state.started) return false
    state.controller.abort()
    return true
  }

  async status(cwd: string): Promise<GitStatus> {
    const empty: GitStatus = {
      hasRepo: false,
      authoritative: false,
      repoName: '',
      branch: '',
      branches: [],
      ahead: 0,
      behind: 0,
      hasRemote: false,
      hasOrigin: false,
      hasUpstream: false,
      ghAvailable: !!GH_PATH,
      ghAuthed: false,
      staged: [],
      changes: []
    }
    if (!cwd) return empty

    const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree'])
    if (!inside.ok || inside.out.trim() !== 'true') {
      return { ...empty, repoName: path.basename(cwd) }
    }

    // These reads are independent of each other; run them concurrently instead of
    // serially spawning ~10 git processes one after the next. (`remote get-url origin`
    // simply fails to empty when there's no origin, so it needn't wait on `remote`.)
    // gh auth is deliberately NOT awaited here (ghAuthedSwr): it hits the GitHub API and
    // used to hold the whole status — i.e. the panel's first paint — hostage for ~700ms.
    const [
      branchR,
      branchesR,
      remoteBranchesR,
      remotesR,
      originR,
      countsR,
      upstreamR,
      cachedR,
      workR,
      porcelainR,
      headR,
      indexR,
      cachedBinaryR,
      workBinaryR,
      exactPorcelainR,
      untrackedR,
      gitDirR
    ] =
      await Promise.all([
        git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
        git(cwd, ['branch', '--format=%(refname:short)']),
        git(cwd, ['branch', '-r', '--format=%(refname:short)']),
        git(cwd, ['remote']),
        git(cwd, ['remote', 'get-url', 'origin']),
        git(cwd, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']),
        // Resolves only when the current branch has an upstream tracking ref —
        // distinguishes "never pushed (Publish Branch)" from "has upstream (Push/Pull/Sync)".
        git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
        git(cwd, ['diff', '--cached', '--numstat']),
        git(cwd, ['diff', '--numstat']),
        git(cwd, ['status', '--porcelain']),
        git(cwd, ['rev-parse', 'HEAD']),
        git(cwd, ['ls-files', '--stage', '-z']),
        git(cwd, ['diff', '--cached', '--binary', '--no-ext-diff']),
        git(cwd, ['diff', '--binary', '--no-ext-diff']),
        git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
        git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
        git(cwd, ['rev-parse', '--absolute-git-dir'])
      ])
    const gh = ghAuthedSwr()

    const branch = branchR.out.trim() || 'HEAD'
    const branches = branchesR.out.split('\n').map((b) => b.trim()).filter(Boolean)
    // `<remote>/HEAD` is a symref to the remote's default branch, not a branch of its own.
    const remoteBranches = remoteBranchesR.out
      .split('\n')
      .map((b) => b.trim())
      .filter((b) => b && !/\/HEAD$/.test(b))
    const hasRemote = !!remotesR.out.trim()
    const hasUpstream = upstreamR.ok && !!upstreamR.out.trim()
    const originUrl = originR.out.trim()
    // `hasRemote` is true for ANY remote — a fork whose only remote is `upstream` included. Anything
    // that pushes to `origin` by name (the worktree merge does) must ask for origin itself.
    const hasOrigin = originR.ok && !!originUrl
    const repoName = originUrl ? parseRepoName(originUrl, path.basename(cwd)) : path.basename(cwd)

    let ahead = 0
    let behind = 0
    if (countsR.ok && countsR.out) {
      const [b, a] = countsR.out.trim().split(/\s+/)
      behind = Number(b) || 0
      ahead = Number(a) || 0
    }

    const cachedStat = parseNumstat(cachedR.out)
    const workStat = parseNumstat(workR.out)

    const staged: GitFileChange[] = []
    const changes: GitFileChange[] = []
    const porcelain = porcelainR.out
    for (const raw of porcelain.split('\n').filter(Boolean)) {
      const x = raw[0]
      const y = raw[1]
      let p = raw.slice(3)
      if (p.includes(' -> ')) p = p.split(' -> ')[1] // rename: use new path
      const unquoted = p.replace(/^"|"$/g, '')

      if (x === '?' && y === '?') {
        changes.push({ path: unquoted, status: 'U', added: 0, deleted: 0 })
        continue
      }
      if (x !== ' ' && x !== '?') {
        const s = cachedStat.get(unquoted)
        staged.push({ path: unquoted, status: x, added: s?.added ?? 0, deleted: s?.deleted ?? 0 })
      }
      if (y !== ' ' && y !== '?') {
        const s = workStat.get(unquoted)
        changes.push({ path: unquoted, status: y, added: s?.added ?? 0, deleted: s?.deleted ?? 0 })
      }
    }

    const [rootGeneration, gitDirGeneration, untrackedFingerprint] = await Promise.all([
      filesystemGeneration(cwd),
      gitDirR.ok && gitDirR.out.trim() ? filesystemGeneration(gitDirR.out.trim()) : Promise.resolve(null),
      untrackedR.ok ? hashUntrackedFiles(cwd, untrackedR.out) : Promise.resolve(null)
    ])
    const criticalReads = [
      branchR,
      cachedR,
      workR,
      porcelainR,
      headR,
      indexR,
      cachedBinaryR,
      workBinaryR,
      exactPorcelainR,
      untrackedR,
      gitDirR
    ]
    const authoritative =
      criticalReads.every((result) => result.ok) &&
      !!rootGeneration &&
      !!gitDirGeneration &&
      untrackedFingerprint !== null
    const generation = authoritative ? `${rootGeneration}\0${gitDirGeneration}` : ''
    const removalProof: GitWorktreeRemovalMeasurement | undefined = authoritative
      ? {
          headOid: headR.out.trim(),
          generation,
          fingerprint: gitRemovalFingerprint({
            headOid: headR.out.trim(),
            index: indexR.out,
            cachedDiff: cachedBinaryR.out,
            worktreeDiff: workBinaryR.out,
            porcelain: exactPorcelainR.out,
            untracked: untrackedFingerprint!,
            generation
          })
        }
      : undefined

    return {
      hasRepo: true,
      authoritative,
      removalProof,
      repoName,
      branch,
      branches,
      remoteBranches,
      ahead,
      behind,
      hasRemote,
      hasOrigin,
      hasUpstream,
      ghAvailable: !!GH_PATH,
      ghAuthed: gh,
      staged,
      changes
    }
  }

  async diff(cwd: string, p: string, staged: boolean, untracked: boolean): Promise<string> {
    if (!cwd || !p) return ''
    if (untracked) {
      // No-index diff against /dev/null shows the whole file as additions (exits 1).
      const r = await git(cwd, ['diff', '--no-index', '--', '/dev/null', p])
      return r.out || r.err
    }
    const args = staged ? ['diff', '--cached', '--', p] : ['diff', '--', p]
    const r = await git(cwd, args)
    return r.out
  }

  async discard(cwd: string, p: string, untracked: boolean): Promise<GitResult> {
    if (untracked) {
      const r = await git(cwd, ['clean', '-f', '--', p])
      return r.ok ? { ok: true, message: '' } : fail(r)
    }
    const r = await git(cwd, ['restore', '--source=HEAD', '--staged', '--worktree', '--', p])
    return r.ok ? { ok: true, message: '' } : fail(r)
  }

  async switchBranch(cwd: string, name: string): Promise<GitResult> {
    if (!isValidRef(name)) return { ok: false, message: 'Invalid branch name.' }
    const r = await git(cwd, ['switch', name.trim()])
    return r.ok ? { ok: true, message: `Switched to ${name.trim()}.` } : fail(r)
  }

  async showFile(cwd: string, ref: string, p: string): Promise<string> {
    if (!cwd || !p) return ''
    const spec = ref ? `${ref}:${p}` : `:${p}`
    const r = await git(cwd, ['show', spec])
    return r.ok ? r.out : ''
  }

  async history(cwd: string, options?: GitHistoryOptions | null): Promise<GitHistoryResult> {
    // A default parameter is not enough: over WS-RPC (Server Edition) the args array is
    // JSON-round-tripped, so the renderer's trailing `undefined` arrives as `null` and the default
    // never fires. Normalize explicitly, or every history call throws in the browser.
    const opts = options ?? {}
    if (!cwd) {
      return { items: [], hasIncomingChanges: false, hasOutgoingChanges: false, hasMore: false, limit: opts.limit ?? 50 }
    }
    // Adapt the shared executor (throws on failure) onto the ssh-routing `git()` runner — NOT a
    // direct local `run('git', …)`: for an SSH project the scope cwd is a REMOTE path, and local
    // git against it fails every history load (or, if the path happens to exist here, serves the
    // wrong machine's history). `git()` returns {ok,…} instead of throwing, so re-raise on !ok —
    // the loader's per-probe catches (upstream ref, merge-base, …) rely on failures throwing.
    return loadGitHistoryFromExecutor(
      async (args, dir) => {
        const r = await git(dir, args)
        if (!r.ok) throw new Error(r.err || `git ${args[0] ?? ''} failed`)
        return { stdout: r.out }
      },
      cwd,
      opts
    )
  }

  /** Files changed by a single commit (parent↔commit; `--root` so the initial commit shows). */
  async commitFiles(cwd: string, oid: string): Promise<GitFileChange[]> {
    if (!cwd || !/^[0-9a-fA-F]{7,64}$/.test(oid)) return []
    const [namesR, statR] = await Promise.all([
      git(cwd, ['diff-tree', '--no-commit-id', '--root', '-r', '-z', '--name-status', oid]),
      git(cwd, ['diff-tree', '--no-commit-id', '--root', '-r', '--numstat', oid])
    ])
    const stat = parseNumstat(statR.out)
    const files: GitFileChange[] = []
    const tokens = namesR.out.split('\0').filter(Boolean)
    for (let i = 0; i < tokens.length; ) {
      const status = tokens[i]![0] ?? 'M'
      if (status === 'R' || status === 'C') {
        const newPath = tokens[i + 2] ?? ''
        const s = stat.get(newPath)
        files.push({ path: newPath, status, added: s?.added ?? 0, deleted: s?.deleted ?? 0 })
        i += 3
      } else {
        const p = tokens[i + 1] ?? ''
        const s = stat.get(p)
        files.push({ path: p, status, added: s?.added ?? 0, deleted: s?.deleted ?? 0 })
        i += 2
      }
    }
    return files
  }

  /** Read the origin through the same local or managed-SSH git executor as every other git read. */
  async originUrl(cwd: string): Promise<string | null> {
    if (!cwd) return null
    const result = await git(cwd, ['remote', 'get-url', 'origin'])
    const url = result.out.trim()
    return result.ok && url ? url : null
  }

  /** Build a provider web URL for a commit from the origin remote; null if unsupported. */
  async remoteCommitUrl(cwd: string, sha: string): Promise<string | null> {
    if (!cwd || !/^[0-9a-fA-F]{7,64}$/.test(sha)) return null
    const r = await git(cwd, ['remote', 'get-url', 'origin'])
    if (!r.ok) return null
    const url = r.out.trim()
    const m =
      url.match(/^git@([^:]+):(.+?)(?:\.git)?$/) ||
      url.match(/^ssh:\/\/(?:[^@]+@)?([^/]+)\/(.+?)(?:\.git)?$/) ||
      url.match(/^https?:\/\/(?:[^@]+@)?([^/]+)\/(.+?)(?:\.git)?$/)
    if (!m) return null
    const host = m[1]
    const repoPath = m[2]
    if (/(^|\.)github\.com$/.test(host) || /(^|\.)gitlab\.com$/.test(host)) {
      return `https://${host}/${repoPath}/commit/${sha}`
    }
    if (/(^|\.)bitbucket\.org$/.test(host)) {
      return `https://${host}/${repoPath}/commits/${sha}`
    }
    return null
  }

  async createBranch(cwd: string, name: string): Promise<GitResult> {
    if (!name.trim()) return { ok: false, message: 'Branch name is empty.' }
    if (!isValidRef(name)) return { ok: false, message: 'Invalid branch name.' }
    const r = await git(cwd, ['switch', '-c', name.trim()])
    return r.ok ? { ok: true, message: `Created ${name.trim()}.` } : fail(r)
  }

  async merge(cwd: string, ref: string): Promise<GitResult> {
    if (!isValidRef(ref)) return { ok: false, message: 'Invalid branch name.' }
    const r = await git(cwd, ['merge', ref.trim()])
    return r.ok ? { ok: true, message: r.out || `Merged ${ref.trim()}.` } : fail(r)
  }

  async rebase(cwd: string, onto: string): Promise<GitResult> {
    if (!isValidRef(onto)) return { ok: false, message: 'Invalid branch name.' }
    const r = await git(cwd, ['rebase', onto.trim()])
    return r.ok ? { ok: true, message: r.out || `Rebased onto ${onto.trim()}.` } : fail(r)
  }

  async deleteBranch(cwd: string, name: string, force: boolean): Promise<GitResult> {
    if (!isValidRef(name)) return { ok: false, message: 'Invalid branch name.' }
    const r = await git(cwd, ['branch', force ? '-D' : '-d', name.trim()])
    return r.ok ? { ok: true, message: `Deleted ${name.trim()}.` } : fail(r)
  }

  async renameBranch(cwd: string, newName: string): Promise<GitResult> {
    if (!isValidRef(newName)) return { ok: false, message: 'Invalid branch name.' }
    const r = await git(cwd, ['branch', '-m', newName.trim()])
    return r.ok ? { ok: true, message: `Renamed to ${newName.trim()}.` } : fail(r)
  }

  async fetch(cwd: string): Promise<GitResult> {
    const r = await git(cwd, ['fetch', '--all', '--prune'])
    return r.ok ? { ok: true, message: r.out || 'Fetched.' } : fail(r)
  }

  async forcePush(cwd: string): Promise<GitResult> {
    const r = await git(cwd, ['push', '--force-with-lease'])
    return r.ok ? { ok: true, message: 'Force-pushed.' } : fail(r)
  }

  async stashPush(cwd: string): Promise<GitResult> {
    const r = await git(cwd, ['stash', 'push', '-u'])
    return r.ok ? { ok: true, message: r.out || 'Stashed.' } : fail(r)
  }

  async stashPop(cwd: string): Promise<GitResult> {
    const r = await git(cwd, ['stash', 'pop'])
    return r.ok ? { ok: true, message: r.out || 'Popped stash.' } : fail(r)
  }

  async revert(cwd: string, oid: string): Promise<GitResult> {
    if (!/^[0-9a-fA-F]{7,64}$/.test(oid)) return { ok: false, message: 'Invalid commit.' }
    const r = await git(cwd, ['revert', '--no-edit', oid])
    return r.ok ? { ok: true, message: r.out || 'Reverted.' } : fail(r)
  }

  async branchAt(cwd: string, name: string, oid: string): Promise<GitResult> {
    if (!isValidRef(name)) return { ok: false, message: 'Invalid branch name.' }
    if (!/^[0-9a-fA-F]{7,64}$/.test(oid)) return { ok: false, message: 'Invalid commit.' }
    const r = await git(cwd, ['switch', '-c', name.trim(), oid])
    return r.ok ? { ok: true, message: `Created ${name.trim()}.` } : fail(r)
  }

  async checkoutCommit(cwd: string, oid: string): Promise<GitResult> {
    if (!/^[0-9a-fA-F]{7,64}$/.test(oid)) return { ok: false, message: 'Invalid commit.' }
    const r = await git(cwd, ['checkout', '--detach', oid])
    return r.ok ? { ok: true, message: `Checked out ${oid.slice(0, 7)} (detached).` } : fail(r)
  }

  /**
   * Clone a repo into parentDir with live progress (IPC.gitCloneProgress) and abort
   * support. Resolves at the END of the clone; success message = the cloned path.
   * The target dir is claimed with a non-recursive mkdir: EEXIST is a friendly error,
   * and on failure/abort we only ever delete the directory WE created this run.
   */
  async clone(parentDir: string, rawUrl: string): Promise<GitResult> {
    if (activeClone) return { ok: false, message: 'A clone is already running.' }
    const url = expandCloneUrl(rawUrl ?? '')
    if (!parentDir || !url) return { ok: false, message: 'Folder and URL are required.' }
    if (!isValidCloneUrl(url)) return { ok: false, message: 'Invalid repository URL.' }
    const dirName = deriveRepoDirName(url)
    if (!dirName) return { ok: false, message: 'Could not derive a folder name from that URL.' }
    const clonePath = path.join(parentDir, dirName)
    // Reserve the single-flight slot synchronously, BEFORE the mkdir await, so a
    // concurrent clone() can't slip past the guard during the await. child is filled
    // in once spawned; cloneAbort() guards against the null window.
    const rec: ActiveClone = { child: null, clonePath, aborted: false }
    activeClone = rec
    try {
      await fs.promises.mkdir(clonePath) // non-recursive claim; also validates parent exists
    } catch (e) {
      activeClone = null
      const err = e as NodeJS.ErrnoException
      if (err.code === 'EEXIST') {
        return {
          ok: false,
          message: `Destination already exists: ${clonePath}. Pick another folder or open it directly.`
        }
      }
      return { ok: false, message: `Cannot create ${clonePath}: ${err.message}` }
    }
    return await new Promise<GitResult>((resolve) => {
      const child = spawn('git', ['clone', '--progress', '--', url, clonePath], {
        cwd: parentDir,
        env: GIT_ENV,
        stdio: ['ignore', 'ignore', 'pipe']
      })
      rec.child = child
      let tail = '' // last 4 KB of stderr for the error message
      child.stderr?.on('data', (d: Buffer) => {
        const text = d.toString('utf-8')
        tail = (tail + text).slice(-4096)
        const p = parseCloneProgress(text)
        if (p) platform().broadcast(IPC.gitCloneProgress, p)
      })
      // Failure/abort: remove the dir we claimed (never anything pre-existing).
      const finishFail = (message: string): void => {
        activeClone = null
        void fs.promises.rm(clonePath, { recursive: true, force: true })
        resolve({ ok: false, message })
      }
      child.on('error', (e) => finishFail(`git could not start: ${e.message}`))
      child.on('close', (code) => {
        if (rec.aborted) return finishFail('aborted')
        if (code === 0) {
          activeClone = null
          resolve({ ok: true, message: clonePath })
          return
        }
        const clean = stripAnsiCodes(tail)
        const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean)
        const fatal = [...lines].reverse().find((l) => /^(fatal|error):/i.test(l))
        finishFail(fatal ?? lines.pop() ?? 'Clone failed.')
      })
    })
  }

  /** Abort the in-flight clone (no-op when idle). */
  cloneAbort(): void {
    if (!activeClone) return
    activeClone.aborted = true
    // child may be null during the reservation→spawn window; the close handler still
    // honors `aborted` once the process starts.
    activeClone.child?.kill('SIGTERM')
  }

  /** ~/projects when present, else the home dir. */
  cloneDefaultParent(): string {
    const p = path.join(os.homedir(), 'projects')
    try {
      if (fs.statSync(p).isDirectory()) return p
    } catch {
      /* fall through */
    }
    return os.homedir()
  }

  async init(cwd: string): Promise<GitResult> {
    if (!cwd) return { ok: false, message: 'No project folder set.' }
    const r = await git(cwd, ['init', '-b', 'main'])
    return r.ok ? { ok: true, message: 'Initialized repository.' } : fail(r)
  }

  async stage(cwd: string, paths: string[]): Promise<GitResult> {
    if (paths.length === 0) return { ok: true, message: '' }
    const r = await git(cwd, ['add', '--', ...paths])
    return r.ok ? { ok: true, message: '' } : fail(r)
  }

  async unstage(cwd: string, paths: string[]): Promise<GitResult> {
    if (paths.length === 0) return { ok: true, message: '' }
    const r = await git(cwd, ['restore', '--staged', '--', ...paths])
    return r.ok ? { ok: true, message: '' } : fail(r)
  }

  async stageAll(cwd: string): Promise<GitResult> {
    const r = await git(cwd, ['add', '-A'])
    return r.ok ? { ok: true, message: '' } : fail(r)
  }

  async unstageAll(cwd: string): Promise<GitResult> {
    const r = await git(cwd, ['reset'])
    return r.ok ? { ok: true, message: '' } : fail(r)
  }

  async commit(cwd: string, message: string): Promise<GitResult> {
    if (!message.trim()) return { ok: false, message: 'Commit message is empty.' }
    const c = await git(cwd, ['commit', '-m', message])
    return c.ok ? { ok: true, message: c.out || 'Committed.' } : fail(c)
  }

  async push(cwd: string): Promise<GitResult> {
    const r = await git(cwd, ['push'])
    if (r.ok) return { ok: true, message: 'Pushed.' }
    if (/no upstream|has no upstream|set-upstream/i.test(r.err)) {
      const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim() || 'main'
      const up = await git(cwd, ['push', '-u', 'origin', branch])
      return up.ok ? { ok: true, message: 'Pushed (set upstream).' } : fail(up)
    }
    return fail(r)
  }

  async pull(cwd: string): Promise<GitResult> {
    const r = await git(cwd, ['pull'])
    return r.ok ? { ok: true, message: r.out || 'Pulled.' } : fail(r)
  }

  async sync(cwd: string): Promise<GitResult> {
    const pull = await this.pull(cwd)
    if (!pull.ok) return pull
    return this.push(cwd)
  }

  async publish(cwd: string, name: string, isPrivate: boolean): Promise<GitResult> {
    if (!GH_PATH) return { ok: false, message: 'GitHub CLI (gh) not found.' }
    const repo = (name || '').trim()
    // GitHub repo names (optionally `owner/repo`) are limited to these chars and
    // must not start with `-`, so gh can't read the value as an option flag.
    if (!repo || repo.startsWith('-') || !/^[A-Za-z0-9._/-]+$/.test(repo)) {
      return { ok: false, message: 'Invalid repository name.' }
    }
    // Prefer gh's own login; otherwise reuse the user's existing git HTTPS token
    // (the one that already lets them push) so publishing doesn't demand a separate
    // `gh auth login`. If neither is available, signal the UI to start a login.
    const env: NodeJS.ProcessEnv = { ...GIT_ENV }
    if (!(await ghAuthed())) {
      const token = await githubTokenFromGitCredentials(cwd)
      if (!token) {
        return { ok: false, message: 'Sign in to GitHub to publish.', needsAuth: true }
      }
      env.GH_TOKEN = token
    }
    try {
      await run(
        GH_PATH,
        ['repo', 'create', repo, isPrivate ? '--private' : '--public', '--source=.', '--push'],
        { cwd, env, maxBuffer: 10 * 1024 * 1024 }
      )
      return { ok: true, message: 'Published to GitHub.' }
    } catch (e) {
      const err = e as { stderr?: string; message?: string }
      const msg = (err.stderr || err.message || 'gh failed').trim()
      // A reused token without repo-create scope (or an expired one) reads as an auth
      // failure — let the UI offer a full login rather than a dead-end error.
      if (/\b(401|403)\b|unauthor|forbidden|auth|token|scope|HTTP 4/i.test(msg)) {
        return { ok: false, message: msg, needsAuth: true }
      }
      return { ok: false, message: msg }
    }
  }
}

function fail(e: Exec): GitResult {
  return { ok: false, message: e.err || e.out || 'git command failed' }
}
