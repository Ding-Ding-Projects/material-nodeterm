// Local, git-backed version history for a user-managed record this app owns (settings today —
// see docs/local-history.md). One isolated repository PER DOMAIN, living beside the app's own
// data directory — never inside a project the user owns, and never the project's own `.git`.
//
// Three rules the rest of this file exists to honour:
//   1. A history WRITE must never fail the operation the user actually asked for. `record()`
//      never throws; a failure is logged and swallowed.
//   2. History is APPEND-ONLY. Restoring an old revision writes a NEW commit (the caller does
//      this — see local-history-handlers.ts) rather than resetting/rewriting the branch, so an
//      undo can itself be undone.
//   3. Credential material never enters a snapshot. This module has no opinion on what a caller
//      hands it — the settings-store wiring is what keeps that promise for the settings domain.
//
// Cross-process safety deliberately does NOT use a reclaimable lock. PID visibility is namespace
// local, leases can expire while a suspended publisher is still alive, and deleting a foreign
// `.git/index.lock` can destroy another process's live work. Each requested revision is first
// written as an immutable owner-unique journal, then built with an owner-unique GIT_INDEX_FILE.
// Writers publish only through `git update-ref <ref> <new> <observed>` compare-and-swap. A loser
// rebuilds on the winning ref; a crashed writer leaves only immutable objects, its own index, and
// a replayable journal. Nothing ever resets, cleans or deletes foreign state.

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { HistoryAction, HistoryEntry, HistoryFilters } from '../shared/local-history'
import { removeAtomic, renameAtomic, writeFileAtomic } from './fs-atomic'

export type { HistoryAction, HistoryEntry, HistoryFilters } from '../shared/local-history'

const UNIT_SEP = '\x1f'
const RECORD_SEP = '\x1e'
const ACTION_TRAILER = 'X-History-Action:'
const TRANSACTION_TRAILER = 'X-History-Transaction:'
const JOURNAL_VERSION = 1
const MAX_JOURNALS = 4_096
const MAX_JOURNAL_BYTES = 32 * 1024 * 1024
const MAX_CAS_ATTEMPTS = 32
const GIT_TIMEOUT_MS = 10_000
const ACTIONS = new Set<HistoryAction>(['created', 'updated', 'deleted', 'restored'])
const GIT_REPOSITORY_REDIRECTS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_QUARANTINE_PATH',
  'GIT_PREFIX',
  'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM'
] as const

export interface LocalHistoryGitOptions {
  input?: string
  env?: NodeJS.ProcessEnv
}

export async function runLocalHistoryGit(
  cwd: string,
  args: string[],
  options: LocalHistoryGitOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  // Internal history repositories must never execute a template/global hook. Besides being an
  // unexpected extension point for app-owned data, an interactive hook would defeat the bounded
  // API contract. A deliberately nonexistent path disables hooks without touching global config.
  const disabledHooks = path.join(cwd, '.git', 'nodeterm-hooks-disabled')
  const requestedIndex = options.env?.GIT_INDEX_FILE
  const env: NodeJS.ProcessEnv = { ...process.env, ...options.env }
  // An app launched from a Git hook or an unusual shell can inherit GIT_DIR/GIT_WORK_TREE. Letting
  // those variables escape this boundary would make "internal repository" a false claim and could
  // publish history objects into a user's project. The private index is the sole intentional Git
  // repository-routing override; everything else is derived from the checked cwd.
  for (const key of GIT_REPOSITORY_REDIRECTS) delete env[key]
  delete env.GIT_INDEX_FILE
  if (requestedIndex) env.GIT_INDEX_FILE = requestedIndex
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', `core.hooksPath=${disabledHooks}`, ...args], {
      cwd,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let tooLarge = false
    const finish = (error?: Error & { code?: string | number; stdout?: string; stderr?: string }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
      } else {
        resolve({ stdout, stderr })
      }
    }
    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString('utf-8')
      if (Buffer.byteLength(next, 'utf-8') > 32 * 1024 * 1024) {
        tooLarge = true
        child.kill('SIGKILL')
      }
      return next
    }
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk)
    })
    child.once('error', (error) => finish(error))
    child.once('close', (code, signal) => {
      if (timedOut) {
        const error = new Error('Git exceeded the local-history command deadline.') as Error & {
          code: string
        }
        error.code = 'ETIMEDOUT'
        finish(error)
        return
      }
      if (tooLarge) {
        const error = new Error('Git exceeded the local-history output limit.') as Error & {
          code: string
        }
        error.code = 'ENOBUFS'
        finish(error)
        return
      }
      if (code !== 0) {
        const error = new Error(
          `Git exited with ${code ?? signal ?? 'an unknown status'}: ${stderr.trim()}`
        ) as Error & { code: number | string }
        error.code = code ?? signal ?? 'EGIT'
        finish(error)
        return
      }
      finish()
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, GIT_TIMEOUT_MS)
    child.stdin.on('error', () => undefined)
    child.stdin.end(options.input ?? '')
  })
}

export type LocalHistoryGit = typeof runLocalHistoryGit

interface PendingRevision {
  version: number
  id: string
  createdAt: number
  domain: string
  filename: string
  content: string
  label: string
  action: HistoryAction
}

function codeOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : ''
}

function exitCodeIs(error: unknown, code: number): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function safeFilename(filename: string): string {
  if (
    filename.length === 0 ||
    filename.length > 1_024 ||
    filename.includes('\0') ||
    filename.includes('\\') ||
    path.posix.isAbsolute(filename)
  ) {
    throw new Error('The local-history filename is invalid.')
  }
  const normalized = path.posix.normalize(filename)
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized === '.git' ||
    normalized.startsWith('.git/')
  ) {
    throw new Error('The local-history filename escapes its revision tree.')
  }
  return normalized
}

function validOid(value: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)
}

function journalFrom(value: unknown, expectedId: string): PendingRevision | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const journal = value as Partial<PendingRevision>
  if (journal.version !== JOURNAL_VERSION || journal.id !== expectedId) return null
  if (!/^[0-9a-f]{32}$/.test(journal.id)) return null
  if (!Number.isSafeInteger(journal.createdAt) || (journal.createdAt ?? -1) < 0) return null
  if (
    typeof journal.domain !== 'string' ||
    journal.domain.length === 0 ||
    journal.domain.length > 128
  ) {
    return null
  }
  if (typeof journal.filename !== 'string') return null
  try {
    safeFilename(journal.filename)
  } catch {
    return null
  }
  if (typeof journal.content !== 'string') return null
  if (
    typeof journal.label !== 'string' ||
    journal.label.length === 0 ||
    journal.label.length > 16_384
  ) {
    return null
  }
  if (!ACTIONS.has(journal.action as HistoryAction)) return null
  return journal as PendingRevision
}

export class LocalHistoryStore {
  private ready = new Map<string, Promise<boolean>>()
  /**
   * The filesystem protocol below is cross-process. This lighter Promise tail still avoids making
   * one process repeatedly lose CAS races against itself and preserves call order for its callers.
   */
  private writes = new Map<string, Promise<void>>()

  constructor(
    private readonly userDataDir: string,
    private readonly runGit: LocalHistoryGit = runLocalHistoryGit
  ) {}

  /** Portable copy of one complete app-owned history repository. The caller embeds these bytes
   * in a project archive; this never reads or bundles the user's own project `.git`. */
  async exportBundle(domain: string): Promise<Buffer | null> {
    if (!(await this.ensureRepo(domain))) return null
    await this.drainJournals(domain)
    const head = await this.headOid(domain)
    if (!head) return null
    const dir = this.domainDir(domain)
    const bundle = path.join(dir, `.export-${process.pid}-${randomUUID()}.bundle`)
    try {
      await this.runGit(dir, ['bundle', 'create', bundle, '--all'])
      return await fs.readFile(bundle)
    } finally {
      await fs.rm(bundle, { force: true }).catch(() => {})
    }
  }

  /** Install a verified bundle into a fresh app-owned history domain. Existing history is never
   * overwritten: import mints a new project identity before reaching this method. */
  async importBundle(domain: string, bytes: Uint8Array): Promise<void> {
    if (bytes.byteLength === 0 || bytes.byteLength > 128 * 1024 * 1024) {
      throw new Error('The project history bundle is empty or exceeds 128 MB.')
    }
    const target = this.domainDir(domain)
    try {
      await fs.access(target)
      throw new Error('A local history repository already exists for this project.')
    } catch (error) {
      if (codeOf(error) !== 'ENOENT') throw error
    }
    const parent = path.dirname(target)
    const bundle = path.join(parent, `.import-${process.pid}-${randomUUID()}.bundle`)
    const staging = `${target}.import-${process.pid}-${randomUUID()}`
    await fs.mkdir(parent, { recursive: true, mode: 0o700 })
    try {
      await fs.writeFile(bundle, bytes, { mode: 0o600 })
      await fs.mkdir(staging, { recursive: true, mode: 0o700 })
      await this.runGit(staging, ['init', '--quiet'])
      await this.runGit(staging, ['bundle', 'verify', bundle])
      await fs.rm(staging, { recursive: true, force: true })
      await this.runGit(parent, ['clone', '--quiet', bundle, staging])
      // renameAtomic, not a bare fs.rename: on Windows this publish can lose to Defender or the
      // indexer briefly holding `target` open, exactly like every other temp-then-rename here.
      await renameAtomic(staging, target)
      this.ready.delete(target)
    } finally {
      await fs.rm(bundle, { force: true }).catch(() => {})
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
    }
  }

  async readHeadFile(domain: string, filename: string): Promise<string | null> {
    if (!(await this.ensureRepo(domain))) return null
    const head = await this.headOid(domain)
    if (!head) return null
    const { stdout } = await this.runGit(this.domainDir(domain), [
      'show',
      `${head}:${safeFilename(filename)}`
    ])
    return stdout
  }

  private domainDir(domain: string): string {
    // `domain` is an internal literal ('settings' today), but sanitize so two future callers cannot
    // turn a renderer value into traversal. The resolved directory is also the in-process lane key.
    const safe = domain.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default'
    return path.join(this.userDataDir, 'local-history', safe)
  }

  /** Exact app-owned path for rollback of a freshly imported domain. Never accepts a raw path. */
  domainPath(domain: string): string {
    return this.domainDir(domain)
  }

  private journalDir(domain: string): string {
    return path.join(this.domainDir(domain), '.nodeterm-history-pending')
  }

  /** Ensure the domain repo exists. Only a successful bootstrap is cached; a transient failure is
   *  retried by the next call, and only checked ENOENT means `.git` is absent. Concurrent `git init`
   *  is idempotent; if one bootstrap loses an internal Git lock, its already-durable journal is
   *  replayed by the winner or the next process rather than being discarded. */
  private async ensureRepo(domain: string): Promise<boolean> {
    const key = this.domainDir(domain)
    const cached = this.ready.get(key)
    if (cached) return cached
    const promise = (async () => {
      try {
        await fs.mkdir(key, { recursive: true, mode: 0o700 })
        let exists = false
        try {
          exists = (await fs.stat(path.join(key, '.git'))).isDirectory()
        } catch (error) {
          if (codeOf(error) !== 'ENOENT') throw error
        }
        if (!exists) await this.runGit(key, ['init', '--quiet'])
        const { stdout } = await this.runGit(key, ['symbolic-ref', '--quiet', 'HEAD'])
        if (!stdout.trim().startsWith('refs/heads/')) {
          throw new Error('The local-history repository has no writable branch ref.')
        }
        return true
      } catch (error) {
        console.error(`[local-history] could not prepare the "${domain}" repo:`, error)
        return false
      }
    })()
    this.ready.set(key, promise)
    const ok = await promise
    if (!ok && this.ready.get(key) === promise) this.ready.delete(key)
    return ok
  }

  /** Snapshot `content` as a new revision. NEVER throws — see the file header. */
  async record(opts: {
    domain: string
    filename: string
    content: string
    label: string
    action: HistoryAction
  }): Promise<void> {
    const key = this.domainDir(opts.domain)
    const previous = this.writes.get(key) ?? Promise.resolve()
    const run = previous
      .catch(() => undefined)
      .then(() => this.recordNow(opts))
      .catch((error) => {
        // Keep the public promise non-throwing even when validation fails before a journal exists.
        console.error(`[local-history] failed to record "${opts.label}" for ${opts.domain}:`, error)
      })
    this.writes.set(key, run)
    await run
    if (this.writes.get(key) === run) this.writes.delete(key)
  }

  private async recordNow(opts: {
    domain: string
    filename: string
    content: string
    label: string
    action: HistoryAction
  }): Promise<void> {
    if (!ACTIONS.has(opts.action)) throw new Error('The local-history action is invalid.')
    if (opts.label.length === 0 || opts.label.length > 16_384) {
      throw new Error('The local-history label is invalid.')
    }
    const id = randomUUID().replaceAll('-', '')
    const journal: PendingRevision = {
      version: JOURNAL_VERSION,
      id,
      createdAt: Date.now(),
      domain: opts.domain,
      filename: safeFilename(opts.filename),
      content: opts.content,
      label: opts.label,
      action: opts.action
    }
    const journalDir = this.journalDir(opts.domain)
    const journalPath = path.join(journalDir, `${id}.json`)
    try {
      await fs.mkdir(journalDir, { recursive: true, mode: 0o700 })
      // Publication of the intent is atomic. A crash before this rename leaves only this writer's
      // unique temp; a crash after it leaves a complete replayable request.
      await writeFileAtomic(journalPath, JSON.stringify(journal), { mode: 0o600 })
      if (!(await this.ensureRepo(opts.domain))) return
      await this.drainJournals(opts.domain)
      // This invocation owns exactly this path. Foreign helpers may publish its revision but never
      // delete its journal; only the originating invocation removes it after observing resolution.
      if (await this.transactionResolved(opts.domain, id)) {
        if (!(await removeAtomic(journalPath))) {
          throw new Error(
            'The local-history revision landed but its owner journal could not be removed.'
          )
        }
      }
    } catch (error) {
      // Rule 1: the settings operation is already durable. Keep a complete journal for a later
      // process to replay and never "repair" by resetting or cleaning the shared repository.
      console.error(`[local-history] failed to record "${opts.label}" for ${opts.domain}:`, error)
    }
  }

  private async readJournals(domain: string): Promise<PendingRevision[]> {
    const directory = this.journalDir(domain)
    let entries: string[]
    try {
      entries = await fs.readdir(directory)
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return []
      throw error
    }
    const journalNames = entries.filter((entry) => /^[0-9a-f]{32}\.json$/.test(entry))
    if (journalNames.length > MAX_JOURNALS) {
      throw new Error('Too many pending local-history revisions to reconcile safely.')
    }
    const journals: PendingRevision[] = []
    for (const filename of journalNames) {
      const id = filename.slice(0, -'.json'.length)
      const journalPath = path.join(directory, filename)
      try {
        const stat = await fs.lstat(journalPath)
        if (!stat.isFile() || stat.size > MAX_JOURNAL_BYTES) {
          throw new Error(`Pending local-history revision ${id} is not a readable bounded file.`)
        }
        const journal = journalFrom(JSON.parse(await fs.readFile(journalPath, 'utf-8')), id)
        if (!journal || this.domainDir(journal.domain) !== this.domainDir(domain)) {
          throw new Error(`Pending local-history revision ${id} is malformed.`)
        }
        journals.push(journal)
      } catch (error) {
        // Its owning invocation may remove the journal after readdir. That exact ENOENT is a
        // completed/vanished request, not corruption; every other inspection failure fails closed.
        if (codeOf(error) !== 'ENOENT') throw error
      }
    }
    journals.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    return journals
  }

  private async drainJournals(domain: string): Promise<void> {
    for (const journal of await this.readJournals(domain)) {
      await this.publishJournal(domain, journal)
    }
  }

  private async historyRef(domain: string): Promise<string> {
    const { stdout } = await this.runGit(this.domainDir(domain), [
      'symbolic-ref',
      '--quiet',
      'HEAD'
    ])
    const ref = stdout.trim()
    if (!/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(ref) || ref.includes('..')) {
      throw new Error('The local-history repository branch ref is invalid.')
    }
    return ref
  }

  private async headOid(domain: string, ref?: string): Promise<string | null> {
    const resolvedRef = ref ?? (await this.historyRef(domain))
    try {
      const { stdout } = await this.runGit(this.domainDir(domain), [
        'rev-parse',
        '--verify',
        '--quiet',
        resolvedRef
      ])
      const oid = stdout.trim()
      if (!validOid(oid)) throw new Error('Git returned an invalid local-history object id.')
      return oid
    } catch (error) {
      if (exitCodeIs(error, 1)) return null
      throw error
    }
  }

  private processedRef(id: string): string {
    return `refs/nodeterm-history/processed/${id}`
  }

  private async transactionResolved(domain: string, id: string): Promise<boolean> {
    const dir = this.domainDir(domain)
    try {
      await this.runGit(dir, ['rev-parse', '--verify', '--quiet', this.processedRef(id)])
      return true
    } catch (error) {
      if (!exitCodeIs(error, 1)) throw error
    }
    const ref = await this.historyRef(domain)
    const head = await this.headOid(domain, ref)
    if (!head) return false
    const { stdout } = await this.runGit(dir, [
      'log',
      head,
      '--fixed-strings',
      `--grep=${TRANSACTION_TRAILER} ${id}`,
      '--format=%H',
      '--max-count=1'
    ])
    return stdout.trim().length > 0
  }

  private async publishJournal(domain: string, journal: PendingRevision): Promise<void> {
    const dir = this.domainDir(domain)
    const ref = await this.historyRef(domain)
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      if (await this.transactionResolved(domain, journal.id)) return
      const base = await this.headOid(domain, ref)
      const indexDir = path.join(dir, '.git', 'nodeterm-history-indexes')
      await fs.mkdir(indexDir, { recursive: true, mode: 0o700 })
      const indexPath = path.join(
        indexDir,
        `${process.pid}.${journal.id}.${randomUUID()}.index`
      )
      const env: NodeJS.ProcessEnv = {
        GIT_INDEX_FILE: indexPath,
        GIT_AUTHOR_NAME: 'nodeterm-history',
        GIT_AUTHOR_EMAIL: 'history@nodeterm.local',
        GIT_COMMITTER_NAME: 'nodeterm-history',
        GIT_COMMITTER_EMAIL: 'history@nodeterm.local',
        GIT_AUTHOR_DATE: new Date(journal.createdAt).toISOString(),
        GIT_COMMITTER_DATE: new Date(journal.createdAt).toISOString()
      }
      try {
        if (base) await this.runGit(dir, ['read-tree', base], { env })
        else await this.runGit(dir, ['read-tree', '--empty'], { env })

        const { stdout: blobOut } = await this.runGit(dir, ['hash-object', '-w', '--stdin'], {
          env,
          input: journal.content
        })
        const blob = blobOut.trim()
        if (!validOid(blob)) throw new Error('Git returned an invalid local-history blob id.')
        await this.runGit(
          dir,
          [
            'update-index',
            '--add',
            '--cacheinfo',
            `100644,${blob},${safeFilename(journal.filename)}`
          ],
          { env }
        )
        const { stdout: treeOut } = await this.runGit(dir, ['write-tree'], { env })
        const tree = treeOut.trim()
        if (!validOid(tree)) throw new Error('Git returned an invalid local-history tree id.')

        if (base) {
          const { stdout: baseTreeOut } = await this.runGit(dir, [
            'rev-parse',
            `${base}^{tree}`
          ])
          if (baseTreeOut.trim() === tree) {
            // The caller normally filters no-ops before record(). Two concurrent identical intents
            // can still converge here. A dedicated processed ref resolves that immutable journal
            // without manufacturing an empty user-visible history commit.
            const processed = this.processedRef(journal.id)
            try {
              await this.runGit(dir, ['update-ref', processed, base, '0'.repeat(base.length)])
            } catch (error) {
              const { stdout } = await this.runGit(dir, [
                'rev-parse',
                '--verify',
                '--quiet',
                processed
              ])
              if (!validOid(stdout.trim())) throw error
            }
            return
          }
        }

        const message = `${journal.label}\n\n${ACTION_TRAILER} ${journal.action}\n${TRANSACTION_TRAILER} ${journal.id}\n`
        const commitArgs = ['commit-tree', tree]
        if (base) commitArgs.push('-p', base)
        commitArgs.push('-F', '-')
        const { stdout: commitOut } = await this.runGit(dir, commitArgs, {
          env,
          input: message
        })
        const commit = commitOut.trim()
        if (!validOid(commit)) throw new Error('Git returned an invalid local-history commit id.')
        const expected = base ?? '0'.repeat(commit.length)
        try {
          await this.runGit(dir, ['update-ref', ref, commit, expected])
          return
        } catch (error) {
          // update-ref is the fence. Only a ref movement is a retryable CAS loss; a timeout, a
          // permissions error, or a still-held Git lock fails closed and leaves the journal intact.
          const current = await this.headOid(domain, ref)
          if (current === base) throw error
        }
      } finally {
        // These paths carry this invocation's UUID. Never scan, reset or remove another process's
        // index/index.lock: a suspended writer may still be using it.
        await removeAtomic(indexPath)
        await removeAtomic(`${indexPath}.lock`)
      }
    }
    throw new Error('Local-history publication could not win a bounded compare-and-swap retry.')
  }

  /** Every revision for `domain`, newest first, matching `filters`. `null` (not `[]`) means the
   *  repo could not be read at all. The ref is snapshotted once and every subsequent command names
   *  that immutable OID, so a concurrent publisher yields either the coherent before or after
   *  history, never a HEAD probe from one generation and rows from another. */
  async list(domain: string, filters?: HistoryFilters): Promise<HistoryEntry[] | null> {
    await this.writes.get(this.domainDir(domain))?.catch(() => undefined)
    if (!(await this.ensureRepo(domain))) return null
    const dir = this.domainDir(domain)
    try {
      // A read is also the recovery boundary: complete immutable journals (including a killed or
      // currently-suspended writer's) are safe for any process to publish through the same CAS.
      await this.drainJournals(domain)
      const ref = await this.historyRef(domain)
      const head = await this.headOid(domain, ref)
      if (!head) return applyFilters([], filters)
      const format = `%H${UNIT_SEP}%aI${UNIT_SEP}%s${UNIT_SEP}%b${RECORD_SEP}`
      const { stdout } = await this.runGit(dir, ['log', head, `--format=${format}`])
      const records = stdout.split(RECORD_SEP).filter((record) => record.trim().length > 0)
      const entries: HistoryEntry[] = []
      for (const rec of records) {
        const [sha, aiDate, subject, body] = rec.replace(/^\n+/, '').split(UNIT_SEP)
        if (!sha || !validOid(sha)) throw new Error('History contained an invalid commit id.')
        const actionMatch = (body ?? '').match(/X-History-Action:\s*(\S+)/)
        const action = (actionMatch?.[1] as HistoryAction | undefined) ?? 'updated'
        const timestamp = Date.parse(aiDate ?? '')
        entries.push({
          domain,
          sha,
          timestamp: Number.isFinite(timestamp) ? timestamp : 0,
          label: subject ?? '(no label)',
          action,
          filename: await this.filenameOfCommit(dir, sha)
        })
      }
      return applyFilters(entries, filters)
    } catch (error) {
      console.error(`[local-history] failed to list ${domain}:`, error)
      return null
    }
  }

  private async filenameOfCommit(dir: string, sha: string): Promise<string> {
    const { stdout } = await this.runGit(dir, ['show', '--name-only', '--format=', sha])
    const filename = stdout.split('\n').find((line) => line.trim().length > 0)
    if (!filename) throw new Error(`History commit ${sha} did not name a snapshot file.`)
    return filename
  }

  /** Read one immutable revision after proving it belongs to the snapshotted current history. */
  async restoreContent(domain: string, sha: string, filename: string): Promise<string> {
    await this.writes.get(this.domainDir(domain))?.catch(() => undefined)
    if (!validOid(sha)) throw new Error('The history revision id is invalid.')
    const safe = safeFilename(filename)
    if (!(await this.ensureRepo(domain))) {
      throw new Error(`History for "${domain}" is unavailable.`)
    }
    const dir = this.domainDir(domain)
    await this.drainJournals(domain)
    const ref = await this.historyRef(domain)
    const head = await this.headOid(domain, ref)
    if (!head) throw new Error(`History for "${domain}" is empty.`)
    try {
      await this.runGit(dir, ['merge-base', '--is-ancestor', sha, head])
    } catch (error) {
      if (exitCodeIs(error, 1)) {
        throw new Error('That revision is not part of the current local history.')
      }
      throw error
    }
    const { stdout } = await this.runGit(dir, ['show', `${sha}:${safe}`])
    return stdout
  }
}

function applyFilters(entries: HistoryEntry[], filters?: HistoryFilters): HistoryEntry[] {
  if (!filters) return entries
  return entries.filter((entry) => {
    if (filters.from !== undefined && entry.timestamp < filters.from) return false
    if (filters.to !== undefined && entry.timestamp > filters.to) return false
    if (
      filters.actions &&
      filters.actions.length > 0 &&
      !filters.actions.includes(entry.action)
    ) {
      return false
    }
    return true
  })
}
