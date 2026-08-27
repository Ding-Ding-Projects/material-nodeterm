/**
 * Portable, project-owned media for schema 3.
 *
 * This module is deliberately platform-free at its interchange boundary. A source path is an
 * input to collection only and is never retained in a manifest, placeholder, omission, or
 * imported value. Import only returns validated bytes and metadata; it does not open, download,
 * launch, deploy, or otherwise acquire an external resource.
 */

import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { PortableProjectV3Error, PORTABLE_PROJECT_SCHEMA, PORTABLE_PROJECT_SCHEMA_VERSION } from './portable-project-v3'
import type {
  PortableMediaCandidate,
  PortableMediaDecision,
  PortableMediaDecisionRecord,
  PortableMediaKind,
  PortableMediaPrepareInput
} from '../shared/portable-media'

export type { PortableMediaCandidate, PortableMediaDecision, PortableMediaKind } from '../shared/portable-media'

export const PORTABLE_MEDIA_LIMITS = {
  maxAssetBytes: 512 * 1024 * 1024,
  maxAssetCount: 10_000,
  maxManifestBytes: 8 * 1024 * 1024,
  maxLabelBytes: 512,
  maxMimeBytes: 128,
  maxExtensionBytes: 16
} as const

export interface PortableMediaAsset {
  /** Content address, never a source path or machine-local identifier. */
  id: string
  kind: PortableMediaKind
  mime: string
  extension: string
  bytes: number
  sha256: string
  /** Optional user-facing label. It must not contain a local path. */
  label?: string
  width?: number
  height?: number
  durationMs?: number
  frames?: number
  /** True when this asset is represented by an unresolved placeholder. */
  unresolved?: boolean
}

export interface PortableMediaOmission {
  assetId: string
  decision: 'omit' | 'locate-later'
  reason: 'user-choice' | 'missing' | 'unsupported' | 'validation-failed' | 'machine-local'
  detail: string
}

export interface PortableMediaManifest {
  format: typeof PORTABLE_PROJECT_SCHEMA
  schemaVersion: typeof PORTABLE_PROJECT_SCHEMA_VERSION
  assets: PortableMediaAsset[]
  omissions: PortableMediaOmission[]
}

export interface PortableMediaCollected {
  asset: PortableMediaAsset
  data?: Uint8Array
  /** Machine-local stream source. Never pass this object into a manifest or projection. */
  source?: { path: string; open: (signal?: AbortSignal) => NodeJS.ReadableStream }
  sourceName: string
}

const SHA256 = /^[0-9a-f]{64}$/
function utf8Bytes(value: string): number { return new TextEncoder().encode(value).byteLength }
function fail(message: string): never { throw new PortableProjectV3Error('manifest', message) }
const ASSET_KEYS = new Set(['id', 'kind', 'mime', 'extension', 'bytes', 'sha256', 'label', 'width', 'height', 'durationMs', 'frames', 'unresolved'])
const OMISSION_KEYS = new Set(['assetId', 'decision', 'reason', 'detail'])
const MANIFEST_KEYS = new Set(['format', 'schemaVersion', 'assets', 'omissions'])
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) if (UNSAFE_KEYS.has(key) || !allowed.has(key)) fail(`Portable media ${label} contains an unknown key: ${key}`)
}

function cleanExtension(value: string): string {
  const extension = value.toLowerCase().replace(/^\./, '')
  if (!/^[a-z0-9]{1,16}$/.test(extension) || utf8Bytes(extension) > PORTABLE_MEDIA_LIMITS.maxExtensionBytes) {
    return fail(`Portable media extension is unsupported: ${value}`)
  }
  return extension
}

function cleanLabel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (utf8Bytes(value) > PORTABLE_MEDIA_LIMITS.maxLabelBytes || value.includes('\0') || /[\r\n]/.test(value)) {
    return fail('Portable media label is invalid or exceeds its UTF-8 bound.')
  }
  return value
}

function signature(data: Uint8Array): { kind: PortableMediaKind; mime: string; extension: string } | null {
  const ascii = (offset: number, text: string): boolean => text.split('').every((char, index) => data[offset + index] === char.charCodeAt(0))
  if (data.length >= 8 && data[0] === 0x89 && ascii(1, 'PNG') && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) return { kind: 'image', mime: 'image/png', extension: 'png' }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { kind: 'image', mime: 'image/jpeg', extension: 'jpg' }
  if (data.length >= 6 && (ascii(0, 'GIF87a') || ascii(0, 'GIF89a'))) return { kind: 'image', mime: 'image/gif', extension: 'gif' }
  if (data.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { kind: 'image', mime: 'image/webp', extension: 'webp' }
  if (data.length >= 12 && ascii(4, 'ftyp')) {
    const brand = String.fromCharCode(...data.slice(8, 12)).toLowerCase()
    if (['avif', 'avis'].includes(brand)) return { kind: 'image', mime: 'image/avif', extension: 'avif' }
    if (['mp4', 'isom', 'iso2', 'avc1', 'mp41', 'mp42'].includes(brand)) return { kind: 'video', mime: 'video/mp4', extension: 'mp4' }
    if (brand === 'qt  ') return { kind: 'video', mime: 'video/quicktime', extension: 'mov' }
  }
  // Ogg is a container, not an audio proof. Require a bounded codec identification header;
  // otherwise retain the honest unsupported state rather than labelling arbitrary Ogg content.
  if (data.length >= 4 && ascii(0, 'OggS')) {
    const head = new TextDecoder('ascii').decode(data.slice(0, Math.min(data.length, 4096)))
    if (head.includes('OpusHead') || head.includes('vorbis')) return { kind: 'audio', mime: 'audio/ogg', extension: 'ogg' }
    return null
  }
  if (data.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WAVE')) return { kind: 'audio', mime: 'audio/wav', extension: 'wav' }
  if (data.length >= 4 && ascii(0, 'fLaC')) return { kind: 'audio', mime: 'audio/flac', extension: 'flac' }
  if (data.length >= 3 && ascii(0, 'ID3')) return { kind: 'audio', mime: 'audio/mpeg', extension: 'mp3' }
  if (data.length >= 4 && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) {
    const text = new TextDecoder('ascii').decode(data.slice(0, Math.min(data.length, 4096))).toLowerCase()
    if (text.includes('matroska')) return null
    if (text.includes('webm')) return { kind: 'video', mime: 'video/webm', extension: 'webm' }
    return null
  }
  return null
}

export function sha256Media(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

async function assertPortableMediaPath(sourcePath: string): Promise<import('node:fs').Stats> {
  const resolved = path.resolve(sourcePath)
  const parsed = path.parse(resolved)
  let current = parsed.root
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    const stat = await fs.lstat(current)
    if (stat.isSymbolicLink()) return fail(`Portable media source contains a symlink or reparse point: ${path.basename(sourcePath)}`)
  }
  const stat = await fs.lstat(resolved)
  if (!stat.isFile()) return fail(`Portable media source is not a regular file: ${path.basename(sourcePath)}`)
  return stat
}

function mediaFactsFromWav(data: Uint8Array): { durationMs: number } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 12
  let byteRate = 0
  let dataBytes = -1
  while (offset + 8 <= data.byteLength) {
    const id = new TextDecoder('ascii').decode(data.subarray(offset, offset + 4))
    const size = view.getUint32(offset + 4, true)
    const end = offset + 8 + size
    if (end > data.byteLength) return fail('Portable WAV contains a truncated chunk.')
    if (id === 'fmt ') {
      if (size < 16) return fail('Portable WAV format chunk is too small.')
      const format = view.getUint16(offset + 8, true)
      const channels = view.getUint16(offset + 10, true)
      const sampleRate = view.getUint32(offset + 12, true)
      byteRate = view.getUint32(offset + 16, true)
      if (![1, 3].includes(format) || channels < 1 || channels > 32 || sampleRate < 1 || byteRate < 1) return fail('Portable WAV format facts are unsupported or invalid.')
    } else if (id === 'data') dataBytes = size
    offset = end + (size & 1)
  }
  if (byteRate < 1 || dataBytes < 0) return fail('Portable WAV is missing its format or data chunk.')
  return { durationMs: Math.round((dataBytes / byteRate) * 1000) }
}

interface IsoBox { type: string; start: number; end: number; payload: number }
function isoBoxes(data: Uint8Array, start = 0, end = data.byteLength): IsoBox[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const boxes: IsoBox[] = []
  let offset = start
  while (offset + 8 <= end) {
    let size = view.getUint32(offset, false)
    const type = new TextDecoder('ascii').decode(data.subarray(offset + 4, offset + 8))
    let header = 8
    if (size === 1) {
      if (offset + 16 > end) return fail('Portable ISO media has a truncated extended box.')
      const high = view.getUint32(offset + 8, false)
      const low = view.getUint32(offset + 12, false)
      const extended = high * 0x1_0000_0000 + low
      if (!Number.isSafeInteger(extended)) return fail('Portable ISO media box exceeds the safe integer range.')
      size = extended
      header = 16
    } else if (size === 0) size = end - offset
    if (size < header || offset + size > end) return fail(`Portable ISO media has an invalid ${type || 'unnamed'} box.`)
    boxes.push({ type, start: offset, end: offset + size, payload: offset + header })
    offset += size
  }
  if (offset !== end) return fail('Portable ISO media has trailing malformed box bytes.')
  return boxes
}

function mediaFactsFromIso(data: Uint8Array): { width: number; height: number; durationMs: number } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const top = isoBoxes(data)
  const moov = top.find((box) => box.type === 'moov')
  if (!moov) return fail('Portable ISO media is missing its movie box.')
  const children = isoBoxes(data, moov.payload, moov.end)
  const mvhd = children.find((box) => box.type === 'mvhd')
  if (!mvhd || mvhd.payload + 20 > mvhd.end) return fail('Portable ISO media is missing valid movie timing facts.')
  const version = data[mvhd.payload]
  const timeOffset = version === 1 ? mvhd.payload + 20 : mvhd.payload + 12
  const durationOffset = version === 1 ? mvhd.payload + 24 : mvhd.payload + 16
  if (timeOffset + 4 > mvhd.end || durationOffset + (version === 1 ? 8 : 4) > mvhd.end) return fail('Portable ISO media movie timing facts are truncated.')
  const timescale = view.getUint32(timeOffset, false)
  const duration = version === 1
    ? view.getUint32(durationOffset, false) * 0x1_0000_0000 + view.getUint32(durationOffset + 4, false)
    : view.getUint32(durationOffset, false)
  if (timescale < 1 || !Number.isSafeInteger(duration)) return fail('Portable ISO media movie timing facts are invalid.')
  let width = 0
  let height = 0
  for (const trak of children.filter((box) => box.type === 'trak')) {
    const tkhd = isoBoxes(data, trak.payload, trak.end).find((box) => box.type === 'tkhd')
    if (!tkhd || tkhd.end - tkhd.payload < 8) continue
    const candidateWidth = Math.round(view.getUint32(tkhd.end - 8, false) / 65536)
    const candidateHeight = Math.round(view.getUint32(tkhd.end - 4, false) / 65536)
    if (candidateWidth > width && candidateHeight > height) { width = candidateWidth; height = candidateHeight }
  }
  if (width < 1 || height < 1) return fail('Portable ISO media has no parser-proved video dimensions.')
  return { width, height, durationMs: Math.round((duration / timescale) * 1000) }
}

/** Decode enough of the real format to prove display facts, never signature alone. */
export async function parsePortableMediaFacts(data: Uint8Array, asset: Pick<PortableMediaAsset, 'kind' | 'mime'>): Promise<Pick<PortableMediaAsset, 'width' | 'height' | 'durationMs' | 'frames'>> {
  if (asset.kind === 'image') {
    const { default: sharp } = await import('sharp')
    const metadata = await sharp(Buffer.from(data), { animated: true, limitInputPixels: 100_000_000 }).metadata()
    if (!metadata.width || !metadata.height) return fail('Portable image parser returned no dimensions.')
    const frames = metadata.pages ?? 1
    const durationMs = metadata.delay?.reduce((total, delay) => total + delay, 0)
    return { width: metadata.width, height: metadata.height, frames, ...(durationMs ? { durationMs } : {}) }
  }
  if (asset.mime === 'audio/wav') return mediaFactsFromWav(data)
  if (asset.mime === 'video/mp4' || asset.mime === 'video/quicktime') return mediaFactsFromIso(data)
  return fail(`Portable media has no bundled parser proof for ${asset.mime}. Choose Locate Later or Omit.`)
}

/** Inspect bytes, requiring a recognised signature and refusing extension-only claims. */
export function inspectPortableMedia(data: Uint8Array, sourceName = 'media'): { kind: PortableMediaKind; mime: string; extension: string; bytes: number } {
  if (!(data instanceof Uint8Array) || data.byteLength === 0) return fail(`Portable media is empty: ${sourceName}`)
  if (data.byteLength > PORTABLE_MEDIA_LIMITS.maxAssetBytes) return fail(`Portable media exceeds ${PORTABLE_MEDIA_LIMITS.maxAssetBytes} bytes: ${sourceName}`)
  const detected = signature(data)
  if (!detected) return fail(`Portable media signature is unsupported or invalid: ${sourceName}`)
  return { ...detected, bytes: data.byteLength }
}

/** Collect a source file without retaining its absolute path in the returned portable record. */
export async function collectPortableMedia(sourcePath: string, label?: string, signal?: AbortSignal): Promise<PortableMediaCollected> {
  const stat = await assertPortableMediaPath(sourcePath)
  if (stat.size > PORTABLE_MEDIA_LIMITS.maxAssetBytes) return fail(`Portable media exceeds ${PORTABLE_MEDIA_LIMITS.maxAssetBytes} bytes: ${path.basename(sourcePath)}`)
  const head: Buffer[] = []
  let headBytes = 0
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(sourcePath, { signal })) {
    const buffer = Buffer.from(chunk as Uint8Array)
    hash.update(buffer); bytes += buffer.length
    if (headBytes < 4096) { const part = buffer.subarray(0, 4096 - headBytes); head.push(part); headBytes += part.length }
  }
  const prefix = Buffer.concat(head)
  const info = inspectPortableMedia(prefix, path.basename(sourcePath))
  const id = hash.digest('hex')
  const extension = cleanExtension(info.extension)
  const asset: PortableMediaAsset = { id, kind: info.kind, mime: info.mime, extension, bytes: info.bytes, sha256: id, ...(cleanLabel(label) ? { label: cleanLabel(label) } : {}) }
  return { asset: { ...asset, bytes }, source: { path: sourcePath, open: (streamSignal?: AbortSignal) => createReadStream(sourcePath, { signal: streamSignal }) }, sourceName: path.basename(sourcePath) }
}

/**
 * Materialize one already-collected asset for the archive writer and re-prove its content address.
 * Collection and publication are separate reads so a source changed between the picker and the
 * archive cannot be published under the old SHA-256.
 */
export async function readPortableMediaBytes(collected: PortableMediaCollected, signal?: AbortSignal): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  let bytes = 0
  if (collected.data) {
    chunks.push(Buffer.from(collected.data))
    bytes = collected.data.byteLength
  } else if (collected.source) {
    for await (const chunk of collected.source.open(signal)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
      bytes += buffer.byteLength
      if (bytes > PORTABLE_MEDIA_LIMITS.maxAssetBytes) return fail(`Portable media changed beyond its byte limit: ${collected.sourceName}`)
      chunks.push(buffer)
    }
  } else {
    return fail(`Portable media has no durable byte source: ${collected.sourceName}`)
  }
  const data = Buffer.concat(chunks, bytes)
  if (bytes !== collected.asset.bytes || sha256Media(data) !== collected.asset.sha256) {
    return fail(`Portable media changed after selection: ${collected.sourceName}`)
  }
  const inspected = inspectPortableMedia(data.subarray(0, Math.min(data.byteLength, 4096)), collected.sourceName)
  if (inspected.kind !== collected.asset.kind || inspected.mime !== collected.asset.mime || inspected.extension !== collected.asset.extension) {
    return fail(`Portable media signature changed after selection: ${collected.sourceName}`)
  }
  return data
}

/** Read and re-prove bytes immediately before archive publication. */
export async function materializePortableMedia(candidate: PortableMediaCollected, signal?: AbortSignal): Promise<{ asset: PortableMediaAsset; data: Uint8Array }> {
  if (!candidate.source) return fail(`Portable media source is unavailable: ${candidate.sourceName}`)
  await assertPortableMediaPath(candidate.source.path)
  const data = await fs.readFile(candidate.source.path, { signal })
  const inspected = inspectPortableMedia(data, candidate.sourceName)
  const sha256 = sha256Media(data)
  if (sha256 !== candidate.asset.sha256 || data.byteLength !== candidate.asset.bytes || inspected.kind !== candidate.asset.kind || inspected.mime !== candidate.asset.mime) {
    return fail(`Portable media changed after it was inspected: ${candidate.sourceName}`)
  }
  const facts = await parsePortableMediaFacts(data, candidate.asset)
  const asset: PortableMediaAsset = { ...candidate.asset, ...facts }
  validatePortableMediaAsset(asset)
  return { asset, data }
}

function isProjectOwned(projectRoot: string | undefined, sourcePath: string): boolean {
  if (!projectRoot) return false
  const relative = path.relative(path.resolve(projectRoot), path.resolve(sourcePath))
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export interface PortableMediaPreparedItem {
  candidate: PortableMediaCandidate
  collected?: PortableMediaCollected
}

export interface PortableMediaPreparation {
  items: PortableMediaPreparedItem[]
}

/** Inspect selected paths in the privileged host and return only path-free decision rows. */
export async function preparePortableMedia(input: PortableMediaPrepareInput, signal?: AbortSignal): Promise<PortableMediaPreparation> {
  if (!Array.isArray(input.sourcePaths) || input.sourcePaths.length > PORTABLE_MEDIA_LIMITS.maxAssetCount) return fail('Portable media selection exceeds its item bound.')
  const items: PortableMediaPreparedItem[] = []
  const seen = new Set<string>()
  for (const sourcePath of input.sourcePaths) {
    if (typeof sourcePath !== 'string' || sourcePath.length === 0) return fail('Portable media selection contains an invalid path.')
    const sourceName = path.basename(sourcePath) || 'Unavailable media'
    const projectOwned = isProjectOwned(input.projectRoot, sourcePath)
    try {
      const collected = await collectPortableMedia(sourcePath, sourceName, signal)
      const proved = await materializePortableMedia(collected, signal)
      collected.asset = proved.asset
      if (seen.has(collected.asset.id)) continue
      seen.add(collected.asset.id)
      items.push({
        candidate: {
          assetId: collected.asset.id,
          kind: collected.asset.kind,
          label: collected.asset.label ?? sourceName,
          sourceName,
          decision: projectOwned ? 'include' : 'locate-later',
          projectOwned,
          includeEnabled: true
        },
        collected
      })
    } catch (error) {
      const assetId = sha256Media(new TextEncoder().encode(sourceName))
      if (seen.has(assetId)) continue
      seen.add(assetId)
      const reason = error instanceof Error ? error.message : 'Media validation failed.'
      items.push({ candidate: { assetId, kind: 'image', label: sourceName, sourceName, decision: 'locate-later', projectOwned, includeEnabled: false, includeDisabledReason: reason, reason } })
    }
  }
  return { items }
}

export interface PortableMediaArchiveFile { path: string; asset: PortableMediaAsset; data: Uint8Array }
export interface PortableMediaExportPayload { manifest: PortableMediaManifest; files: PortableMediaArchiveFile[] }

/** Match every manifest asset to exactly one parser-proved archive entry before import writes. */
export async function validatePortableMediaArchive(manifestInput: PortableMediaManifest, entries: ReadonlyMap<string, Uint8Array>): Promise<PortableMediaArchiveFile[]> {
  const manifest = validatePortableMediaManifest(manifestInput)
  const expected = new Set<string>()
  const files: PortableMediaArchiveFile[] = []
  for (const asset of manifest.assets) {
    const entryPath = `assets/media/${asset.id}.${asset.extension}`
    if (asset.unresolved) {
      if (entries.has(entryPath)) return fail(`Unresolved portable media unexpectedly carries bytes: ${asset.id}`)
      continue
    }
    const data = entries.get(entryPath)
    if (!data) return fail(`Portable media bytes are missing: ${asset.id}`)
    expected.add(entryPath)
    const inspected = inspectPortableMedia(data, entryPath)
    if (inspected.kind !== asset.kind || inspected.mime !== asset.mime || inspected.extension !== asset.extension || inspected.bytes !== asset.bytes || sha256Media(data) !== asset.sha256) return fail(`Portable media bytes do not match their manifest: ${asset.id}`)
    const facts = await parsePortableMediaFacts(data, asset)
    for (const key of ['width', 'height', 'durationMs', 'frames'] as const) {
      if (facts[key] !== asset[key]) return fail(`Portable media parser facts do not match ${key}: ${asset.id}`)
    }
    files.push({ path: entryPath, asset, data })
  }
  for (const entryPath of entries.keys()) {
    if (entryPath.startsWith('assets/media/') && !expected.has(entryPath)) return fail(`Portable media archive contains an unreferenced entry: ${entryPath}`)
  }
  return files
}

/** Resolve a single-use preparation into a manifest plus parser-proved archive bytes. */
export async function resolvePortableMediaPreparation(preparation: PortableMediaPreparation, decisions: readonly PortableMediaDecisionRecord[], signal?: AbortSignal): Promise<PortableMediaExportPayload> {
  const chosen = new Map<string, PortableMediaDecision>()
  for (const item of decisions) {
    if (!item || typeof item.assetId !== 'string' || !['include', 'omit', 'locate-later'].includes(item.decision) || chosen.has(item.assetId)) return fail('Portable media decisions are invalid or duplicated.')
    chosen.set(item.assetId, item.decision)
  }
  const assets: PortableMediaAsset[] = []
  const omissions: PortableMediaOmission[] = []
  const files: PortableMediaArchiveFile[] = []
  for (const item of preparation.items) {
    const decision = chosen.get(item.candidate.assetId) ?? item.candidate.decision
    if (decision === 'include') {
      if (!item.candidate.includeEnabled || !item.collected) return fail(`Portable media cannot be included: ${item.candidate.sourceName}`)
      const materialized = await materializePortableMedia(item.collected, signal)
      assets.push(materialized.asset)
      files.push({ path: `assets/media/${materialized.asset.id}.${materialized.asset.extension}`, asset: materialized.asset, data: materialized.data })
    } else if (decision === 'locate-later') {
      const base = item.collected?.asset
      assets.push(base ? { ...base, unresolved: true } : placeholderPortableMedia(item.candidate.assetId, item.candidate.kind, item.candidate.label))
    } else {
      omissions.push({ assetId: item.candidate.assetId, decision: 'omit', reason: 'user-choice', detail: 'The user chose not to include this media asset.' })
    }
  }
  if ([...chosen.keys()].some((assetId) => !preparation.items.some((item) => item.candidate.assetId === assetId))) return fail('Portable media decisions contain an unknown asset.')
  return { manifest: createPortableMediaManifest(assets, omissions), files }
}

export function placeholderPortableMedia(assetId: string, kind: PortableMediaKind, label: string): PortableMediaAsset {
  if (!SHA256.test(assetId)) return fail('Portable media placeholder has an invalid content address.')
  const safeLabel = cleanLabel(label)
  return { id: assetId, kind, mime: 'application/octet-stream', extension: 'bin', bytes: 0, sha256: assetId, ...(safeLabel ? { label: safeLabel } : {}), unresolved: true }
}

export function createPortableMediaManifest(assets: readonly PortableMediaAsset[], omissions: readonly PortableMediaOmission[] = []): PortableMediaManifest {
  if (assets.length > PORTABLE_MEDIA_LIMITS.maxAssetCount) return fail('Portable media asset count exceeds its bound.')
  const ids = new Set<string>()
  const foldedIds = new Set<string>()
  for (const asset of assets) {
    validatePortableMediaAsset(asset)
    if (ids.has(asset.id)) return fail(`Duplicate portable media content address: ${asset.id}`)
    if (foldedIds.has(asset.id.toLowerCase())) return fail(`Case-colliding portable media content address: ${asset.id}`)
    ids.add(asset.id)
    foldedIds.add(asset.id.toLowerCase())
  }
  if (omissions.length > PORTABLE_MEDIA_LIMITS.maxAssetCount) return fail('Portable media omission count exceeds its bound.')
  const omissionIds = new Set<string>(); const foldedOmissionIds = new Set<string>()
  for (const omission of omissions) {
    if (!SHA256.test(omission.assetId) || !['omit', 'locate-later'].includes(omission.decision) || !['user-choice', 'missing', 'unsupported', 'validation-failed', 'machine-local'].includes(omission.reason) || typeof omission.detail !== 'string' || omission.detail.length === 0 || utf8Bytes(omission.detail) > 1024) return fail('Portable media omission is invalid.')
    if (ids.has(omission.assetId)) return fail(`Portable media omission contradicts an included asset: ${omission.assetId}`)
    if (omissionIds.has(omission.assetId)) return fail(`Duplicate portable media omission: ${omission.assetId}`)
    if (foldedOmissionIds.has(omission.assetId.toLowerCase())) return fail(`Case-colliding portable media omission: ${omission.assetId}`)
    omissionIds.add(omission.assetId); foldedOmissionIds.add(omission.assetId.toLowerCase())
  }
  return { format: PORTABLE_PROJECT_SCHEMA, schemaVersion: PORTABLE_PROJECT_SCHEMA_VERSION, assets: [...assets].sort((a, b) => a.id.localeCompare(b.id)), omissions: [...omissions].sort((a, b) => a.assetId.localeCompare(b.assetId) || a.decision.localeCompare(b.decision)) }
}

export function validatePortableMediaAsset(asset: unknown): asserts asset is PortableMediaAsset {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) return fail('Portable media asset is not an object.')
  exactKeys(asset as Record<string, unknown>, ASSET_KEYS, 'asset')
  const value = asset as PortableMediaAsset
  if (!SHA256.test(value.id) || value.sha256 !== value.id || !['image', 'audio', 'video'].includes(value.kind) || typeof value.mime !== 'string' || utf8Bytes(value.mime) > PORTABLE_MEDIA_LIMITS.maxMimeBytes || !/^[\w.+-]+\/[\w.+-]+$/.test(value.mime) || cleanExtension(value.extension) === undefined || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > PORTABLE_MEDIA_LIMITS.maxAssetBytes || (value.unresolved !== true && value.bytes === 0)) return fail(`Portable media asset is invalid: ${value.id}`)
  cleanLabel(value.label)
  for (const key of ['width', 'height', 'durationMs', 'frames'] as const) if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 0x7fffffff)) return fail(`Portable media ${key} is invalid: ${value.id}`)
}

export function validatePortableMediaManifest(value: unknown): PortableMediaManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Portable media manifest is not an object.')
  exactKeys(value as Record<string, unknown>, MANIFEST_KEYS, 'manifest')
  const manifest = value as PortableMediaManifest
  if (manifest.format !== PORTABLE_PROJECT_SCHEMA || manifest.schemaVersion !== PORTABLE_PROJECT_SCHEMA_VERSION || !Array.isArray(manifest.assets) || !Array.isArray(manifest.omissions)) return fail('Portable media manifest must use schema 3.')
  const assets = manifest.assets.map((asset) => { validatePortableMediaAsset(asset); return { id: asset.id, kind: asset.kind, mime: asset.mime, extension: cleanExtension(asset.extension), bytes: asset.bytes, sha256: asset.sha256, ...(asset.label !== undefined ? { label: cleanLabel(asset.label) } : {}), ...(asset.width !== undefined ? { width: asset.width } : {}), ...(asset.height !== undefined ? { height: asset.height } : {}), ...(asset.durationMs !== undefined ? { durationMs: asset.durationMs } : {}), ...(asset.frames !== undefined ? { frames: asset.frames } : {}), ...(asset.unresolved ? { unresolved: true } : {}) } })
  const omissions = manifest.omissions.map((omission) => {
    if (!omission || typeof omission !== 'object' || Array.isArray(omission)) return fail('Portable media omission is not an object.')
    exactKeys(omission as Record<string, unknown>, OMISSION_KEYS, 'omission')
    return { assetId: omission.assetId, decision: omission.decision, reason: omission.reason, detail: omission.detail }
  })
  return createPortableMediaManifest(assets, omissions)
}

export function serializePortableMediaManifest(value: PortableMediaManifest): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(validatePortableMediaManifest(value), null, 2))
  if (bytes.byteLength > PORTABLE_MEDIA_LIMITS.maxManifestBytes) return fail('Portable media manifest exceeds its byte bound.')
  return bytes
}

export function parsePortableMediaManifest(bytes: Uint8Array): PortableMediaManifest {
  if (bytes.byteLength > PORTABLE_MEDIA_LIMITS.maxManifestBytes) return fail('Portable media manifest exceeds its byte bound.')
  try { return validatePortableMediaManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))) } catch (error) { if (error instanceof PortableProjectV3Error) throw error; return fail('Portable media manifest is not valid UTF-8 JSON.') }
}

/** Apply Include/Omit/Locate Later decisions. Locate Later leaves a truthful placeholder. */
export function applyPortableMediaDecisions(candidates: readonly PortableMediaCollected[], decisions: ReadonlyMap<string, PortableMediaDecision>): { assets: PortableMediaCollected[]; omissions: PortableMediaOmission[] } {
  const assets: PortableMediaCollected[] = []
  const omissions: PortableMediaOmission[] = []
  for (const candidate of candidates) {
    const decision = decisions.get(candidate.asset.id) ?? 'include'
    if (decision === 'include') assets.push(candidate)
    else if (decision === 'locate-later') assets.push({ ...candidate, asset: { ...candidate.asset, unresolved: true }, data: undefined, source: undefined })
    else omissions.push({ assetId: candidate.asset.id, decision: 'omit', reason: 'user-choice', detail: 'The user chose not to include this media asset.' })
  }
  return { assets, omissions }
}
