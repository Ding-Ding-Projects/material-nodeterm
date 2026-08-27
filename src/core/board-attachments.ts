import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { renameAtomic } from './fs-atomic'
import {
  BOARD_ATTACHMENT_LIMITS,
  boardAttachmentArchivePath,
  boardAttachmentDisplayName,
  boardAttachmentReference,
  detectBoardAttachmentKind,
  type BoardAttachmentDraft,
  type BoardAttachmentRef
} from '../shared/comment-attachments'

// Keep the byte-derived detector available to portable import callers through the core attachment boundary.
export { detectBoardAttachmentKind }

export const BOARD_ATTACHMENTS_DIR = '.nodeterm/board-attachments'

export interface BoardAttachmentMaterialized {
  ref: BoardAttachmentRef
  data: Uint8Array
  storedPath: string
}

export interface BoardAttachmentSource {
  ref: BoardAttachmentRef
  data: Uint8Array
}

/** Remote implementations carry base64 only at this already-authenticated host boundary. */
export interface RemoteBoardAttachmentStore {
  write(path: string, dataBase64: string): Promise<boolean>
  read(path: string): Promise<string | null>
  remove(path: string): Promise<boolean>
}

function digest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function safeStoredPath(root: string, ref: BoardAttachmentRef): string {
  return path.join(root, BOARD_ATTACHMENTS_DIR, `${ref.id}.bin`)
}

export async function assertNoSymlinkAncestor(target: string): Promise<void> {
  const resolved = path.resolve(target)
  const parsed = path.parse(resolved)
  let current = parsed.root
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    const stat = await fs.lstat(current).catch(() => null)
    if (stat?.isSymbolicLink()) throw new Error('Attachment path contains a symlink or reparse point.')
  }
}

async function readBounded(sourcePath: string): Promise<Uint8Array> {
  await assertNoSymlinkAncestor(sourcePath)
  const stat = await fs.stat(sourcePath)
  if (!stat.isFile()) throw new Error('Attachment source is not a regular file.')
  if (stat.size <= 0) throw new Error('Attachment source is empty.')
  if (stat.size > BOARD_ATTACHMENT_LIMITS.maxBytes) throw new Error(`Attachment exceeds ${BOARD_ATTACHMENT_LIMITS.maxBytes} bytes.`)
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const raw of createReadStream(sourcePath)) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array)
    bytes += chunk.length
    if (bytes > BOARD_ATTACHMENT_LIMITS.maxBytes) throw new Error(`Attachment exceeds ${BOARD_ATTACHMENT_LIMITS.maxBytes} bytes.`)
    chunks.push(chunk)
  }
  if (bytes === 0) throw new Error('Attachment source is empty.')
  return Buffer.concat(chunks, bytes)
}

/** Read and classify a draft without writing it, for a remote project transaction. */
export async function readBoardAttachmentSource(draft: BoardAttachmentDraft): Promise<BoardAttachmentSource> {
  if (!draft || typeof draft.sourcePath !== 'string' || draft.sourcePath.length === 0) throw new Error('Attachment source is unavailable.')
  const data = await readBounded(draft.sourcePath)
  return { ref: makeRef(draft.name, data), data }
}

/** Decode a bounded carrier returned by a remote host without allocating before its length check. */
export function decodeBoardAttachmentBase64(encoded: string): Uint8Array {
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > 8 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error('Attachment carrier encoding is invalid or too large.')
  }
  const data = Buffer.from(encoded, 'base64')
  if (data.length === 0 || data.length > BOARD_ATTACHMENT_LIMITS.maxBytes || Buffer.from(data).toString('base64') !== encoded) throw new Error('Attachment carrier bytes are invalid or too large.')
  return data
}

async function ensureAttachmentDirectory(root: string): Promise<string> {
  const directory = path.join(root, BOARD_ATTACHMENTS_DIR)
  await assertNoSymlinkAncestor(root)
  await fs.mkdir(directory, { recursive: true })
  await assertNoSymlinkAncestor(directory)
  return directory
}

function makeRef(name: string, data: Uint8Array): BoardAttachmentRef {
  const sha256 = digest(data)
  const id = `${sha256}-${randomUUID().replaceAll('-', '')}`
  const detected = detectBoardAttachmentKind(data)
  const ref: BoardAttachmentRef = {
    id,
    name: boardAttachmentDisplayName(name),
    kind: detected.kind,
    mime: detected.mime,
    bytes: data.byteLength,
    sha256,
    reference: boardAttachmentReference(id),
    archivePath: boardAttachmentArchivePath(id)
  }
  return ref
}

/** Read, classify, hash, and write one source beneath the project's private attachment directory. */
export async function materializeBoardAttachment(root: string, draft: BoardAttachmentDraft): Promise<BoardAttachmentMaterialized> {
  const { ref, data } = await readBoardAttachmentSource(draft)
  const directory = await ensureAttachmentDirectory(root)
  const storedPath = safeStoredPath(root, ref)
  const temporary = path.join(directory, `.incoming-${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporary, data, { flag: 'wx' })
    await renameAtomic(temporary, storedPath)
    return { ref, data, storedPath }
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

/** Validate a carrier after restart or before archive import, independently of its filename. */
export async function readBoardAttachment(root: string, ref: BoardAttachmentRef): Promise<Uint8Array> {
  const storedPath = safeStoredPath(root, ref)
  await assertNoSymlinkAncestor(storedPath)
  const data = await readBounded(storedPath)
  const detected = detectBoardAttachmentKind(data)
  if (data.byteLength !== ref.bytes || digest(data) !== ref.sha256 || detected.kind !== ref.kind || detected.mime !== ref.mime) {
    throw new Error(`Attachment integrity validation failed for ${ref.name}.`)
  }
  return data
}

export async function removeBoardAttachment(root: string, ref: BoardAttachmentRef): Promise<void> {
  const storedPath = safeStoredPath(root, ref)
  await assertNoSymlinkAncestor(path.dirname(storedPath))
  await fs.rm(storedPath, { force: true })
}

/** Portable remote helper: the remote path is fixed by the project root and ref id. */
export function remoteBoardAttachmentPath(projectRoot: string, ref: BoardAttachmentRef): string {
  return `${projectRoot.replace(/\/+$/, '')}/${BOARD_ATTACHMENTS_DIR}/${ref.id}.bin`
}
