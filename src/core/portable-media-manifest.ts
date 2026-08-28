import { PortableProjectV3Error, PORTABLE_PROJECT_SCHEMA, PORTABLE_PROJECT_SCHEMA_VERSION } from './portable-project-v3'
import type { PortableMediaKind } from '../shared/portable-media'

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
