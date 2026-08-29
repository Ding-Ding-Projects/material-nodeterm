/**
 * Advanced media pipeline contracts.
 *
 * The express converter deliberately keeps one-input/one-output adapters. This contract covers
 * operations that need a folder, a process, or several validated outputs, such as archive
 * extraction, media probing, PDF inspection, and OCR. It is renderer-safe data only: process
 * execution and filesystem access stay in src/core/advanced-media.
 */

export type AdvancedMediaCategory = 'images' | 'audio' | 'video' | 'archives' | 'documents' | 'ocr'

export type AdvancedMediaFormat =
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'bmp'
  | 'ico'
  | 'heic'
  | 'tiff'
  | 'mp3'
  | 'wav'
  | 'flac'
  | 'm4a'
  | 'ogg'
  | 'mp4'
  | 'mov'
  | 'mkv'
  | 'webm'
  | 'zip'
  | 'tar'
  | 'sevenzip'
  | 'pdf'
  | 'text'
  | 'binary'

export type AdvancedMediaOperationId =
  | 'image-inspect'
  | 'archive-list'
  | 'archive-extract'
  | 'archive-create'
  | 'pdf-inspect'
  | 'pdf-extract-text'
  | 'media-probe'
  | 'ocr-image'
  | 'ocr-pdf'

export type AdvancedMediaDependencyId = 'ffprobe' | 'tesseract' | 'pdf-rasterizer'

export interface AdvancedMediaLimits {
  maxInputBytes: number
  maxOutputBytes: number
  maxEntries: number
  maxDecodedPixels: number
  maxPages: number
  maxTextCharacters: number
  timeoutMs: number
}

export interface AdvancedMediaAdapterDescriptor {
  id: AdvancedMediaOperationId
  category: AdvancedMediaCategory
  label: string
  sourceFormats: AdvancedMediaFormat[]
  outputFormats: AdvancedMediaFormat[]
  bundled: boolean
  available: boolean
  dependency?: AdvancedMediaDependencyId
  unavailableReason?: string
  lossy: boolean
  lossyNotes?: string[]
  limits: AdvancedMediaLimits
}

export interface VerifiedMediaDependency {
  id: AdvancedMediaDependencyId
  executable: string
  version: string
  sha256: string
  sourceUrl: string
  /** The file is valid only when this is true and its digest still matches. */
  verified: boolean
}

export interface AdvancedMediaCatalogSnapshot {
  schemaVersion: 1
  generatedAt: string
  adapters: AdvancedMediaAdapterDescriptor[]
  dependencies: VerifiedMediaDependency[]
}

export type AdvancedMediaJobStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'

export interface AdvancedMediaJob {
  id: string
  operation: AdvancedMediaOperationId
  inputPaths: string[]
  outputPath?: string
  outputDirectory?: string
  status: AdvancedMediaJobStatus
  progress: number
  bytesRead: number
  bytesWritten: number
  totalBytes: number
  startedAt?: number
  finishedAt?: number
  warnings: string[]
  error?: string
}

export interface AdvancedMediaProgress {
  jobId: string
  operation: AdvancedMediaOperationId
  phase: 'queued' | 'reading' | 'processing' | 'writing' | 'validating' | 'done' | 'failed' | 'cancelled'
  progress: number
  bytesRead: number
  bytesWritten: number
  totalBytes: number
  message: string
}

export interface AdvancedMediaResult {
  job: AdvancedMediaJob
  /** Output files are relative to the requested output directory and are validated before return. */
  outputs: { path: string; bytes: number; format: AdvancedMediaFormat; sha256: string }[]
  metadata?: Record<string, unknown>
}

export interface AdvancedMediaApi {
  catalog(): Promise<AdvancedMediaCatalogSnapshot>
  inspect(path: string): Promise<Record<string, unknown>>
  enqueue(request: {
    operation: AdvancedMediaOperationId
    inputPaths: string[]
    outputPath?: string
    outputDirectory?: string
    acknowledgedLoss?: boolean
  }): Promise<AdvancedMediaJob>
  state(offset?: number, limit?: number): Promise<{ jobs: AdvancedMediaJob[]; total: number; running: boolean }>
  start(): Promise<void>
  pause(): Promise<void>
  cancel(jobId: string): Promise<void>
  retry(jobId: string): Promise<void>
  remove(jobId: string): Promise<void>
  onProgress(listener: (event: AdvancedMediaProgress) => void): () => void
}

const MB = 1024 * 1024

export const ADVANCED_MEDIA_DEFAULT_LIMITS: AdvancedMediaLimits = {
  maxInputBytes: 512 * MB,
  maxOutputBytes: 1024 * MB,
  maxEntries: 20_000,
  maxDecodedPixels: 100_000_000,
  maxPages: 2_000,
  maxTextCharacters: 5_000_000,
  timeoutMs: 120_000
}

function bundled(
  id: AdvancedMediaOperationId,
  category: AdvancedMediaCategory,
  label: string,
  sourceFormats: AdvancedMediaFormat[],
  outputFormats: AdvancedMediaFormat[],
  extra: Partial<Pick<AdvancedMediaAdapterDescriptor, 'lossy' | 'lossyNotes'>> = {}
): AdvancedMediaAdapterDescriptor {
  return {
    id,
    category,
    label,
    sourceFormats,
    outputFormats,
    bundled: true,
    available: true,
    limits: { ...ADVANCED_MEDIA_DEFAULT_LIMITS },
    ...extra
  }
}

function requires(
  id: AdvancedMediaOperationId,
  category: AdvancedMediaCategory,
  label: string,
  sourceFormats: AdvancedMediaFormat[],
  outputFormats: AdvancedMediaFormat[],
  dependency: AdvancedMediaDependencyId,
  reason: string
): AdvancedMediaAdapterDescriptor {
  return {
    id,
    category,
    label,
    sourceFormats,
    outputFormats,
    bundled: false,
    available: false,
    dependency,
    unavailableReason: reason,
    lossy: false,
    limits: { ...ADVANCED_MEDIA_DEFAULT_LIMITS }
  }
}

/**
 * The catalog is explicit rather than derived from implementation discovery. A missing row is
 * therefore visible to the UI, and a verified tool can enable only the rows it actually serves.
 */
export function buildAdvancedMediaCatalog(
  verifiedDependencies: ReadonlySet<AdvancedMediaDependencyId> = new Set(),
  declaredDependencies: ReadonlySet<AdvancedMediaDependencyId> = verifiedDependencies
): AdvancedMediaAdapterDescriptor[] {
  const rows: AdvancedMediaAdapterDescriptor[] = [
    bundled('image-inspect', 'images', 'Inspect image metadata', ['png', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'heic'], ['text']),
    bundled('archive-list', 'archives', 'List ZIP and TAR entries', ['zip', 'tar'], ['text']),
    bundled('archive-extract', 'archives', 'Extract ZIP and TAR safely', ['zip', 'tar'], ['text']),
    bundled('archive-create', 'archives', 'Create a ZIP or TAR archive', ['text'], ['zip', 'tar']),
    bundled('pdf-inspect', 'documents', 'Inspect PDF pages and metadata', ['pdf'], ['text']),
    bundled('pdf-extract-text', 'documents', 'Extract text from a PDF', ['pdf'], ['text'], {
      lossy: true,
      lossyNotes: ['Font positioning, vector drawings, annotations, and scanned page pixels are not represented as text.']
    }),
    requires('media-probe', 'audio', 'Inspect audio and video streams', ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'mp4', 'mov', 'mkv', 'webm'], ['text'], 'ffprobe', 'Requires the verified bundled ffprobe tool.'),
    requires('ocr-image', 'ocr', 'Recognize text in an image', ['png', 'jpeg', 'gif', 'webp', 'bmp', 'tiff'], ['text'], 'tesseract', 'Requires the verified bundled Tesseract OCR tool.'),
    requires('ocr-pdf', 'ocr', 'Recognize text in a PDF', ['pdf'], ['text'], 'pdf-rasterizer', 'Requires the verified bundled PDF rasterizer.')
  ]
  return rows.map((row) => {
    if (!row.dependency || !declaredDependencies.has(row.dependency)) return row
    if (verifiedDependencies.has(row.dependency)) return { ...row, bundled: true, available: true, unavailableReason: undefined }
    return { ...row, available: true, unavailableReason: 'A verified package tool will be installed automatically when this operation starts.' }
  })
}

export const ADVANCED_MEDIA_CATALOG = buildAdvancedMediaCatalog()

export function advancedMediaAdapterById(id: string, catalog = ADVANCED_MEDIA_CATALOG): AdvancedMediaAdapterDescriptor | undefined {
  return catalog.find((row) => row.id === id)
}
