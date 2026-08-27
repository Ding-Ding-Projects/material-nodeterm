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

export type PortableMediaKind = 'image' | 'audio' | 'video'
export type PortableMediaDecision = 'include' | 'omit' | 'locate-later'

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

export interface PortableMediaCandidate {
  assetId: string
  kind: PortableMediaKind
  label: string
  sourceName: string
  decision: PortableMediaDecision
  reason?: string
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
const ASSET_KEYS = new Set(['id', 'kind', 'mime', 'extension', 'bytes', 'sha256', 'label', 'width', 'height', 'durationMs', 'unresolved'])
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
  const stat = await fs.lstat(sourcePath)
  if (!stat.isFile()) return fail(`Portable media source is not a regular file: ${path.basename(sourcePath)}`)
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
  for (const key of ['width', 'height', 'durationMs'] as const) if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 0x7fffffff)) return fail(`Portable media ${key} is invalid: ${value.id}`)
}

export function validatePortableMediaManifest(value: unknown): PortableMediaManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Portable media manifest is not an object.')
  exactKeys(value as Record<string, unknown>, MANIFEST_KEYS, 'manifest')
  const manifest = value as PortableMediaManifest
  if (manifest.format !== PORTABLE_PROJECT_SCHEMA || manifest.schemaVersion !== PORTABLE_PROJECT_SCHEMA_VERSION || !Array.isArray(manifest.assets) || !Array.isArray(manifest.omissions)) return fail('Portable media manifest must use schema 3.')
  const assets = manifest.assets.map((asset) => { validatePortableMediaAsset(asset); return { id: asset.id, kind: asset.kind, mime: asset.mime, extension: cleanExtension(asset.extension), bytes: asset.bytes, sha256: asset.sha256, ...(asset.label !== undefined ? { label: cleanLabel(asset.label) } : {}), ...(asset.width !== undefined ? { width: asset.width } : {}), ...(asset.height !== undefined ? { height: asset.height } : {}), ...(asset.durationMs !== undefined ? { durationMs: asset.durationMs } : {}), ...(asset.unresolved ? { unresolved: true } : {}) } })
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
    else omissions.push({ assetId: candidate.asset.id, decision, reason: decision === 'omit' ? 'user-choice' : 'machine-local', detail: decision === 'omit' ? 'The user chose not to include this media asset.' : 'The source is machine-local and can be selected later on the destination computer.' })
  }
  return { assets, omissions }
}
