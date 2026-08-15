// Universal file converter — shared types + the declarative adapter catalog.
//
// This file is pure data (no Node/Electron imports) so it is safe to import from the renderer for
// building the categorized catalog UI. The actual byte-level conversion logic lives in
// src/core/converter/* and is looked up by `AdapterDescriptor.id` — see docs/file-converter.md for
// the full contract (bundled rule, lossy disclosure, resource bounds).

/** Every category the catalog groups adapters into. Every one of these renders, even when every
 *  adapter inside it is disabled — an empty-looking category with no explanation is indistinguishable
 *  from a bug; a category full of disabled rows naming their missing dependency is not. */
export type ConverterCategoryId =
  | 'documents'
  | 'images'
  | 'audio'
  | 'video'
  | 'archives'
  | 'data'
  | 'code'
  | 'binary'

export const CONVERTER_CATEGORY_ORDER: ConverterCategoryId[] = [
  'documents',
  'images',
  'audio',
  'video',
  'archives',
  'data',
  'code',
  'binary'
]

export const CONVERTER_CATEGORY_LABELS: Record<ConverterCategoryId, string> = {
  documents: 'Documents / PDF',
  images: 'Images',
  audio: 'Audio',
  video: 'Video',
  archives: 'Archives',
  data: 'Structured Data / Spreadsheets',
  code: 'Code / Text',
  binary: 'Binary Encodings'
}

/** A "kind" is a content shape an adapter reads or writes — narrower than a category (a category
 *  groups several kinds; `any` means "works on arbitrary bytes", used by the binary-encoding and
 *  archive-compression adapters). Detection resolves a source file to one of these (or null). */
export type ConverterKind =
  | 'any'
  | 'json'
  | 'yaml'
  | 'toml'
  | 'xml'
  | 'csv'
  | 'tsv'
  | 'text'
  | 'markdown'
  | 'gzip'
  | 'brotli'
  // Recognized by their byte signature but with NO bundled adapter in this build — detection can
  // still name them accurately so the catalog's disabled rows are backed by a real sniff, not a guess.
  | 'pdf'
  | 'docx'
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'bmp'
  | 'ico'
  | 'heic'
  | 'svg'
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

export const CONVERTER_KIND_LABELS: Record<ConverterKind, string> = {
  any: 'Any bytes',
  json: 'JSON',
  yaml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  csv: 'CSV',
  tsv: 'TSV',
  text: 'Plain text',
  markdown: 'Markdown',
  gzip: 'Gzip',
  brotli: 'Brotli',
  pdf: 'PDF',
  docx: 'Word document (.docx)',
  png: 'PNG image',
  jpeg: 'JPEG image',
  gif: 'GIF image',
  webp: 'WebP image',
  bmp: 'BMP image',
  ico: 'Icon (.ico)',
  heic: 'HEIC image',
  svg: 'SVG image',
  mp3: 'MP3 audio',
  wav: 'WAV audio',
  flac: 'FLAC audio',
  m4a: 'M4A audio',
  ogg: 'Ogg audio',
  mp4: 'MP4 video',
  mov: 'QuickTime video (.mov)',
  mkv: 'Matroska video (.mkv)',
  webm: 'WebM video',
  zip: 'ZIP archive',
  tar: 'TAR archive',
  sevenzip: '7-Zip archive'
}

/** One row of the catalog. `bundled` + `available` are declared here, not merely asserted: every
 *  `bundled: true` row in CONVERTER_CATALOG below is backed by a real adapter in
 *  src/core/converter/registry.ts that runs fully offline with zero external processes or network
 *  calls — PATH discovery, a developer-machine tool, or an optional dependency never flips this on.
 *  A row that is merely "known" but not bundled stays `available: false` with the exact missing
 *  dependency named in `unavailableReason`, and is still rendered (disabled) so the catalog never
 *  pretends a format doesn't exist. */
export interface ConverterAdapterDescriptor {
  id: string
  category: ConverterCategoryId
  fromKind: ConverterKind
  toKind: ConverterKind
  label: string
  bundled: boolean
  available: boolean
  unavailableReason?: string
  /** True when the conversion can drop information (structure, metadata, precision, formatting).
   *  A lossy adapter must be disclosed to the user (see docs/file-converter.md) before it runs. */
  lossy: boolean
  lossyNotes?: string[]
  /** Typical source extensions, informational only — detection never trusts the extension alone. */
  sourceExt: string[]
  /** Default extension to suggest for the output filename. */
  targetExt: string
  /** Hard ceiling on the SOURCE file size this adapter will accept, in bytes. A source over this
   *  limit is refused up front with a clear message rather than partially read. */
  maxInputBytes: number
}

const MB = 1024 * 1024

/** Structured-data kinds our hand-rolled codec understands (src/core/converter/structured-codec.ts).
 *  Every ordered pair among these becomes one catalog row — see buildStructuredMesh() below. */
const STRUCTURED_KINDS: { kind: ConverterKind; label: string; ext: string[] }[] = [
  { kind: 'json', label: 'JSON', ext: ['.json'] },
  { kind: 'yaml', label: 'YAML', ext: ['.yaml', '.yml'] },
  { kind: 'toml', label: 'TOML', ext: ['.toml'] },
  { kind: 'xml', label: 'XML', ext: ['.xml'] },
  { kind: 'csv', label: 'CSV', ext: ['.csv'] },
  { kind: 'tsv', label: 'TSV', ext: ['.tsv'] }
]

/** Round-tripping through a shape as permissive as "any JSON value" is inherently lossy for the
 *  tabular formats (CSV/TSV can only carry an array of flat objects) and for our own XML convention
 *  (element-name collisions under one array key, mixed types). JSON<->YAML and JSON<->TOML preserve
 *  the JSON-compatible subset faithfully (TOML lacks `null`, so that one direction is also flagged). */
function structuredLossy(from: ConverterKind, to: ConverterKind): { lossy: boolean; notes?: string[] } {
  if (from === 'csv' || from === 'tsv' || to === 'csv' || to === 'tsv') {
    return {
      lossy: true,
      notes: [
        'Only a flat array of objects survives the round trip through a spreadsheet shape.',
        'Nested objects/arrays inside a cell are stringified as JSON text.'
      ]
    }
  }
  if (from === 'xml' || to === 'xml') {
    return {
      lossy: true,
      notes: [
        "Uses this app's own JSON⇄XML element convention, not a general-purpose XML schema.",
        'Attributes, namespaces, comments and processing instructions are not represented.'
      ]
    }
  }
  if (to === 'toml') {
    return { lossy: true, notes: ['TOML has no `null` — a null value is dropped from the output.'] }
  }
  return { lossy: false }
}

function buildStructuredMesh(): ConverterAdapterDescriptor[] {
  const rows: ConverterAdapterDescriptor[] = []
  for (const from of STRUCTURED_KINDS) {
    for (const to of STRUCTURED_KINDS) {
      if (from.kind === to.kind) continue
      const { lossy, notes } = structuredLossy(from.kind, to.kind)
      rows.push({
        id: `${from.kind}-to-${to.kind}`,
        category: 'data',
        fromKind: from.kind,
        toKind: to.kind,
        label: `${from.label} → ${to.label}`,
        bundled: true,
        available: true,
        lossy,
        lossyNotes: notes,
        sourceExt: from.ext,
        targetExt: to.ext[0],
        maxInputBytes: 64 * MB
      })
    }
  }
  return rows
}

function disabled(row: {
  id: string
  category: ConverterCategoryId
  fromKind: ConverterKind
  toKind: ConverterKind
  label: string
  sourceExt: string[]
  targetExt: string
  reason: string
}): ConverterAdapterDescriptor {
  return {
    id: row.id,
    category: row.category,
    fromKind: row.fromKind,
    toKind: row.toKind,
    label: row.label,
    bundled: false,
    available: false,
    unavailableReason: row.reason,
    lossy: true,
    sourceExt: row.sourceExt,
    targetExt: row.targetExt,
    maxInputBytes: 0
  }
}

const CODE_TEXT_ROWS: ConverterAdapterDescriptor[] = [
  {
    id: 'text-to-crlf',
    category: 'code',
    fromKind: 'text',
    toKind: 'text',
    label: 'Any text → CRLF line endings',
    bundled: true,
    available: true,
    lossy: false,
    sourceExt: ['.txt', '.md', '.json', '.csv', '.log'],
    targetExt: '.txt',
    maxInputBytes: 64 * MB
  },
  {
    id: 'text-to-lf',
    category: 'code',
    fromKind: 'text',
    toKind: 'text',
    label: 'Any text → LF line endings',
    bundled: true,
    available: true,
    lossy: false,
    sourceExt: ['.txt', '.md', '.json', '.csv', '.log'],
    targetExt: '.txt',
    maxInputBytes: 64 * MB
  },
  {
    id: 'utf8-to-utf16le',
    category: 'code',
    fromKind: 'text',
    toKind: 'text',
    label: 'UTF-8 text → UTF-16LE text',
    bundled: true,
    available: true,
    lossy: false,
    sourceExt: ['.txt'],
    targetExt: '.txt',
    maxInputBytes: 64 * MB
  },
  {
    id: 'utf16le-to-utf8',
    category: 'code',
    fromKind: 'text',
    toKind: 'text',
    label: 'UTF-16LE text → UTF-8 text',
    bundled: true,
    available: true,
    lossy: false,
    sourceExt: ['.txt'],
    targetExt: '.txt',
    maxInputBytes: 64 * MB
  },
  {
    id: 'utf8-to-latin1',
    category: 'code',
    fromKind: 'text',
    toKind: 'text',
    label: 'UTF-8 text → Latin-1 (ISO-8859-1) text',
    bundled: true,
    available: true,
    lossy: true,
    lossyNotes: ['Any character outside Latin-1 (U+0100 and above) is replaced with "?".'],
    sourceExt: ['.txt'],
    targetExt: '.txt',
    maxInputBytes: 64 * MB
  },
  {
    id: 'latin1-to-utf8',
    category: 'code',
    fromKind: 'text',
    toKind: 'text',
    label: 'Latin-1 (ISO-8859-1) text → UTF-8 text',
    bundled: true,
    available: true,
    lossy: false,
    sourceExt: ['.txt'],
    targetExt: '.txt',
    maxInputBytes: 64 * MB
  },
  {
    id: 'markdown-to-html',
    category: 'code',
    fromKind: 'markdown',
    toKind: 'text',
    label: 'Markdown → HTML',
    bundled: true,
    available: true,
    lossy: true,
    lossyNotes: [
      'Raw HTML already inside the Markdown is passed through unsanitized into the output file.',
      'No CSS/theme is attached — the file is bare semantic HTML.'
    ],
    sourceExt: ['.md', '.markdown'],
    targetExt: '.html',
    maxInputBytes: 32 * MB
  }
]

const BINARY_ROWS: ConverterAdapterDescriptor[] = [
  {
    id: 'any-to-base64',
    category: 'binary',
    fromKind: 'any',
    toKind: 'text',
    label: 'Any file → Base64 text',
    bundled: true,
    available: true,
    lossy: false,
    sourceExt: [],
    targetExt: '.b64.txt',
    maxInputBytes: 128 * MB
  },
  {
    id: 'base64-to-any',
    category: 'binary',
    fromKind: 'text',
    toKind: 'any',
    label: 'Base64 text → decoded bytes',
    bundled: true,
    available: true,
    lossy: false,
    sourceExt: ['.b64', '.txt'],
    targetExt: '.bin',
    maxInputBytes: 170 * MB
  },
  {
    id: 'any-to-hex',
    category: 'binary',
    fromKind: 'any',
    toKind: 'text',
    label: 'Any file → hex text',
    bundled: true,
    available: true,
    lossy: false,
    sourceExt: [],
    targetExt: '.hex.txt',
    maxInputBytes: 64 * MB
  },
  {
    id: 'hex-to-any',
    category: 'binary',
    fromKind: 'text',
    toKind: 'any',
    label: 'Hex text → decoded bytes',
    bundled: true,
    available: true,
    lossy: false,
    sourceExt: ['.hex', '.txt'],
    targetExt: '.bin',
    maxInputBytes: 128 * MB
  }
]

const ARCHIVE_ROWS: ConverterAdapterDescriptor[] = [
  {
    id: 'any-to-gzip',
    category: 'archives',
    fromKind: 'any',
    toKind: 'gzip',
    label: 'Any file → .gz (gzip compress)',
    bundled: true,
    available: true,
    lossy: false,
    sourceExt: [],
    targetExt: '.gz',
    maxInputBytes: 128 * MB
  },
  {
    id: 'gzip-to-any',
    category: 'archives',
    fromKind: 'gzip',
    toKind: 'any',
    label: '.gz → decompressed bytes',
    bundled: true,
    available: true,
    lossy: false,
    sourceExt: ['.gz'],
    targetExt: '.out',
    maxInputBytes: 128 * MB
  },
  {
    id: 'any-to-brotli',
    category: 'archives',
    fromKind: 'any',
    toKind: 'brotli',
    label: 'Any file → .br (Brotli compress)',
    bundled: true,
    available: true,
    lossy: false,
    sourceExt: [],
    targetExt: '.br',
    maxInputBytes: 128 * MB
  },
  {
    id: 'brotli-to-any',
    category: 'archives',
    fromKind: 'brotli',
    toKind: 'any',
    label: '.br → decompressed bytes',
    bundled: true,
    available: true,
    lossy: false,
    sourceExt: ['.br'],
    targetExt: '.out',
    maxInputBytes: 128 * MB
  },
  disabled({
    id: 'zip-extract',
    category: 'archives',
    fromKind: 'zip',
    toKind: 'any',
    label: 'ZIP → extracted files',
    sourceExt: ['.zip'],
    targetExt: '.out',
    reason: 'requires a ZIP container library (e.g. adm-zip), not bundled in this build'
  }),
  disabled({
    id: 'zip-create',
    category: 'archives',
    fromKind: 'any',
    toKind: 'zip',
    label: 'Files → .zip archive',
    sourceExt: [],
    targetExt: '.zip',
    reason: 'requires a ZIP container library (e.g. adm-zip), not bundled in this build'
  }),
  disabled({
    id: 'tar-extract',
    category: 'archives',
    fromKind: 'tar',
    toKind: 'any',
    label: 'TAR → extracted files',
    sourceExt: ['.tar'],
    targetExt: '.out',
    reason: 'requires a TAR container library, not bundled in this build'
  }),
  disabled({
    id: 'sevenzip-extract',
    category: 'archives',
    fromKind: 'sevenzip',
    toKind: 'any',
    label: '7-Zip → extracted files',
    sourceExt: ['.7z'],
    targetExt: '.out',
    reason: 'requires the 7-Zip engine (native binary), not bundled in this build'
  })
]

const DOCUMENT_ROWS: ConverterAdapterDescriptor[] = [
  disabled({
    id: 'pdf-to-text',
    category: 'documents',
    fromKind: 'pdf',
    toKind: 'text',
    label: 'PDF → plain text',
    sourceExt: ['.pdf'],
    targetExt: '.txt',
    reason: 'requires a PDF text-extraction library (e.g. pdf-parse), not bundled in this build'
  }),
  disabled({
    id: 'docx-to-markdown',
    category: 'documents',
    fromKind: 'docx',
    toKind: 'markdown',
    label: 'Word document (.docx) → Markdown',
    sourceExt: ['.docx'],
    targetExt: '.md',
    reason: 'requires a .docx reader library (e.g. mammoth), not bundled in this build'
  }),
  disabled({
    id: 'markdown-to-pdf',
    category: 'documents',
    fromKind: 'markdown',
    toKind: 'pdf',
    label: 'Markdown → PDF',
    sourceExt: ['.md'],
    targetExt: '.pdf',
    reason: 'requires a PDF rendering engine, not bundled in this build'
  }),
  disabled({
    id: 'html-to-pdf',
    category: 'documents',
    fromKind: 'text',
    toKind: 'pdf',
    label: 'HTML → PDF',
    sourceExt: ['.html'],
    targetExt: '.pdf',
    reason: 'requires a headless rendering engine, not bundled in this build'
  }),
  disabled({
    id: 'pdf-to-images',
    category: 'documents',
    fromKind: 'pdf',
    toKind: 'png',
    label: 'PDF pages → PNG images',
    sourceExt: ['.pdf'],
    targetExt: '.png',
    reason: 'requires a PDF rasterizer, not bundled in this build'
  })
]

const IMAGE_ROWS: ConverterAdapterDescriptor[] = (
  [
    ['png', 'jpeg'],
    ['jpeg', 'png'],
    ['webp', 'png'],
    ['png', 'webp'],
    ['svg', 'png'],
    ['gif', 'png'],
    ['bmp', 'png'],
    ['ico', 'png'],
    ['heic', 'jpeg']
  ] as [ConverterKind, ConverterKind][]
).map(([from, to]) =>
  disabled({
    id: `${from}-to-${to}`,
    category: 'images',
    fromKind: from,
    toKind: to,
    label: `${CONVERTER_KIND_LABELS[from]} → ${CONVERTER_KIND_LABELS[to]}`,
    sourceExt: [`.${from}`],
    targetExt: `.${to === 'jpeg' ? 'jpg' : to}`,
    reason: 'requires an image codec (e.g. sharp/libvips), not bundled in this build'
  })
)

const AUDIO_ROWS: ConverterAdapterDescriptor[] = (
  [
    ['mp3', 'wav'],
    ['wav', 'mp3'],
    ['flac', 'wav'],
    ['m4a', 'mp3'],
    ['ogg', 'wav']
  ] as [ConverterKind, ConverterKind][]
).map(([from, to]) =>
  disabled({
    id: `${from}-to-${to}`,
    category: 'audio',
    fromKind: from,
    toKind: to,
    label: `${CONVERTER_KIND_LABELS[from]} → ${CONVERTER_KIND_LABELS[to]}`,
    sourceExt: [`.${from}`],
    targetExt: `.${to}`,
    reason: 'requires an audio transcoder (e.g. ffmpeg), not bundled in this build'
  })
)

const VIDEO_ROWS: ConverterAdapterDescriptor[] = (
  [
    ['mp4', 'webm'],
    ['mov', 'mp4'],
    ['mkv', 'mp4']
  ] as [ConverterKind, ConverterKind][]
).map(([from, to]) =>
  disabled({
    id: `${from}-to-${to}`,
    category: 'video',
    fromKind: from,
    toKind: to,
    label: `${CONVERTER_KIND_LABELS[from]} → ${CONVERTER_KIND_LABELS[to]}`,
    sourceExt: [`.${from}`],
    targetExt: `.${to}`,
    reason: 'requires a video transcoder (e.g. ffmpeg), not bundled in this build'
  })
)

export const CONVERTER_CATALOG: ConverterAdapterDescriptor[] = [
  ...DOCUMENT_ROWS,
  ...IMAGE_ROWS,
  ...AUDIO_ROWS,
  ...VIDEO_ROWS,
  ...ARCHIVE_ROWS,
  ...buildStructuredMesh(),
  ...CODE_TEXT_ROWS,
  ...BINARY_ROWS
]

export function converterAdaptersByCategory(
  catalog: ConverterAdapterDescriptor[] = CONVERTER_CATALOG
): Record<ConverterCategoryId, ConverterAdapterDescriptor[]> {
  const out = {} as Record<ConverterCategoryId, ConverterAdapterDescriptor[]>
  for (const c of CONVERTER_CATEGORY_ORDER) out[c] = []
  for (const row of catalog) out[row.category].push(row)
  return out
}

export function converterAdapterById(id: string): ConverterAdapterDescriptor | undefined {
  return CONVERTER_CATALOG.find((a) => a.id === id)
}

// ---------------------------------------------------------------------------------------------
// Queue types
// ---------------------------------------------------------------------------------------------

export type ConvertItemStatus =
  | 'queued'
  | 'needs-confirm'
  | 'running'
  | 'paused'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'skipped'

export interface ConvertQueueItem {
  id: string
  sourcePath: string
  sourceName: string
  sourceBytes: number
  destPath: string
  adapterId: string
  status: ConvertItemStatus
  /** Why the item is in `needs-confirm`: 'lossy' (the adapter is lossy and hasn't been confirmed),
   *  'overwrite' (destPath already exists), or both space-joined. Cleared once resolved. */
  confirmReasons?: ('lossy' | 'overwrite')[]
  /** True once the user has explicitly allowed overwriting `destPath`. Checked again immediately
   *  before the write (not just at queue time) — if the destination reappears after this was
   *  granted for a DIFFERENT prior state, the write still requires this to be true. */
  overwriteAllowed?: boolean
  progressBytes: number
  totalBytes: number
  error?: string
  warnings?: string[]
  createdAt: number
  updatedAt: number
}

export interface ConverterQueueState {
  items: ConvertQueueItem[]
  total: number
  concurrency: number
  running: boolean
  /** Set once a folder scan is in flight, so the UI can show "discovering files…" rather than a
   *  queue that looks frozen while a large tree is walked in the background. */
  scanning: boolean
}

export interface ConverterPreflightResult {
  destDir: string
  destDirExists: boolean
  writable: boolean
  freeBytes: number | null
  estimatedNeededBytes: number
  sufficient: boolean | null
}

export interface ConverterDetectionResult {
  path: string
  name: string
  sizeBytes: number
  detectedKind: ConverterKind | null
  confidence: 'high' | 'medium' | 'low'
  note: string
  /** Adapters (bundled AND disabled) whose fromKind matches the detected kind, or whose fromKind is
   *  'any' (works on arbitrary bytes) — the compatible-target list the catalog UI preselects. */
  compatibleAdapterIds: string[]
}

export const CONVERTER_DEFAULT_CONCURRENCY = 2
export const CONVERTER_MAX_CONCURRENCY = 6
/** Bytes sampled from the head of a file for signature/content sniffing — bounded, never the whole
 *  file. See src/core/converter/detect.ts. */
export const CONVERTER_SNIFF_BYTES = 64 * 1024

// ---------------------------------------------------------------------------------------------
// window.nodeTerminal.converter — the renderer-facing API shape. Implemented for real by the
// preload (Electron) and src/renderer/bridge (Server Edition) over the converter:* IPC channels
// registered in src/core/converter/register-ipc.ts.
// ---------------------------------------------------------------------------------------------

export interface ConverterApi {
  /** The full catalog — every bundled AND disabled adapter, for the categorized picker. */
  catalog(): Promise<ConverterAdapterDescriptor[]>
  detect(path: string): Promise<ConverterDetectionResult>
  preflight(destDir: string): Promise<ConverterPreflightResult>
  state(offset?: number, limit?: number): Promise<ConverterQueueState>
  addFiles(
    paths: string[],
    destDir: string,
    adapterId: string,
    lossyAcknowledged?: boolean
  ): Promise<{ added: ConvertQueueItem[]; rejected: { path: string; error: string }[] }>
  addFolder(
    root: string,
    destDir: string,
    adapterId: string,
    opts?: { lossyAcknowledged?: boolean; recursive?: boolean }
  ): Promise<void>
  cancelScan(): Promise<void>
  resolvePending(ids: string[], opts: { overwrite?: boolean; lossyAcknowledged?: boolean }): Promise<void>
  start(): Promise<void>
  pause(): Promise<void>
  cancelItem(id: string): Promise<void>
  cancelAll(): Promise<void>
  retryItem(id: string): Promise<void>
  removeItem(id: string): Promise<void>
  clearFinished(): Promise<void>
  setConcurrency(n: number): Promise<number>
  /** Fires whenever one item's status/progress changes. Returns unsubscribe. */
  onItem(listener: (item: ConvertQueueItem) => void): () => void
  /** Fires whenever a queue-wide fact (running/scanning/concurrency/total) changes. */
  onSummary(
    listener: (summary: Pick<ConverterQueueState, 'running' | 'scanning' | 'concurrency' | 'total'>) => void
  ): () => void
}
