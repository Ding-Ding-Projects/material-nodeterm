/**
 * Advanced converter pipelines.
 *
 * This module is deliberately separate from the small synchronous codecs.  A pipeline may
 * produce several files, invoke a verified bundled binary, or need a decoder that reports real
 * metadata before conversion.  It never accepts a shell command.  External tools are selected
 * from the allowlist below and receive an argv array with a scrubbed environment.
 */

import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const ADVANCED_PIPELINE_LIMITS = {
  maxInputBytes: 256 * 1024 * 1024,
  maxOutputBytes: 512 * 1024 * 1024,
  maxArchiveEntries: 10_000,
  maxArchiveExpandedBytes: 512 * 1024 * 1024,
  maxPdfPages: 2_000,
  maxPdfTextBytes: 32 * 1024 * 1024,
  maxImagePixels: 100_000_000,
  maxProcessMs: 10 * 60 * 1000,
  maxProcessOutputBytes: 8 * 1024 * 1024
} as const

export type AdvancedPipelineCategory = 'images' | 'audio' | 'video' | 'archives' | 'documents' | 'ocr' | 'data'

export interface AdvancedPipelineDescriptor {
  id: string
  category: AdvancedPipelineCategory
  label: string
  inputKinds: string[]
  outputKinds: string[]
  bundled: boolean
  available: boolean
  dependency?: string
  unavailableReason?: string
  lossy: boolean
  disclosure: string[]
  limits: Record<string, number>
}

const limits = {
  maxInputBytes: ADVANCED_PIPELINE_LIMITS.maxInputBytes,
  maxOutputBytes: ADVANCED_PIPELINE_LIMITS.maxOutputBytes,
  maxProcessMs: ADVANCED_PIPELINE_LIMITS.maxProcessMs
}

/** Hand-written inventory.  Rows remain visible when unavailable so a missing bundled tool is
 * an honest catalog state rather than a mysteriously absent capability. */
export const ADVANCED_PIPELINE_CATALOG: AdvancedPipelineDescriptor[] = [
  {
    id: 'image-resize-bounded', category: 'images', label: 'Resize image with bounded dimensions',
    inputKinds: ['png', 'jpeg', 'webp', 'gif', 'bmp', 'tiff'], outputKinds: ['png', 'jpeg', 'webp'],
    bundled: true, available: true, dependency: 'sharp', lossy: true,
    disclosure: ['Resizing can discard pixels and animation frames are reduced to the first frame.'], limits
  },
  {
    id: 'image-reencode', category: 'images', label: 'Re-encode image with metadata policy',
    inputKinds: ['png', 'jpeg', 'webp', 'gif', 'bmp', 'tiff'], outputKinds: ['png', 'jpeg', 'webp'],
    bundled: true, available: true, dependency: 'sharp', lossy: true,
    disclosure: ['Metadata is preserved only when the decoder exposes it; colour profiles may be converted.'], limits
  },
  {
    id: 'zip-create-bounded', category: 'archives', label: 'Create ZIP archive with safe relative entries',
    inputKinds: ['file-set'], outputKinds: ['zip'], bundled: true, available: true,
    lossy: false, disclosure: [], limits
  },
  {
    id: 'zip-extract-bounded', category: 'archives', label: 'Extract ZIP archive with traversal checks',
    inputKinds: ['zip'], outputKinds: ['file-set'], bundled: true, available: true,
    dependency: 'unzipper', lossy: false, disclosure: [], limits
  },
  {
    id: 'pdf-inspect', category: 'documents', label: 'Inspect PDF pages and metadata',
    inputKinds: ['pdf'], outputKinds: ['json'], bundled: true, available: true, lossy: false, disclosure: [], limits
  },
  {
    id: 'pdf-extract-text', category: 'documents', label: 'Extract selectable PDF text',
    inputKinds: ['pdf'], outputKinds: ['text'], bundled: true, available: true, lossy: true,
    disclosure: ['Only selectable text objects are extracted; scanned page pixels need OCR.'], limits
  },
  {
    id: 'pdf-split', category: 'documents', label: 'Split PDF pages into validated documents',
    inputKinds: ['pdf'], outputKinds: ['pdf-set'], bundled: false, available: false, dependency: 'qpdf',
    unavailableReason: 'requires the verified bundled qpdf executable; PATH tools are never used', lossy: false, disclosure: [], limits
  },
  {
    id: 'pdf-merge', category: 'documents', label: 'Merge PDF documents with page validation',
    inputKinds: ['pdf-set'], outputKinds: ['pdf'], bundled: false, available: false, dependency: 'qpdf',
    unavailableReason: 'requires the verified bundled qpdf executable; PATH tools are never used', lossy: false, disclosure: [], limits
  },
  {
    id: 'pdf-rotate', category: 'documents', label: 'Rotate PDF pages', inputKinds: ['pdf'], outputKinds: ['pdf'],
    bundled: false, available: false, dependency: 'qpdf',
    unavailableReason: 'requires the verified bundled qpdf executable; PATH tools are never used', lossy: false, disclosure: [], limits
  },
  {
    id: 'pdf-to-images', category: 'documents', label: 'Rasterize PDF pages', inputKinds: ['pdf'], outputKinds: ['image-set'],
    bundled: false, available: false, dependency: 'pdftoppm',
    unavailableReason: 'requires the verified bundled PDF rasterizer; PATH tools are never used', lossy: true,
    disclosure: ['Rasterization discards selectable text and vector structure.'], limits
  },
  {
    id: 'ocr-image-to-text', category: 'ocr', label: 'OCR image or PDF page to text',
    inputKinds: ['png', 'jpeg', 'webp', 'pdf'], outputKinds: ['text'], bundled: false, available: false,
    dependency: 'tesseract', unavailableReason: 'requires a verified bundled OCR engine; network OCR is not supported', lossy: true,
    disclosure: ['OCR is an approximation. Layout, language, tables, and glyphs can be misread.'], limits
  },
  {
    id: 'jsonl-to-json', category: 'data', label: 'JSON Lines to bounded JSON array', inputKinds: ['jsonl'], outputKinds: ['json'],
    bundled: true, available: true, lossy: false, disclosure: [], limits
  },
  {
    id: 'json-to-jsonl', category: 'data', label: 'JSON array to JSON Lines', inputKinds: ['json'], outputKinds: ['jsonl'],
    bundled: true, available: true, lossy: true, disclosure: ['The source must be an array; surrounding object keys are not retained.'], limits
  }
]

export interface AdvancedPipelineRequest {
  id: string
  inputPath: string
  outputDirectory: string
  /** Optional settings are validated per pipeline. Unknown settings are rejected. */
  options?: Record<string, unknown>
  signal?: AbortSignal
}

export interface AdvancedPipelineOutput {
  path: string
  bytes: number
  sha256: string
  metadata?: Record<string, unknown>
}

export interface AdvancedPipelineResult {
  id: string
  outputs: AdvancedPipelineOutput[]
  warnings: string[]
}

export interface AdvancedPipelineProgress {
  stage: 'inspect' | 'read' | 'convert' | 'validate' | 'write' | 'complete'
  completedBytes: number
  totalBytes: number
  message: string
}

export type ProgressListener = (progress: AdvancedPipelineProgress) => void

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Conversion cancelled before the next bounded stage')
}

function validateOptions(id: string, options: Record<string, unknown> = {}): void {
  const allowed: Record<string, readonly string[]> = {
    'image-resize-bounded': ['width', 'height', 'format'],
    'image-reencode': ['format'],
    'zip-create-bounded': ['files', 'entryNames', 'archiveName']
  }
  const keys = allowed[id] ?? []
  for (const key of Object.keys(options)) if (!keys.includes(key)) throw new Error(`Option "${key}" is not supported by pipeline ${id}`)
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function safeOutputPath(root: string, name: string): string {
  if (!name || isAbsolute(name) || name.includes('\\') || name.split('/').some((part) => part === '..')) {
    throw new Error('Pipeline output name must be a non-empty relative path without traversal')
  }
  const candidate = resolve(root, name)
  const rootResolved = resolve(root)
  if (candidate !== rootResolved && !candidate.startsWith(`${rootResolved}${sep}`)) {
    throw new Error('Pipeline output escaped its selected destination')
  }
  return candidate
}

async function readBounded(path: string, maxBytes: number, signal?: AbortSignal, onProgress?: ProgressListener): Promise<Buffer> {
  checkCancelled(signal)
  const linkCheck = await fs.lstat(path)
  if (linkCheck.isSymbolicLink()) throw new Error('Pipeline input cannot be a symbolic link')
  const handle = await fs.open(path, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('Pipeline input must be a regular file')
    if (stat.size > maxBytes) throw new Error(`Input is ${stat.size.toLocaleString()} bytes, over the ${maxBytes.toLocaleString()}-byte bound`)
    const output = Buffer.alloc(stat.size)
    let offset = 0
    const chunk = 1024 * 1024
    while (offset < stat.size) {
      checkCancelled(signal)
      const length = Math.min(chunk, stat.size - offset)
      const result = await handle.read(output, offset, length, offset)
      if (result.bytesRead === 0) throw new Error('Input ended before the declared size was read')
      offset += result.bytesRead
      onProgress?.({ stage: 'read', completedBytes: offset, totalBytes: stat.size, message: 'Reading bounded input' })
    }
    return output
  } finally {
    await handle.close()
  }
}

export function pdfTextFromBuffer(bytes: Buffer): string {
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Input is not a PDF (%PDF- signature missing)')
  const source = bytes.toString('latin1')
  const parts: string[] = []
  for (const match of source.matchAll(/\(([^()]*)\)\s*T[jJ]/g)) {
    parts.push(match[1].replaceAll('\\n', '\n').replaceAll('\\r', '\r').replaceAll('\\(', '(').replaceAll('\\)', ')').replaceAll('\\\\', '\\'))
  }
  for (const match of source.matchAll(/<([0-9a-fA-F\s]+)>\s*T[jJ]/g)) {
    const hex = match[1].replace(/\s+/g, '')
    if (hex.length % 2 === 0) {
      const raw = Buffer.from(hex, 'hex')
      // PDF hex strings are commonly UTF-16BE. Node exposes UTF-16LE only, so swap pairs
      // explicitly rather than decoding with a platform-dependent codec.
      for (let i = 0; i + 1 < raw.length; i += 2) {
        const value = raw[i]
        raw[i] = raw[i + 1]
        raw[i + 1] = value
      }
      parts.push(raw.toString('utf16le'))
    }
  }
  return parts.join('\n').slice(0, ADVANCED_PIPELINE_LIMITS.maxPdfTextBytes)
}

export function pdfInfoFromBuffer(bytes: Buffer): Record<string, unknown> {
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Input is not a PDF (%PDF- signature missing)')
  const source = bytes.toString('latin1')
  const pages = (source.match(/\/Type\s*\/Page(?!s)\b/g) ?? []).length
  if (pages > ADVANCED_PIPELINE_LIMITS.maxPdfPages) throw new Error(`PDF has ${pages.toLocaleString()} pages, over the ${ADVANCED_PIPELINE_LIMITS.maxPdfPages.toLocaleString()}-page bound`)
  const value = (key: string): string | undefined => {
    const match = source.match(new RegExp(`/${key}\\s*\\(([^()]*)\\)`))
    return match?.[1]
  }
  return { format: 'PDF', pages, title: value('Title'), author: value('Author'), selectableTextBytes: Buffer.byteLength(pdfTextFromBuffer(bytes), 'utf8') }
}

function parseJsonLines(input: Buffer): unknown[] {
  const text = input.toString('utf8')
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0)
  if (lines.length > ADVANCED_PIPELINE_LIMITS.maxArchiveEntries) throw new Error('JSON Lines input exceeds the record bound')
  return lines.map((line, index) => {
    try { return JSON.parse(line) } catch (error) { throw new Error(`Invalid JSON Lines record ${index + 1}: ${(error as Error).message}`) }
  })
}

function validateJsonLines(bytes: Buffer): string | null {
  try { parseJsonLines(bytes); return null } catch (error) { return (error as Error).message }
}

function requireSharp(): { (input: Buffer): any } {
  try {
    const require = createRequire(import.meta.url)
    const loaded = require('sharp') as { default?: (input: Buffer) => unknown } | ((input: Buffer) => unknown)
    return (loaded as { default?: (input: Buffer) => any }).default ?? loaded as (input: Buffer) => any
  } catch {
    throw new Error('The bundled sharp image codec is unavailable; install the verified project dependencies before using image pipelines')
  }
}

async function extractZip(
  request: AdvancedPipelineRequest,
  onProgress?: ProgressListener
): Promise<AdvancedPipelineOutput[]> {
  let unzip: { Open: { file(path: string): Promise<any> } }
  try {
    unzip = createRequire(import.meta.url)('unzipper') as typeof unzip
  } catch {
    throw new Error('The bundled unzipper archive reader is unavailable; install the verified project dependencies before extracting')
  }
  const directory = await unzip.Open.file(request.inputPath)
  if (!Array.isArray(directory.files) || directory.files.length > ADVANCED_PIPELINE_LIMITS.maxArchiveEntries) {
    throw new Error(`Archive contains more than ${ADVANCED_PIPELINE_LIMITS.maxArchiveEntries.toLocaleString()} entries`)
  }
  const outputs: AdvancedPipelineOutput[] = []
  let expandedBytes = 0
  for (const entry of directory.files) {
    checkCancelled(request.signal)
    const name = String(entry.path ?? '').replaceAll('\\', '/')
    const parts = name.split('/')
    const directoryEntry = entry.type === 'Directory' || name.endsWith('/')
    const pathParts = directoryEntry ? parts.slice(0, -1) : parts
    if (!name || name.startsWith('/') || name.includes('\0') || pathParts.some((part: string) => part === '..' || part === '')) {
      throw new Error(`Archive entry "${name}" is not a safe relative path`)
    }
    if (directoryEntry) continue
    // Unix mode 0120000 marks symlinks.  Refuse them rather than writing link targets or allowing
    // an archive to smuggle a link into the selected destination.
    const mode = Number(entry.externalFileAttributes ?? 0) >>> 16
    if ((mode & 0xf000) === 0xa000) throw new Error(`Archive entry "${name}" is a symlink and cannot be extracted`)
    const declaredSize = Number(entry.vars?.uncompressedSize ?? 0)
    if (Number.isFinite(declaredSize) && declaredSize > ADVANCED_PIPELINE_LIMITS.maxOutputBytes) throw new Error(`Archive entry "${name}" exceeds the per-file output bound`)
    if (Number.isFinite(declaredSize) && expandedBytes + declaredSize > ADVANCED_PIPELINE_LIMITS.maxArchiveExpandedBytes) throw new Error('Archive expanded bytes exceed the bounded extraction limit')
    const bytes = await entry.buffer()
    expandedBytes += bytes.length
    if (expandedBytes > ADVANCED_PIPELINE_LIMITS.maxArchiveExpandedBytes) throw new Error('Archive expanded bytes exceed the bounded extraction limit')
    const output = await writeOutput(request.outputDirectory, name, bytes, ADVANCED_PIPELINE_LIMITS.maxOutputBytes, request.signal, onProgress)
    outputs.push(output)
    onProgress?.({ stage: 'convert', completedBytes: expandedBytes, totalBytes: ADVANCED_PIPELINE_LIMITS.maxArchiveExpandedBytes, message: `Extracted ${name}` })
  }
  return outputs
}

const CRC_TABLE = (() => {
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Buffer): number {
  let value = 0xffffffff
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function u16(value: number): Buffer { const out = Buffer.alloc(2); out.writeUInt16LE(value & 0xffff); return out }
function u32(value: number): Buffer { const out = Buffer.alloc(4); out.writeUInt32LE(value >>> 0); return out }

async function createZip(request: AdvancedPipelineRequest, onProgress?: ProgressListener): Promise<AdvancedPipelineOutput[]> {
  const options = request.options ?? {}
  const rawFiles = options.files
  if (!Array.isArray(rawFiles) || rawFiles.length === 0 || rawFiles.length > ADVANCED_PIPELINE_LIMITS.maxArchiveEntries || !rawFiles.every((value) => typeof value === 'string')) {
    throw new Error(`ZIP creation requires 1-${ADVANCED_PIPELINE_LIMITS.maxArchiveEntries.toLocaleString()} selected files`)
  }
  const names = Array.isArray(options.entryNames) ? options.entryNames : rawFiles.map((value) => String(value).split(/[\\/]/).pop() ?? '')
  if (names.length !== rawFiles.length || !names.every((value) => typeof value === 'string')) throw new Error('ZIP entry names must match the selected files')
  const seen = new Set<string>()
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  let total = 0
  for (let index = 0; index < rawFiles.length; index++) {
    checkCancelled(request.signal)
    const source = String(rawFiles[index])
    const name = String(names[index]).replaceAll('\\', '/')
    if (!name || name.startsWith('/') || name.includes('\0') || name.split('/').some((part) => part === '..' || part === '')) throw new Error(`ZIP entry "${name}" is not a safe relative path`)
    if (seen.has(name)) throw new Error(`ZIP entry "${name}" is duplicated`)
    seen.add(name)
    const bytes = await readBounded(source, ADVANCED_PIPELINE_LIMITS.maxInputBytes, request.signal, onProgress)
    total += bytes.length
    if (total > ADVANCED_PIPELINE_LIMITS.maxArchiveExpandedBytes) throw new Error('ZIP input bytes exceed the bounded archive limit')
    const compressed = (createRequire(import.meta.url)('node:zlib') as { deflateRawSync(value: Buffer, options: { level: number }): Buffer }).deflateRawSync(bytes, { level: 6 })
    const nameBytes = Buffer.from(name, 'utf8')
    const checksum = crc32(bytes)
    const header = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), u16(20), u16(0), u16(8), u16(0), u16(0), u32(checksum), u32(compressed.length), u32(bytes.length), u16(nameBytes.length), u16(0), nameBytes])
    local.push(header, compressed)
    central.push(Buffer.concat([Buffer.from([0x50, 0x4b, 0x01, 0x02]), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0), u32(checksum), u32(compressed.length), u32(bytes.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes]))
    offset += header.length + compressed.length
  }
  const centralBytes = Buffer.concat(central)
  const archive = Buffer.concat([...local, centralBytes, Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(2), Buffer.alloc(2), u16(rawFiles.length), u16(rawFiles.length), u32(centralBytes.length), u32(offset), Buffer.alloc(2)])
  const name = typeof options.archiveName === 'string' && options.archiveName.trim() ? options.archiveName.trim() : 'archive.zip'
  if (!name.toLowerCase().endsWith('.zip')) throw new Error('ZIP archive name must end in .zip')
  const output = await writeOutput(request.outputDirectory, name, archive, ADVANCED_PIPELINE_LIMITS.maxOutputBytes, request.signal, onProgress)
  output.metadata = { entries: rawFiles.length, uncompressedBytes: total }
  return [output]
}

async function imagePipeline(request: AdvancedPipelineRequest, bytes: Buffer, progress?: ProgressListener): Promise<{ name: string; bytes: Buffer; metadata?: Record<string, unknown>; warnings: string[] }> {
  const sharp = requireSharp()
  const options = request.options ?? {}
  const width = options.width === undefined ? undefined : Number(options.width)
  const height = options.height === undefined ? undefined : Number(options.height)
  if ((width !== undefined && (!Number.isInteger(width) || width < 1 || width > 20_000)) || (height !== undefined && (!Number.isInteger(height) || height < 1 || height > 20_000))) {
    throw new Error('Image width and height must be bounded positive integers')
  }
  const format = options.format === undefined ? 'png' : String(options.format)
  if (!['png', 'jpeg', 'webp'].includes(format)) throw new Error('Image output format must be png, jpeg, or webp')
  const image = sharp(bytes)
  const metadata = await image.metadata()
  if ((metadata.width ?? 0) * (metadata.height ?? 0) > ADVANCED_PIPELINE_LIMITS.maxImagePixels) throw new Error('Image pixel count exceeds the bounded decoder limit')
  checkCancelled(request.signal)
  let pipeline = image
  if (width !== undefined || height !== undefined) pipeline = pipeline.resize(width, height, { fit: 'inside', withoutEnlargement: true })
  if (format === 'jpeg') pipeline = pipeline.jpeg({ quality: 90, progressive: false })
  else if (format === 'webp') pipeline = pipeline.webp({ quality: 90 })
  else pipeline = pipeline.png({ compressionLevel: 6 })
  const output = await pipeline.toBuffer()
  progress?.({ stage: 'convert', completedBytes: output.length, totalBytes: output.length, message: 'Image encoded' })
  return { name: `converted.${format === 'jpeg' ? 'jpg' : format}`, bytes: output, metadata: { width: metadata.width, height: metadata.height, format }, warnings: [] }
}

/** Buffer form used by the ordinary one-output converter queue.  The path-based runner below
 * additionally handles durable multi-output pipelines and is used by the advanced panel. */
export async function convertAdvancedBuffer(
  id: string,
  input: Buffer,
  options: Record<string, unknown> = {},
  signal?: AbortSignal,
  onProgress?: ProgressListener
): Promise<{ output: Buffer; warnings: string[] }> {
  if (id.startsWith('image-')) {
    const result = await imagePipeline({ id, inputPath: '', outputDirectory: '', options, signal }, input, onProgress)
    return { output: result.bytes, warnings: result.warnings }
  }
  if (id === 'pdf-extract-text') return { output: Buffer.from(pdfTextFromBuffer(input), 'utf8'), warnings: [] }
  if (id === 'pdf-inspect') return { output: Buffer.from(JSON.stringify(pdfInfoFromBuffer(input), null, 2) + '\n', 'utf8'), warnings: [] }
  if (id === 'jsonl-to-json') return { output: Buffer.from(JSON.stringify(parseJsonLines(input), null, 2) + '\n', 'utf8'), warnings: [] }
  if (id === 'json-to-jsonl') {
    const parsed: unknown = JSON.parse(input.toString('utf8'))
    if (!Array.isArray(parsed)) throw new Error('JSON Lines output requires a JSON array input')
    if (parsed.length > ADVANCED_PIPELINE_LIMITS.maxArchiveEntries) throw new Error('JSON array exceeds the bounded record limit')
    return { output: Buffer.from(parsed.map((row) => JSON.stringify(row)).join('\n') + (parsed.length ? '\n' : ''), 'utf8'), warnings: [] }
  }
  throw new Error(`Pipeline ${id} does not support a single buffered output`)
}

export interface ToolSpec { id: string; executableName: string; allowedArgs: readonly string[]; sha256?: string }

/** Native tools can only be activated after their binary is bundled and its digest is configured.
 * Empty digests deliberately leave these rows unavailable until a release supplies the real
 * platform binary, rather than letting a developer's PATH accidentally make them appear ready. */
export const VERIFIED_TOOL_SPECS: readonly ToolSpec[] = [
  { id: 'qpdf', executableName: 'qpdf.exe', allowedArgs: ['--split-pages', '--empty', '--pages', '--rotate', '--', '-'] },
  { id: 'pdftoppm', executableName: 'pdftoppm.exe', allowedArgs: ['-png', '-f', '-l', '-r', '-singlefile'] },
  { id: 'tesseract', executableName: 'tesseract.exe', allowedArgs: ['stdout', '--psm', '-l'] },
  { id: 'ffmpeg', executableName: 'ffmpeg.exe', allowedArgs: ['-hide_banner', '-nostdin', '-i', '-map_metadata', '-y', '-vn', '-an'] }
]

/** Execute only an explicitly registered, digest-checked binary from the app's private resources. */
export async function executeVerifiedTool(
  spec: ToolSpec,
  resourcesRoot: string,
  args: readonly string[],
  options: { signal?: AbortSignal; timeoutMs?: number; onProgress?: ProgressListener; allowedPathRoots?: readonly string[] } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) throw new Error('Tool arguments must be plain strings without NUL bytes')
  for (const arg of args) if (arg.startsWith('-') && !spec.allowedArgs.includes(arg)) throw new Error(`Tool argument is not allowlisted for ${spec.id}`)
  if (options.allowedPathRoots) {
    const roots = options.allowedPathRoots.map((rootPath) => `${resolve(rootPath)}${sep}`)
    for (const arg of args) {
      if (arg.startsWith('-') || !isAbsolute(arg)) continue
      const candidate = resolve(arg)
      if (!roots.some((rootPath) => candidate.startsWith(rootPath))) throw new Error(`Tool path argument escaped the permitted pipeline directories for ${spec.id}`)
    }
  }
  const executable = resolve(resourcesRoot, 'converter-tools', spec.executableName)
  const root = resolve(resourcesRoot, 'converter-tools')
  if (!executable.startsWith(`${root}${sep}`)) throw new Error('Tool path escaped the bundled converter-tools directory')
  const stat = await fs.stat(executable).catch(() => null)
  if (!stat?.isFile()) throw new Error(`Verified bundled tool ${spec.id} is not installed`)
  if (!spec.sha256) throw new Error(`Bundled tool ${spec.id} has no release SHA-256 and remains unavailable`)
  const digest = sha256(await fs.readFile(executable))
  if (digest !== spec.sha256) throw new Error(`Bundled tool ${spec.id} failed its SHA-256 verification`)
  checkCancelled(options.signal)
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [...args], {
      cwd: root,
      shell: false,
      windowsHide: true,
      env: { PATH: root, LANG: 'C', LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const started = Date.now()
    const timeout = setTimeout(() => child.kill(), Math.min(options.timeoutMs ?? ADVANCED_PIPELINE_LIMITS.maxProcessMs, ADVANCED_PIPELINE_LIMITS.maxProcessMs))
    const abort = () => child.kill()
    options.signal?.addEventListener('abort', abort, { once: true })
    const collect = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      if ((stdout.length + stderr.length + chunk.length) > ADVANCED_PIPELINE_LIMITS.maxProcessOutputBytes) child.kill()
      else if (target === 'stdout') stdout += chunk.toString('utf8')
      else stderr += chunk.toString('utf8')
      options.onProgress?.({ stage: 'convert', completedBytes: Date.now() - started, totalBytes: options.timeoutMs ?? ADVANCED_PIPELINE_LIMITS.maxProcessMs, message: `Running verified ${spec.id} tool` })
    }
    child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk))
    child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk))
    child.once('error', (error) => finish(error))
    child.once('close', (code) => {
      if (options.signal?.aborted) finish(new Error('Conversion cancelled while the verified tool was running'))
      else if (code !== 0) finish(new Error(`Verified tool ${spec.id} exited with code ${code}: ${stderr.slice(-1000)}`))
      else finish(undefined, { stdout, stderr, exitCode: code ?? 0 })
    })
    function finish(error?: Error, result?: { stdout: string; stderr: string; exitCode: number }) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolvePromise(result!)
    }
  })
}

async function writeOutput(root: string, name: string, bytes: Buffer, maxBytes: number, signal?: AbortSignal, onProgress?: ProgressListener): Promise<AdvancedPipelineOutput> {
  checkCancelled(signal)
  if (bytes.length > maxBytes) throw new Error(`Produced output is ${bytes.length.toLocaleString()} bytes, over the ${maxBytes.toLocaleString()}-byte bound`)
  const path = safeOutputPath(root, name)
  await fs.mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.partial-${process.pid}-${Date.now().toString(36)}`
  await fs.writeFile(temporary, bytes, { flag: 'wx' })
  try {
    checkCancelled(signal)
    // A hard link is the no-clobber atomic publication primitive.  Advanced jobs have no
    // overwrite-confirmation payload yet, so replacing an existing destination is refused rather
    // than silently turning a conversion into a destructive write.
    await fs.link(temporary, path)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {})
    if (typeof error === 'object' && error !== null && 'code' in error && String((error as { code: unknown }).code) === 'EEXIST') {
      throw new Error(`Output already exists and was not overwritten: ${path}`)
    }
    throw error
  }
  await fs.rm(temporary, { force: true }).catch(() => {})
  onProgress?.({ stage: 'write', completedBytes: bytes.length, totalBytes: bytes.length, message: `Wrote ${name}` })
  return { path, bytes: bytes.length, sha256: sha256(bytes) }
}

export async function runAdvancedPipeline(request: AdvancedPipelineRequest, onProgress?: ProgressListener): Promise<AdvancedPipelineResult> {
  const descriptor = ADVANCED_PIPELINE_CATALOG.find((item) => item.id === request.id)
  if (!descriptor) throw new Error(`Unknown advanced converter pipeline: ${request.id}`)
  if (!descriptor.available) throw new Error(descriptor.unavailableReason ?? `Pipeline ${request.id} is unavailable`)
  if ((request.id !== 'zip-create-bounded' && !request.inputPath) || !request.outputDirectory) throw new Error('Pipeline input and output folders are required')
  validateOptions(request.id, request.options)
  const input = request.id === 'zip-create-bounded'
    ? Buffer.alloc(0)
    : await readBounded(request.inputPath, ADVANCED_PIPELINE_LIMITS.maxInputBytes, request.signal, onProgress)
  onProgress?.({ stage: 'inspect', completedBytes: 0, totalBytes: input.length, message: 'Inspecting bounded input' })
  let outputName: string | undefined
  let output: Buffer | undefined
  let metadata: Record<string, unknown> | undefined
  let warnings: string[] = []
  let extracted: AdvancedPipelineOutput[] | undefined
  switch (request.id) {
    case 'zip-extract-bounded':
      extracted = await extractZip(request, onProgress)
      break
    case 'zip-create-bounded':
      extracted = await createZip(request, onProgress)
      break
    case 'image-resize-bounded':
    case 'image-reencode': {
      const result = await imagePipeline(request, input, onProgress)
      outputName = result.name; output = result.bytes; metadata = result.metadata; warnings = result.warnings
      break
    }
    case 'pdf-inspect':
      outputName = 'document.info.json'; output = Buffer.from(JSON.stringify(pdfInfoFromBuffer(input), null, 2) + '\n', 'utf8'); break
    case 'pdf-extract-text':
      outputName = 'document.txt'; output = Buffer.from(pdfTextFromBuffer(input), 'utf8'); break
    case 'jsonl-to-json': {
      const rows = parseJsonLines(input); outputName = 'records.json'; output = Buffer.from(JSON.stringify(rows, null, 2) + '\n', 'utf8'); break
    }
    case 'json-to-jsonl': {
      const parsed: unknown = JSON.parse(input.toString('utf8'))
      if (!Array.isArray(parsed)) throw new Error('JSON Lines output requires a JSON array input')
      if (parsed.length > ADVANCED_PIPELINE_LIMITS.maxArchiveEntries) throw new Error('JSON array exceeds the bounded record limit')
      outputName = 'records.jsonl'; output = Buffer.from(parsed.map((row) => JSON.stringify(row)).join('\n') + (parsed.length ? '\n' : ''), 'utf8'); break
    }
    default:
      throw new Error(`Pipeline ${request.id} has no in-process implementation`)
  }
  if (extracted) {
    onProgress?.({ stage: 'complete', completedBytes: extracted.reduce((sum, item) => sum + item.bytes, 0), totalBytes: extracted.reduce((sum, item) => sum + item.bytes, 0), message: `Extracted ${extracted.length} archive entries` })
    return { id: request.id, outputs: extracted, warnings }
  }
  if (!output || !outputName) throw new Error(`Pipeline ${request.id} produced no single output`)
  checkCancelled(request.signal)
  onProgress?.({ stage: 'validate', completedBytes: output.length, totalBytes: output.length, message: 'Validating produced output' })
  if (request.id === 'pdf-inspect') JSON.parse(output.toString('utf8'))
  if (request.id === 'jsonl-to-json' || request.id === 'json-to-jsonl') {
    const validation = request.id === 'jsonl-to-json' ? (() => { JSON.parse(output.toString('utf8')); return null })() : validateJsonLines(output)
    if (validation) throw new Error(`Produced structured output failed validation: ${validation}`)
  }
  const written = await writeOutput(request.outputDirectory, outputName, output, ADVANCED_PIPELINE_LIMITS.maxOutputBytes, request.signal, onProgress)
  written.metadata = metadata
  onProgress?.({ stage: 'complete', completedBytes: output.length, totalBytes: output.length, message: 'Pipeline complete' })
  return { id: request.id, outputs: [written], warnings }
}

export function validateAdvancedPipelineCatalog(): void {
  const ids = new Set<string>()
  for (const descriptor of ADVANCED_PIPELINE_CATALOG) {
    if (ids.has(descriptor.id)) throw new Error(`Duplicate advanced pipeline id: ${descriptor.id}`)
    ids.add(descriptor.id)
    if (descriptor.available && !descriptor.bundled) throw new Error(`Available advanced pipeline ${descriptor.id} is not marked bundled`)
    if (!descriptor.available && !descriptor.unavailableReason) throw new Error(`Unavailable advanced pipeline ${descriptor.id} needs an exact reason`)
    if (descriptor.lossy && descriptor.disclosure.length === 0) throw new Error(`Lossy advanced pipeline ${descriptor.id} needs a disclosure`)
  }
}
