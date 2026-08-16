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
//      hands it — the settings-store wiring in src/main/index.ts is what keeps that promise for
//      the 'settings' domain (Settings never carries raw credentials; see ClaudeAccount's doc
//      comment in shared/types.ts). Any FUTURE domain added here must keep the same discipline.

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { HistoryAction, HistoryEntry, HistoryFilters } from '../shared/local-history'

export type { HistoryAction, HistoryEntry, HistoryFilters } from '../shared/local-history'

const execFileP = promisify(execFile)

const UNIT_SEP = '\x1f'
const RECORD_SEP = '\x1e'
const ACTION_TRAILER = 'X-History-Action:'

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileP('git', args, { cwd, encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024, windowsHide: true })
}

export type LocalHistoryGit = typeof git

function exitCodeIs(error: unknown, code: number): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

export class LocalHistoryStore {
  private ready = new Map<string, Promise<boolean>>()
  /**
   * A git index is one shared mutable decision per repository. Unique working-file bytes do not
   * help if record A writes content A, record B stages it, and then A commits with label A after
   * B changed the index. Keep the complete write/add/commit transaction FIFO per domain. Domains
   * remain independent, so a slow settings commit cannot stall a future unrelated history store.
   */
  private writes = new Map<string, Promise<void>>()

  constructor(
    private readonly userDataDir: string,
    private readonly runGit: LocalHistoryGit = git
  ) {}

  private domainDir(domain: string): string {
    // `domain` is always an internal literal ('settings' today) chosen by this codebase, never
    // renderer-supplied free text used as a path — but sanitize anyway so a future caller can't
    // accidentally turn a bad domain name into a path-traversal write.
    const safe = domain.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default'
    return path.join(this.userDataDir, 'local-history', safe)
  }

  /** Ensure the domain's repo exists and is usable. Cached per domain per process so a burst of
   *  saves does not race `git init`. Resolves `false` (never rejects) when git itself is
   *  unavailable — every public method below degrades gracefully from that. */
  private async ensureRepo(domain: string): Promise<boolean> {
    // Key by the resolved directory, not the unsanitized label: two future domain strings that
    // sanitize to the same leaf must never initialize or mutate one repository concurrently.
    const key = this.domainDir(domain)
    const cached = this.ready.get(key)
    if (cached) return cached
    const promise = (async () => {
      const dir = key
      try {
        await fs.mkdir(dir, { recursive: true, mode: 0o700 })
        const gitDir = path.join(dir, '.git')
        const exists = await fs
          .stat(gitDir)
          .then((s) => s.isDirectory())
          .catch(() => false)
        if (!exists) {
          await this.runGit(dir, ['init', '--quiet'])
        }
        // Local to THIS repo only — never touches the user's global git config, and a commit
        // author identity is required for `git commit` to succeed at all.
        await this.runGit(dir, ['config', 'user.name', 'nodeterm-history'])
        await this.runGit(dir, ['config', 'user.email', 'history@nodeterm.local'])
        return true
      } catch (e) {
        console.error(`[local-history] could not prepare the "${domain}" repo:`, e)
        return false
      }
    })()
    this.ready.set(key, promise)
    return promise
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
    // Publish the tail before the first await. Two record() calls in one JavaScript turn therefore
    // cannot both observe an empty lane, and list()/restoreContent() can use the same tail as a
    // read-after-write barrier.
    const run = previous.catch(() => {}).then(() => this.recordNow(opts))
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
    try {
      if (!(await this.ensureRepo(opts.domain))) return
      const dir = this.domainDir(opts.domain)
      const filePath = path.join(dir, opts.filename)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, opts.content, { encoding: 'utf-8', mode: 0o600 })
      await this.runGit(dir, ['add', '--', opts.filename])
      // Nothing to commit (identical content saved twice in a row) is a normal outcome, not a
      // failure — `git commit` exits non-zero for it, so it is swallowed by the outer try/catch
      // along with genuine errors. Either way the rule holds: an unchanged state records nothing.
      const subject = opts.label
      const body = `${ACTION_TRAILER} ${opts.action}`
      await this.runGit(dir, ['commit', '--quiet', '-m', subject, '-m', body])
    } catch (e) {
      // Rule 1: a history write failing must never fail the caller's real operation.
      console.error(`[local-history] failed to record "${opts.label}" for ${opts.domain}:`, e)
    }
  }

  /** Every revision for `domain`, newest first, matching `filters`. `null` (not `[]`) means the
   *  repo could not be read at all — distinguished from "the domain genuinely has no history yet"
   *  the same way every other "we could not look" surface in this app is (see
   *  SessionMemoryPanel's `ok`/`rows` contract). */
  async list(domain: string, filters?: HistoryFilters): Promise<HistoryEntry[] | null> {
    // A settings save deliberately does not wait for background history I/O. The panel does need
    // read-your-own-write semantics, especially immediately after a restore, so join the write
    // tail that existed when this read began before asking git for HEAD.
    await this.writes.get(this.domainDir(domain))?.catch(() => {})
    if (!(await this.ensureRepo(domain))) return null
    const dir = this.domainDir(domain)
    try {
      try {
        await this.runGit(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'])
      } catch (e) {
        // `git log` exits 128 in a freshly initialized repository. That is a successful empty
        // history, not a read failure; --quiet rev-parse gives it the stable exit-code-only shape.
        if (exitCodeIs(e, 1)) return applyFilters([], filters)
        throw e
      }
      const format = `%H${UNIT_SEP}%aI${UNIT_SEP}%s${UNIT_SEP}%b${RECORD_SEP}`
      const { stdout } = await this.runGit(dir, ['log', `--format=${format}`])
      const records = stdout.split(RECORD_SEP).filter((r) => r.trim().length > 0)
      const entries: HistoryEntry[] = []
      for (const rec of records) {
        const [sha, aiDate, subject, body] = rec.replace(/^\n+/, '').split(UNIT_SEP)
        if (!sha) continue
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
    } catch (e) {
      console.error(`[local-history] failed to list ${domain}:`, e)
      return null
    }
  }

  private async filenameOfCommit(dir: string, sha: string): Promise<string> {
    try {
      const { stdout } = await this.runGit(dir, ['show', '--name-only', '--format=', sha])
      return stdout.split('\n').find((l) => l.trim().length > 0) ?? ''
    } catch {
      return ''
    }
  }

  /** The exact file content as it stood at `sha`. Throws (does not swallow) — this is a read the
   *  caller is actively waiting on to apply a restore, so a failure here needs to reach the user,
   *  not vanish the way a background `record()` failure does. */
  async restoreContent(domain: string, sha: string, filename: string): Promise<string> {
    await this.writes.get(this.domainDir(domain))?.catch(() => {})
    if (!(await this.ensureRepo(domain))) throw new Error(`History for "${domain}" is unavailable.`)
    const dir = this.domainDir(domain)
    const { stdout } = await this.runGit(dir, ['show', `${sha}:${filename}`])
    return stdout
  }
}

function applyFilters(entries: HistoryEntry[], filters?: HistoryFilters): HistoryEntry[] {
  if (!filters) return entries
  return entries.filter((e) => {
    if (filters.from !== undefined && e.timestamp < filters.from) return false
    if (filters.to !== undefined && e.timestamp > filters.to) return false
    if (filters.actions && filters.actions.length > 0 && !filters.actions.includes(e.action)) return false
    return true
  })
}
