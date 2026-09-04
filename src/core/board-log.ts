import fs from 'fs'
import path from 'path'
import { createHash, randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'fs'
import { renameAtomicSync } from './fs-atomic'
import { BOARD_LOG_TEXT_MAX, type BoardLogEntry } from '@shared/types'
import { BOARD_LOG_ATTACHMENT_LIMITS, validateBoardLogAttachmentUpload, validBoardLogAttachment, type BoardLogAttachment, type BoardLogAttachmentSession, type BoardLogAttachmentUpload } from '@shared/board-log-attachments'

// Re-exported so callers of this module (and its tests) can reach the cap alongside buildLine.
export { BOARD_LOG_TEXT_MAX }

// Append-only board history. Each project's board log lives beside its nodes at
// `<cwd>/.nodeterm/board-log.jsonl`, one JSON entry per line, oldest-first on disk. Local
// projects use node:fs directly; SSH projects go through an injected RemoteLogExec (the seam
// that keeps this file electron-free — the ssh command builders live in main/ssh-fs.ts). The
// pure line build/parse helpers are exported so the diff/renderer can reason about entries.

const LOG_DIR = '.nodeterm'
const LOG_FILE = 'board-log.jsonl'
const DEFAULT_CAP = 500
const BOARD_LOG_ENTRY_MAX_BYTES = 1 * 1024 * 1024
export const MAX_BOARD_LOG_BYTES = 1 * 1024 * 1024
const BOARD_LOG_EVENT_TYPES = new Set(['card-created', 'card-moved', 'column-added', 'column-renamed', 'column-deleted', 'member-assigned', 'member-unassigned', 'due-set', 'due-cleared', 'priority-set', 'priority-cleared', 'agent-message', 'agent-read-cookies'])

/** Clamp an entry's `text` to `BOARD_LOG_TEXT_MAX` chars (+ '…' when truncated). Returns the
 *  same entry when nothing changes, else a shallow copy with the shortened text. */
export function clampEntryText(entry: BoardLogEntry): BoardLogEntry {
  const { text } = entry
  if (typeof text !== 'string' || text.length <= BOARD_LOG_TEXT_MAX) return entry
  return { ...entry, text: text.slice(0, BOARD_LOG_TEXT_MAX) + '…' }
}
// `all` still needs a finite tail count for the remote path; larger than any realistic log.
const ALL_LINES = 1_000_000_000
const SERIALS = new Map<string, Promise<unknown>>()
const SESSIONS = new Map<string, { expiresAt: number; reservedBytes: number; ids: Set<string>; consuming: boolean }>()
const SESSION_TTL_MS = 10 * 60 * 1000

function serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const prior = SERIALS.get(key) ?? Promise.resolve()
  const next = prior.catch(() => undefined).then(operation)
  SERIALS.set(key, next)
  void next.then(() => { if (SERIALS.get(key) === next) SERIALS.delete(key) }, () => { if (SERIALS.get(key) === next) SERIALS.delete(key) })
  return next
}

export interface ParseOpts {
  cap?: number
  all?: boolean
}

/** Remote (SSH) log I/O, injected so core stays electron-free. `line` has no trailing newline
 *  (the remote `printf '%s\n'` adds it); `tail` returns the last `lines` lines, oldest-first. */
export interface RemoteLogExec {
  append(path: string, line: string): Promise<void>
  tail(path: string, lines: number): Promise<string>
  saveAttachment?(path: string, dataBase64: string, expectedBytes?: number): Promise<void>
  removeAttachment?(path: string): Promise<void>
  readAttachment?(path: string): Promise<string>
}

/** True when `x` is a structurally-valid BoardLogEntry. Tolerant callers use it to skip
 *  corrupt/foreign lines rather than throwing the whole log away. */
export function validEntry(x: unknown): x is BoardLogEntry {
  if (!x || typeof x !== 'object') return false
  const e = x as Record<string, unknown>
  if (typeof e.id !== 'string' || e.id.length === 0 || e.id.length > 128 || typeof e.ts !== 'number' || !Number.isFinite(e.ts) || e.ts < 0) return false
  const a = e.author as Record<string, unknown> | undefined
  if (!a || typeof a !== 'object' || Array.isArray(a) || typeof a.name !== 'string' || a.name.length === 0 || a.name.length > 160 || typeof a.color !== 'string' || a.color.length > 64) return false
  if (e.kind !== 'comment' && e.kind !== 'event') return false
  if (e.nodeId !== undefined && typeof e.nodeId !== 'string') return false
  if (e.text !== undefined && (typeof e.text !== 'string' || e.text.length > BOARD_LOG_TEXT_MAX + 1)) return false
  if (e.attachments !== undefined && (!Array.isArray(e.attachments) || e.attachments.length > BOARD_LOG_ATTACHMENT_LIMITS.maxPerComment)) return false
  if (e.attachmentSessionId !== undefined && (typeof e.attachmentSessionId !== 'string' || !/^[a-f0-9-]{36}$/i.test(e.attachmentSessionId))) return false
  if (e.attachmentIssues !== undefined && typeof e.attachmentIssues !== 'string') return false
  if (e.event !== undefined && (typeof e.event !== 'object' || e.event === null)) return false
  if (e.event !== undefined) {
    const event = e.event as Record<string, unknown>
    if (Array.isArray(event) || typeof event.type !== 'string' || !BOARD_LOG_EVENT_TYPES.has(event.type)) return false
    if (Object.keys(event).some((key) => !['type', 'from', 'to', 'title'].includes(key))) return false
    if (['from', 'to', 'title'].some((key) => event[key] !== undefined && (typeof event[key] !== 'string' || event[key].length > 512))) return false
  }
  if (Buffer.byteLength(JSON.stringify(e), 'utf8') > BOARD_LOG_ENTRY_MAX_BYTES) return false
  return true
}

/** One log line: single-line JSON + '\n'. Any newline in `text` is JSON-escaped, so the line
 *  never breaks the one-entry-per-line invariant. */
export function buildLine(entry: BoardLogEntry): string {
  return JSON.stringify(clampEntryText(entry)) + '\n'
}

/** Parse a raw log blob → entries, NEWEST-FIRST. Tolerant: lines that fail JSON.parse or the
 *  shape check are skipped. Capped at `cap` (default 500) unless `all` is set. */
export function parseLines(raw: string, opts: ParseOpts = {}): BoardLogEntry[] {
  const out: BoardLogEntry[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    let obj: unknown
    try {
      obj = JSON.parse(t)
    } catch {
      continue
    }
    if (validEntry(obj)) {
      const attachments = obj.attachments?.filter(validBoardLogAttachment)
      const invalid = obj.attachments ? obj.attachments.length - (attachments?.length ?? 0) : 0
      out.push(invalid > 0 ? { ...obj, attachments, attachmentIssues: `${invalid} attachment item${invalid === 1 ? '' : 's'} failed integrity validation.` } : obj)
    }
  }
  out.reverse() // disk is oldest-first; callers want newest-first
  if (opts.all) return out
  return out.slice(0, opts.cap ?? DEFAULT_CAP)
}

/** Archive-time parser. Unlike the live display parser, a portable archive cannot silently skip
 * malformed or foreign lines because that would make the exported sidecar differ from what was
 * validated. */
export function parsePortableBoardLog(raw: string, maxLines = 1_000_000): BoardLogEntry[] {
  const out: BoardLogEntry[] = []
  const attachmentIds = new Set<string>()
  const allowed = new Set(['id', 'ts', 'author', 'nodeId', 'kind', 'text', 'event', 'attachments', 'attachmentSessionId'])
  const authorAllowed = new Set(['name', 'color'])
  const lines = raw.split('\n')
  for (const line of lines) {
    if (!line.trim()) continue
    if (out.length >= maxLines) throw new Error('Portable board log exceeds its line limit.')
    let parsed: unknown
    try {
      rejectDuplicateJsonKeys(line)
      parsed = JSON.parse(line)
    } catch (error) {
      if (error instanceof Error && error.message.includes('duplicate JSON key')) throw error
      throw new Error('Portable board log contains malformed JSON.')
    }
    if (!validEntry(parsed)) throw new Error('Portable board log contains an invalid entry.')
    const entry = parsed as unknown as Record<string, unknown>
    if (Object.keys(entry).some((key) => !allowed.has(key))) throw new Error('Portable board log contains an unknown entry key.')
    if (entry.attachments !== undefined && (!Array.isArray(entry.attachments) || !entry.attachments.every(validBoardLogAttachment))) {
      throw new Error('Portable board log contains invalid attachment metadata.')
    }
    for (const attachment of (entry.attachments ?? [])) {
      if (attachmentIds.has(attachment.id)) throw new Error('Portable board log contains duplicate attachment metadata.')
      attachmentIds.add(attachment.id)
    }
    const author = entry.author as Record<string, unknown>
    if (Object.keys(author).some((key) => !authorAllowed.has(key))) throw new Error('Portable board log contains an unknown author key.')
    out.push(parsed)
  }
  return out
}

function posixJoin(cwd: string, ...parts: string[]): string {
  return [cwd.replace(/\/+$/, ''), ...parts].join('/')
}

function validAppendEntry(entry: BoardLogEntry): boolean {
  return validEntry(entry) && Number.isFinite(entry.ts) &&
    (entry.attachments === undefined || entry.attachments.every(validBoardLogAttachment)) &&
    (entry.attachments === undefined || entry.attachmentSessionId !== undefined)
}

function ensureSafeAttachmentDirectory(cwd: string): string {
  const root = path.resolve(cwd)
  const parsed = path.parse(root)
  let outer = parsed.root
  for (const segment of root.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    outer = path.join(outer, segment)
    const stat = fs.lstatSync(outer)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Attachment path has an unsafe outer ancestor.')
  }
  const dot = path.join(root, LOG_DIR)
  const dir = path.join(dot, 'board-attachments')
  for (const candidate of [root, dot, dir]) {
    const stat = fs.existsSync(candidate) ? fs.lstatSync(candidate) : undefined
    if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) throw new Error('Attachment directory contains a link or non-directory ancestor.')
  }
  fs.mkdirSync(dir, { recursive: true })
  for (const candidate of [root, dot, dir]) {
    const stat = fs.lstatSync(candidate)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Attachment directory changed to an unsafe ancestor.')
  }
  return dir
}

function assertSafeAttachmentAncestors(cwd: string): void {
  const resolved = path.resolve(cwd)
  const parsed = path.parse(resolved)
  let current = parsed.root
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    const stat = fs.lstatSync(current)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Attachment path has an unsafe outer ancestor.')
  }
  for (const candidate of [path.join(resolved, LOG_DIR), path.join(resolved, LOG_DIR, 'board-attachments')]) {
    const stat = fs.lstatSync(candidate)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Attachment path has an unsafe ancestor.')
  }
}

/** The remote (POSIX) path of a project's board log under `cwd`. Exported so the desktop SSH
 *  change-poll can fingerprint the same file the store's RemoteLogExec reads/writes. */
export function boardLogRemotePath(cwd: string): string {
  return posixJoin(cwd, LOG_DIR, LOG_FILE)
}

export class BoardLogStore {
  private remote?: RemoteLogExec
  constructor(opts: { remote?: RemoteLogExec }) {
    this.remote = opts.remote
  }

  private localPath(cwd: string): string {
    return path.join(cwd, LOG_DIR, LOG_FILE)
  }
  private remotePath(cwd: string): string {
    return boardLogRemotePath(cwd)
  }

  /** Append one entry. Fire-and-forget-safe: never throws — returns false on any fs/exec error. */
  async append(cwd: string, entry: BoardLogEntry): Promise<boolean> {
    return serialized(`board-log:${cwd}`, () => this.appendUnsafe(cwd, entry))
  }

  private async appendUnsafe(cwd: string, entry: BoardLogEntry): Promise<boolean> {
    if (!validAppendEntry(entry) || (entry.attachments && (entry.attachments.length > BOARD_LOG_ATTACHMENT_LIMITS.maxPerComment || entry.attachments.reduce((total, attachment) => total + attachment.bytes, 0) > BOARD_LOG_ATTACHMENT_LIMITS.maxTotalBytes))) return false
    let line: string
    try { line = buildLine(entry) } catch { return false }
    if (Buffer.byteLength(line, 'utf8') > BOARD_LOG_ENTRY_MAX_BYTES) return false
    const sessionKey = entry.attachmentSessionId ? `${cwd}:${entry.attachmentSessionId}` : undefined
    const session = entry.attachments ? (sessionKey ? SESSIONS.get(sessionKey) : undefined) : undefined
    if (entry.attachments && (!session || session.consuming || session.expiresAt <= Date.now() || entry.attachments.some((attachment) => !session.ids.has(attachment.id)))) return false
    if (session) session.consuming = true
    if (this.remote) {
      try {
        await this.remote.append(this.remotePath(cwd), line.replace(/\n$/, ''))
        if (sessionKey) SESSIONS.delete(sessionKey)
        return true
      } catch {
        if (session) session.consuming = false
        return false
      }
    }
    try {
      fs.mkdirSync(path.join(cwd, LOG_DIR), { recursive: true })
      this.rotateIfLarge(this.localPath(cwd), Buffer.byteLength(line, 'utf8'))
      fs.appendFileSync(this.localPath(cwd), line)
      if (sessionKey) SESSIONS.delete(sessionKey)
      return true
    } catch {
      if (session) session.consuming = false
      return false
    }
  }

  private rotateIfLarge(file: string, incoming: number): void {
    try {
      if (fs.statSync(file).size + incoming <= MAX_BOARD_LOG_BYTES) return
      // The previous rotated generation is intentionally replaced. Remove it first so the
      // Windows rename does not fail merely because the destination already exists; the shared
      // retry helper still handles a transient scanner/indexer lock on the source or destination.
      const rotated = `${file}.1`
      fs.rmSync(rotated, { force: true })
      renameAtomicSync(file, rotated)
    } catch {
      // Missing or temporarily unavailable logs remain appendable, and the append reports its
      // actual result rather than turning a best-effort rotation into a false success.
    }
  }

  /** Persist one attachment beside the board log. The returned reference is always project-relative. */
  async saveAttachment(cwd: string, upload: BoardLogAttachmentUpload): Promise<BoardLogAttachment | null> {
    return serialized(`board-log:${cwd}`, () => this.saveAttachmentUnsafe(cwd, upload))
  }

  private async saveAttachmentUnsafe(cwd: string, upload: BoardLogAttachmentUpload): Promise<BoardLogAttachment | null> {
    try {
      const sessionKey = `${cwd}:${upload?.sessionId}`
      const session = SESSIONS.get(sessionKey)
      if (!session || session.consuming || session.expiresAt <= Date.now()) { SESSIONS.delete(sessionKey); return null }
      const encoded = upload?.dataBase64
      const maxEncoded = Math.ceil(BOARD_LOG_ATTACHMENT_LIMITS.maxBytes * 4 / 3) + 4
      if (typeof encoded !== 'string' || encoded.length > maxEncoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null
      const data = Buffer.from(encoded, 'base64')
      if (data.length === 0 || data.length > BOARD_LOG_ATTACHMENT_LIMITS.maxBytes || data.toString('base64') !== encoded) return null
      const { name, kind } = validateBoardLogAttachmentUpload(upload, data)
      if (session.reservedBytes + data.length > BOARD_LOG_ATTACHMENT_LIMITS.maxTotalBytes) return null
      const id = randomUUID()
      const ref = `.nodeterm/board-attachments/${id}.bin`
      const digest = createHash('sha256').update(data).digest('hex')
      if (this.remote) {
        if (!this.remote.saveAttachment) return null
        await this.remote.saveAttachment(posixJoin(cwd, LOG_DIR, 'board-attachments', `${id}.bin`), data.toString('base64'), data.length)
      } else {
        const dir = ensureSafeAttachmentDirectory(cwd)
        const target = path.join(dir, `${id}.bin`)
        // POSIX can enforce no-follow on the final component. Windows has no portable equivalent,
        // so lstat-before/after checks remain the explicit residual parent-swap race boundary.
        const noFollow = typeof fs.constants.O_NOFOLLOW === 'number'
        const handle = await fs.promises.open(target, noFollow ? (fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW) : 'wx', 0o600)
        try {
          await handle.writeFile(data)
          const stat = await handle.stat()
          if (!stat.isFile() || stat.size !== data.length) throw new Error('attachment handle verification failed')
        } finally { await handle.close() }
      }
      session.reservedBytes += data.length
      session.ids.add(id)
      return { id, ref, displayName: name, kind, ...(upload.mimeType ? { mimeType: upload.mimeType.slice(0, 128) } : {}), bytes: data.length, sha256: digest }
    } catch {
      return null
    }
  }

  /** Roll back newly uploaded blobs only when no durable log entry references them. */
  async createAttachmentSession(cwd: string): Promise<BoardLogAttachmentSession> {
    return serialized(`board-log:${cwd}`, async () => {
      const id = randomUUID()
      const expiresAt = Date.now() + SESSION_TTL_MS
      SESSIONS.set(`${cwd}:${id}`, { expiresAt, reservedBytes: 0, ids: new Set(), consuming: false })
      setTimeout(() => void this.reapExpiredSession(cwd, id), SESSION_TTL_MS + 1000).unref?.()
      return { id, expiresAt }
    })
  }

  private async reapExpiredSession(cwd: string, sessionId: string): Promise<void> {
    await serialized(`board-log:${cwd}`, async () => {
      const session = SESSIONS.get(`${cwd}:${sessionId}`)
      if (!session || session.expiresAt > Date.now()) return
      const raw = this.remote ? await this.remote.tail(this.remotePath(cwd), ALL_LINES).catch(() => null) : await fs.promises.readFile(this.localPath(cwd), 'utf8').catch((error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? '' : null)
      if (raw === null) return
      const used = new Set(parseLines(raw, { all: true }).flatMap((entry) => (entry.attachments ?? []).map((attachment) => attachment.id)))
      for (const id of session.ids) {
        if (used.has(id)) continue
        const target = this.remote ? posixJoin(cwd, LOG_DIR, 'board-attachments', `${id}.bin`) : path.join(cwd, LOG_DIR, 'board-attachments', `${id}.bin`)
        try { if (this.remote) await this.remote.removeAttachment?.(target); else await fs.promises.rm(target, { force: true }) } catch { /* leave evidence for manual recovery */ }
      }
      SESSIONS.delete(`${cwd}:${sessionId}`)
    })
  }

  async removeAttachments(cwd: string, sessionId: string, ids: string[]): Promise<boolean> {
    return serialized(`board-log:${cwd}`, () => this.removeAttachmentsUnsafe(cwd, sessionId, ids))
  }

  private async removeAttachmentsUnsafe(cwd: string, sessionId: string, ids: string[]): Promise<boolean> {
    if (ids.length > BOARD_LOG_ATTACHMENT_LIMITS.maxPerComment || ids.some((id) => !/^[a-f0-9-]{36}$/i.test(id))) return false
    if (this.remote && !this.remote.removeAttachment) return false
    try {
      const session = SESSIONS.get(`${cwd}:${sessionId}`)
      if (!session || session.consuming || session.expiresAt <= Date.now() || ids.some((id) => !session.ids.has(id))) return false
      const entries = this.remote
        ? parseLines(await this.remote.tail(this.remotePath(cwd), ALL_LINES), { all: true })
        : parseLines(await fs.promises.readFile(this.localPath(cwd), 'utf8').catch((error: unknown) => { if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return ''; throw error }), { all: true })
      const used = new Set(entries.flatMap((entry) => (entry.attachments ?? []).map((attachment) => attachment.id)))
      for (const id of ids) {
        if (used.has(id)) continue
        const target = this.remote ? posixJoin(cwd, LOG_DIR, 'board-attachments', `${id}.bin`) : path.join(cwd, LOG_DIR, 'board-attachments', `${id}.bin`)
        if (this.remote?.removeAttachment) await this.remote.removeAttachment(target)
        else if (!this.remote) await fs.promises.rm(target, { force: true })
        session.ids.delete(id)
      }
      if (session.ids.size === 0) SESSIONS.delete(`${cwd}:${sessionId}`)
      return true
    } catch { return false }
  }

  async readAttachment(cwd: string, attachment: BoardLogAttachment): Promise<{ ok: true; dataBase64: string } | { ok: false; error: string }> {
    if (!validBoardLogAttachment(attachment)) return { ok: false, error: 'Attachment metadata is invalid.' }
    try {
      const rawWrapped = this.remote
        ? this.remote.readAttachment ? await this.remote.readAttachment(posixJoin(cwd, LOG_DIR, 'board-attachments', `${attachment.id}.bin`)) : ''
        : await (async () => {
            assertSafeAttachmentAncestors(cwd)
            const target = path.join(cwd, LOG_DIR, 'board-attachments', `${attachment.id}.bin`)
            const stat = await fs.promises.lstat(target)
            if (stat.isSymbolicLink() || !stat.isFile() || stat.size > BOARD_LOG_ATTACHMENT_LIMITS.maxBytes) throw new Error('unsafe attachment')
            const noFollow = typeof fs.constants.O_NOFOLLOW === 'number'
            const handle = await fs.promises.open(target, noFollow ? fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW : 'r')
            try {
              const opened = await handle.stat()
              if (!opened.isFile() || opened.size !== stat.size || opened.size > BOARD_LOG_ATTACHMENT_LIMITS.maxBytes) throw new Error('attachment identity changed')
              const data = await handle.readFile()
              const final = await handle.stat()
              if (final.size !== opened.size) throw new Error('attachment changed while reading')
              return data.toString('base64')
            } finally { await handle.close() }
          })()
      const raw = rawWrapped.replace(/\s+/g, '')
      if (!raw || raw.length > Math.ceil(BOARD_LOG_ATTACHMENT_LIMITS.maxBytes * 4 / 3) + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length % 4 !== 0) return { ok: false, error: 'Attachment is missing or unreadable.' }
      const data = Buffer.from(raw, 'base64')
      if (data.length !== attachment.bytes || data.toString('base64') !== raw || createHash('sha256').update(data).digest('hex') !== attachment.sha256) return { ok: false, error: 'Attachment failed its integrity check.' }
      return { ok: true, dataBase64: raw }
    } catch { return { ok: false, error: 'Attachment could not be read.' }
    }
  }

  /** Read the log, newest-first (see parseLines). Missing file / failed read → []. */
  async read(cwd: string, opts: ParseOpts = {}): Promise<BoardLogEntry[]> {
    return (await this.readDetailed(cwd, opts)).entries
  }

  async readDetailed(cwd: string, opts: ParseOpts = {}): Promise<{ entries: BoardLogEntry[]; failed: boolean }> {
    if (this.remote) {
      try {
        const raw = await this.remote.tail(this.remotePath(cwd), opts.all ? ALL_LINES : opts.cap ?? DEFAULT_CAP)
        return { entries: parseLines(raw, opts), failed: false }
      } catch {
        return { entries: [], failed: true }
      }
    }
    let raw: string
    try {
      raw = await fs.promises.readFile(this.localPath(cwd), 'utf-8')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { entries: [], failed: false }
      return { entries: [], failed: true }
    }
    let rotated = ''
    try { rotated = await fs.promises.readFile(`${this.localPath(cwd)}.1`, 'utf-8') } catch { /* absent */ }
    // Parse generations independently. Concatenating raw bytes makes a malformed old tail (or a
    // file without its final newline) consume the first record in the fresh generation. The
    // current generation is always newer, so combine newest-first arrays and apply one read cap.
    const entries = [...parseLines(raw, { all: true }), ...parseLines(rotated, { all: true })]
    return { entries: opts.all ? entries : entries.slice(0, opts.cap ?? DEFAULT_CAP), failed: false }
  }

  async readRaw(cwd: string): Promise<{ state: BoardLogReadState; data?: string; error?: string }> {
    let raw: string
    try {
      if (this.remote) {
        raw = await this.remote.tail(this.remotePath(cwd), ALL_LINES)
      } else {
        raw = await fs.promises.readFile(this.localPath(cwd), 'utf-8')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { state: 'absent' }
      return { state: 'unreadable', error: error instanceof Error ? error.message : String(error) }
    }
    if (raw.length === 0) return { state: 'empty', data: '' }
    try { parsePortableBoardLog(raw); return { state: 'ok', data: Buffer.from(raw, 'utf8').toString('base64') } }
    catch (error) { return { state: 'malformed', error: error instanceof Error ? error.message : String(error) } }
  }

  async readAttachment(cwd: string, attachment: BoardLogAttachment): Promise<{ ok: true; dataBase64: string } | { ok: false; error: string }> {
    if (!validBoardLogAttachment(attachment)) return { ok: false, error: 'Attachment metadata is invalid.' }
    const targetPath = path.join(cwd, LOG_DIR, 'board-attachments', attachment.id + '.bin')
    let target = ''
    if (this.remote) {
      target = this.remote.readAttachment ? await this.remote.readAttachment(this.remotePath(cwd).replace(/board-log\.jsonl$/, 'board-attachments/' + attachment.id + '.bin')) : ''
    } else {
      try {
        const before = await fs.promises.lstat(targetPath)
        if (!before.isFile() || before.isSymbolicLink()) return { ok: false, error: 'Attachment body is not a regular file.' }
        const data = await fs.promises.readFile(targetPath)
        const after = await fs.promises.lstat(targetPath)
        if (before.ino !== after.ino || before.size !== after.size) return { ok: false, error: 'Attachment changed while it was being read.' }
        target = data.toString('base64')
      } catch {
        return { ok: false, error: 'Attachment body is unavailable.' }
      }
    }
    if (!target) return { ok: false, error: 'Attachment body is unavailable.' }
    const data = Buffer.from(target, 'base64')
    if (data.toString('base64').replace(/=+$/, '') !== target.replace(/=+$/, '') ||
        data.byteLength !== attachment.bytes || createHash('sha256').update(data).digest('hex') !== attachment.sha256) {
      return { ok: false, error: 'Attachment body failed its length or SHA-256 check.' }
    }
    return { ok: true, dataBase64: target }
  }

  /** Watch the log for changes; `cb` fires (debounced 250ms) on each change. Returns an unsub.
   *  Watches the `.nodeterm` dir (tolerant of the log file not existing yet); remote → no-op. */
  watch(cwd: string, cb: () => void): () => void {
    if (this.remote) return () => {}
    const dir = path.join(cwd, LOG_DIR)
    let timer: ReturnType<typeof setTimeout> | undefined
    let watcher: FSWatcher
    try {
      watcher = watch(dir, (_event, filename) => {
        if (filename && filename !== LOG_FILE) return
        clearTimeout(timer)
        timer = setTimeout(cb, 250)
      })
      watcher.on('error', () => {})
    } catch {
      return () => {}
    }
    return () => {
      clearTimeout(timer)
      watcher.close()
    }
  }
}
