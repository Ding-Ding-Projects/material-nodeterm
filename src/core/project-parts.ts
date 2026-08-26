// Splitting a project's .nodeterm/project.json into sized PARTS + a manifest, instead of one
// ever-growing file.
//
// WHY: a canvas grows without bound as a user keeps adding nodes, and other work in flight makes
// projects carry more per node than before. A single JSON file that grows unboundedly eventually
// becomes slow to write, awkward for git to diff, and painful to review. Splitting it into
// sized parts with a manifest fixes that, at a size the user picks (in KB, MB or GB).
//
// This module is a STORAGE ENCODING for the exact same content `project.json` already carries
// (a `ProjectFileV1`, serialized). It knows nothing about project semantics — that stays in
// workspace-files.ts. It only knows how to turn a byte string into a manifest + numbered part
// files, and how to turn that back into the original bytes, either successfully or with an exact,
// closed reason why not.
//
// FAIL-CLOSED IS THE WHOLE POINT of this file. `.nodeterm/project.json` is a git-shared, hand-
// editable document (see workspace-files.ts's header comment) — a user can delete a part file, a
// git merge can drop one, a disk can truncate one. The single most dangerous failure mode here is
// silently loading a TRUNCATED canvas and then saving over the original, complete one — so every
// read verifies size AND hash per part, AND the full reassembled content hash, before handing back
// a single byte. Any mismatch is reported with its exact cause and the caller is left able to
// leave the previous save on disk untouched (see `readProjectParts`'s doc comment).
//
// WRITING IS ALL-OR-NOTHING via a generation directory, the same "unique temp, then one atomic
// publish" shape as fs-atomic.ts uses for a single file:
//   1. Write every part into a freshly-named, unreferenced generation directory
//      (.nodeterm/parts/<uuid>/part-0001.bin, …). Nothing on disk points at this directory yet,
//      so a crash here leaves the OLD manifest (if any) pointing at the OLD generation, untouched.
//   2. Re-read every part back and verify size + hash — catches a write that silently truncated on
//      a full disk or a killed process.
//   3. Publish the manifest (.nodeterm/project.parts.json) via the existing atomic
//      writeFileAtomic/renameAtomic primitives. This is the single moment the new generation
//      becomes "the save": before this line, the old complete save (old manifest + old generation
//      dir, or an old single-file project.json) is exactly as it was.
//   4. Only AFTER that publish succeeds, best-effort delete the previous generation directory and
//      sweep any other stray generation directories (crash litter from an earlier interrupted
//      save). A crash between 3 and 4 just leaves litter for the next save to sweep — it never
//      leaves two live generations that a reader could get confused between, because the manifest
//      names exactly one generation.
//
// BACKWARD/FORWARD COMPATIBILITY: an older nodeterm build reads `.nodeterm/project.json` directly
// and knows nothing about `.nodeterm/project.parts.json` or the `parts/` directory. Once a project
// is split, an OLDER BUILD SEES NO project.json AT ALL for that folder — the same as a freshly
// created folder with no file yet — so it treats the project as new/empty rather than corrupting
// anything. That is the honest answer and it is stated in the caller-facing docs deliberately: an
// older build cannot read a split project, and the split is therefore something the user opts into
// per project, not something silently turned on under an old build's feet. Joining back
// (`joinPartsToSingleFile`) restores the plain `project.json` an old build expects, byte for byte.

import { promises as fs } from 'fs'
import { createHash, randomUUID } from 'crypto'
import path from 'path'
import { writeFileAtomic } from './fs-atomic'

export const PARTS_MANIFEST_FILE = 'project.parts.json'
export const PARTS_SUBDIR = 'parts'

/** One part's own record in the manifest. `bytes` and `sha256` are computed from the part's raw
 *  bytes, independent of what the reassembled JSON says — a reader checks both before trusting a
 *  single byte of content. */
export interface ProjectPartRecord {
  name: string
  bytes: number
  sha256: string
}

/** On-disk shape of `.nodeterm/project.parts.json`. Content-addressed by `contentHash` — the
 *  sha256 of the FULL reassembled bytes — so a manifest whose per-part hashes are individually
 *  correct but were reordered, duplicated or reused from a different save is still caught. */
export interface ProjectPartsManifestV1 {
  version: 1
  /** Directory name under `.nodeterm/parts/` holding this generation's part files. Unique per
   *  successful publish (never reused), so an old generation left as litter after a crash can
   *  never be mistaken for the current one. */
  generation: string
  rev: number
  savedAt: string
  /** The target size a caller asked for when this generation was written (not necessarily every
   *  part's exact size — the last part is usually smaller). Recorded so a later save that does not
   *  carry an explicit size can reuse the project's last-chosen one instead of silently reverting
   *  to a default. */
  partSizeBytes: number
  partCount: number
  totalBytes: number
  /** sha256 (hex) of the full reassembled content, in part order. */
  contentHash: string
  /** In on-disk part order. Never re-sorted by a reader — order carries meaning. */
  parts: ProjectPartRecord[]
}

export type PartSizeUnit = 'KB' | 'MB' | 'GB'

const UNIT_BYTES: Record<PartSizeUnit, number> = { KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 }

/** Smallest a user may choose: below this a modest project turns into hundreds of tiny files for
 *  no benefit. Largest: above this "parts" stops meaningfully bounding a single write/diff. Both
 *  are clamps, not silent rejections — a value outside them is pulled back in, never thrown. */
export const MIN_PART_SIZE_BYTES = 4 * 1024 // 4 KB
export const MAX_PART_SIZE_BYTES = 1024 * 1024 * 1024 // 1 GB

/** Turns a user-entered (value, unit) into a clamped byte count. Never throws — a negative,
 *  zero, non-finite or absurd value is pulled into range rather than rejected, because this reads
 *  a persisted setting that may be hand-edited (same hostile-input posture as project.json). */
export function partSizeBytesFromSetting(value: number, unit: PartSizeUnit): number {
  const raw = Number.isFinite(value) && value > 0 ? value : 1
  const bytes = Math.round(raw * (UNIT_BYTES[unit] ?? UNIT_BYTES.KB))
  return Math.min(MAX_PART_SIZE_BYTES, Math.max(MIN_PART_SIZE_BYTES, bytes))
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function partsDir(cwd: string, generation: string): string {
  return path.join(cwd, '.nodeterm', PARTS_SUBDIR, generation)
}

function manifestPath(cwd: string): string {
  return path.join(cwd, '.nodeterm', PARTS_MANIFEST_FILE)
}

function partName(index: number): string {
  // Zero-padded to 4 digits: readable, sorts correctly by name up to 9999 parts, and a count past
  // that is far beyond MAX_PART_SIZE_BYTES's floor being useful anyway.
  return `part-${String(index + 1).padStart(4, '0')}.bin`
}

/**
 * Splits `content` (the full serialized project.json bytes) into ordered byte-range chunks of
 * (at most) `partSizeBytes` each.
 *
 * Splits are done on the RAW BUFFER, never on the decoded string — slicing a UTF-8 string at an
 * arbitrary byte offset can cut a multi-byte character in half (a project name, a sticky note, or
 * a Cantonese commit-message aside all round-trip through this file). Concatenating the buffers
 * back in order before decoding is always safe regardless of where the cuts fall; only the FINAL
 * decode needs to see whole characters, and it does.
 */
export function splitBuffer(content: Buffer, partSizeBytes: number): Buffer[] {
  const size = Math.max(1, Math.floor(partSizeBytes))
  if (content.length === 0) return [Buffer.alloc(0)]
  const parts: Buffer[] = []
  for (let offset = 0; offset < content.length; offset += size) {
    parts.push(content.subarray(offset, Math.min(offset + size, content.length)))
  }
  return parts
}

export type ProjectPartsWriteResult =
  | { ok: true; manifest: ProjectPartsManifestV1 }
  | { ok: false; reason: 'write-failed' | 'verify-failed'; detail: string }

/**
 * Writes `content` (the serialized project file) as sized parts under `cwd/.nodeterm/`, all or
 * nothing.
 *
 * On success, `.nodeterm/project.parts.json` names the new generation and every part it wrote,
 * and the previous generation's directory has been removed (best-effort — see the file header).
 * On failure, nothing published changes: any partial new-generation directory is removed, and the
 * OLD manifest (if any) still points at the OLD, untouched generation.
 */
export async function writeProjectParts(
  cwd: string,
  content: string,
  partSizeBytes: number,
  rev: number,
  savedAt: string
): Promise<ProjectPartsWriteResult> {
  const buf = Buffer.from(content, 'utf-8')
  const chunks = splitBuffer(buf, partSizeBytes)
  const generation = randomUUID()
  const dir = partsDir(cwd, generation)

  const records: ProjectPartRecord[] = chunks.map((chunk, i) => ({
    name: partName(i),
    bytes: chunk.length,
    sha256: sha256Hex(chunk)
  }))

  try {
    await fs.mkdir(dir, { recursive: true })
    for (let i = 0; i < chunks.length; i++) {
      await fs.writeFile(path.join(dir, records[i].name), chunks[i])
    }
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    return { ok: false, reason: 'write-failed', detail: String(e) }
  }

  // Verify every part was actually persisted correctly before this generation is ever named by a
  // published manifest — catches a write truncated by a full disk or a killed process mid-write.
  for (const rec of records) {
    try {
      const on = await fs.readFile(path.join(dir, rec.name))
      if (on.length !== rec.bytes || sha256Hex(on) !== rec.sha256) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
        return { ok: false, reason: 'verify-failed', detail: `part ${rec.name} did not verify after write` }
      }
    } catch (e) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
      return { ok: false, reason: 'verify-failed', detail: String(e) }
    }
  }

  const manifest: ProjectPartsManifestV1 = {
    version: 1,
    generation,
    rev,
    savedAt,
    partSizeBytes,
    partCount: records.length,
    totalBytes: buf.length,
    contentHash: sha256Hex(buf),
    parts: records
  }

  // Read whatever generation the PREVIOUS manifest pointed at (if any), before we overwrite it —
  // this is what we clean up once, and only once, the new manifest is safely published.
  const previousGeneration = await readManifestGenerationOnly(cwd)

  try {
    await writeFileAtomic(manifestPath(cwd), JSON.stringify(manifest, null, 2))
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    return { ok: false, reason: 'write-failed', detail: String(e) }
  }

  // The new generation is now the one and only thing the manifest names. Everything else under
  // parts/ is litter: the previous generation (normal case) plus anything left behind by an
  // earlier interrupted save that never got this far. Best-effort — a failure to clean up costs
  // disk space, never correctness, since nothing unreferenced by the manifest is ever read.
  await sweepUnreferencedGenerations(cwd, generation).catch(() => undefined)
  if (previousGeneration && previousGeneration !== generation) {
    await fs.rm(partsDir(cwd, previousGeneration), { recursive: true, force: true }).catch(() => undefined)
  }

  return { ok: true, manifest }
}

async function readManifestGenerationOnly(cwd: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(manifestPath(cwd), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<ProjectPartsManifestV1>
    return typeof parsed?.generation === 'string' ? parsed.generation : null
  } catch {
    return null
  }
}

/** Removes every generation directory under `.nodeterm/parts/` except `keep` — crash litter from
 *  an interrupted earlier save, or (called from `joinPartsToSingleFile`) everything at once. */
async function sweepUnreferencedGenerations(cwd: string, keep: string | null): Promise<void> {
  const root = path.join(cwd, '.nodeterm', PARTS_SUBDIR)
  let entries: string[]
  try {
    entries = await fs.readdir(root)
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry === keep) continue
    await fs.rm(path.join(root, entry), { recursive: true, force: true }).catch(() => undefined)
  }
}

export type ProjectPartsReadFailureReason =
  | 'no-manifest'
  | 'invalid-manifest'
  | 'missing-part'
  | 'size-mismatch'
  | 'hash-mismatch'
  | 'content-hash-mismatch'
  | 'decode-failed'

export type ProjectPartsReadResult =
  | { ok: true; raw: string; manifest: ProjectPartsManifestV1 }
  | { ok: false; reason: ProjectPartsReadFailureReason; detail: string }

/** True only when `.nodeterm/project.parts.json` exists and parses to something with a
 *  `generation` string — the cheap "is this project stored as parts" test, used before deciding
 *  which reader to run. It does NOT validate the parts themselves; `readProjectParts` does that. */
export async function hasPartsManifest(cwd: string): Promise<boolean> {
  return (await readManifestGenerationOnly(cwd)) !== null
}

/** The `partSizeBytes` an existing manifest was last written with, or `null` when there is no
 *  manifest, it does not parse, or it fails full verification (never trust a size drawn from a
 *  manifest we would otherwise refuse to read). A save that wants to keep an already-split
 *  project split, without threading a chosen size through every call, reads this first. */
export async function lastPartSizeBytes(cwd: string): Promise<number | null> {
  const read = await readProjectParts(cwd)
  return read.ok ? read.manifest.partSizeBytes : null
}

function validManifestShape(v: unknown): v is ProjectPartsManifestV1 {
  if (!v || typeof v !== 'object') return false
  const m = v as Partial<ProjectPartsManifestV1>
  return (
    m.version === 1 &&
    typeof m.generation === 'string' &&
    m.generation.length > 0 &&
    typeof m.rev === 'number' &&
    typeof m.savedAt === 'string' &&
    typeof m.partSizeBytes === 'number' &&
    typeof m.partCount === 'number' &&
    typeof m.totalBytes === 'number' &&
    typeof m.contentHash === 'string' &&
    Array.isArray(m.parts) &&
    m.parts.every(
      (p) =>
        p &&
        typeof p.name === 'string' &&
        typeof p.bytes === 'number' &&
        typeof p.sha256 === 'string'
    )
  )
}

/**
 * Reads and fully verifies a parts-encoded project, reassembling the original serialized bytes.
 *
 * FAILS CLOSED on the first thing that does not check out: a missing part, a part whose size or
 * hash disagrees with the manifest, a reassembled content whose hash disagrees with the manifest's
 * `contentHash`, or bytes that do not decode to valid UTF-8/JSON-shaped text. Every failure names
 * exactly what went wrong so the caller can report it rather than guess, and — critically — never
 * returns partial content. A caller that gets `ok:false` here MUST treat the project the same way
 * an unreadable/corrupt single-file project.json is already treated (unavailable, not silently
 * emptied and re-saved over the original).
 */
export async function readProjectParts(cwd: string): Promise<ProjectPartsReadResult> {
  let manifestRaw: string
  try {
    manifestRaw = await fs.readFile(manifestPath(cwd), 'utf-8')
  } catch {
    return { ok: false, reason: 'no-manifest', detail: 'no project.parts.json' }
  }
  let manifest: ProjectPartsManifestV1
  try {
    const parsed = JSON.parse(manifestRaw)
    if (!validManifestShape(parsed)) {
      return { ok: false, reason: 'invalid-manifest', detail: 'manifest does not match the expected shape' }
    }
    manifest = parsed
  } catch (e) {
    return { ok: false, reason: 'invalid-manifest', detail: String(e) }
  }

  const dir = partsDir(cwd, manifest.generation)
  const buffers: Buffer[] = []
  for (const rec of manifest.parts) {
    let buf: Buffer
    try {
      buf = await fs.readFile(path.join(dir, rec.name))
    } catch (e) {
      return { ok: false, reason: 'missing-part', detail: `${rec.name}: ${String(e)}` }
    }
    if (buf.length !== rec.bytes) {
      return {
        ok: false,
        reason: 'size-mismatch',
        detail: `${rec.name}: expected ${rec.bytes} bytes, found ${buf.length}`
      }
    }
    if (sha256Hex(buf) !== rec.sha256) {
      return { ok: false, reason: 'hash-mismatch', detail: `${rec.name}: content hash does not match the manifest` }
    }
    buffers.push(buf)
  }

  const full = Buffer.concat(buffers)
  if (full.length !== manifest.totalBytes) {
    return {
      ok: false,
      reason: 'content-hash-mismatch',
      detail: `reassembled ${full.length} bytes, manifest declares ${manifest.totalBytes}`
    }
  }
  if (sha256Hex(full) !== manifest.contentHash) {
    return { ok: false, reason: 'content-hash-mismatch', detail: 'reassembled content does not match the manifest hash' }
  }

  let raw: string
  try {
    raw = full.toString('utf-8')
    // Buffer#toString never throws on invalid UTF-8 (it substitutes U+FFFD), so a byte-level
    // corruption that happens to preserve length+hash — effectively impossible, but the whole
    // point of this file is not trusting "effectively" — is still caught by the JSON parse a
    // caller performs immediately after. We do a light sanity check here too: reject an empty
    // result for a manifest that declared any bytes at all.
    if (raw.length === 0 && manifest.totalBytes > 0) {
      return { ok: false, reason: 'decode-failed', detail: 'reassembled content decoded to nothing' }
    }
  } catch (e) {
    return { ok: false, reason: 'decode-failed', detail: String(e) }
  }

  return { ok: true, raw, manifest }
}

export interface JoinResult {
  ok: boolean
  detail?: string
}

/**
 * Reverses a split: reads the current parts (fully verified), writes them back out as a single
 * `project.json` via the existing atomic single-file writer, and only THEN removes the manifest
 * and every parts generation directory.
 *
 * Ordering matters for the same reason as `writeProjectParts`: the single file is fully written
 * and renamed into place BEFORE anything parts-shaped is deleted, so a crash mid-join leaves either
 * the old parts encoding intact (crash before the rename) or the new single file plus harmless
 * parts litter (crash after) — never neither.
 */
export async function joinPartsToSingleFile(cwd: string, singleFilePath: string): Promise<JoinResult> {
  const read = await readProjectParts(cwd)
  if (!read.ok) return { ok: false, detail: `${read.reason}: ${read.detail}` }
  try {
    await writeFileAtomic(singleFilePath, read.raw)
  } catch (e) {
    return { ok: false, detail: String(e) }
  }
  await fs.rm(manifestPath(cwd), { force: true }).catch(() => undefined)
  await sweepUnreferencedGenerations(cwd, null).catch(() => undefined)
  await fs.rm(path.join(cwd, '.nodeterm', PARTS_SUBDIR), { recursive: true, force: true }).catch(() => undefined)
  return { ok: true }
}

/**
 * Splits an existing single `project.json` into parts, then removes the single file.
 *
 * Same ordering discipline: the parts encoding is written and verified (`writeProjectParts`
 * already does its own all-or-nothing publish) BEFORE the single file is removed, so a crash
 * mid-split leaves either the original single file intact (crash before removal) or a fully
 * verified parts encoding plus a harmless leftover single file (crash after) — never a state with
 * neither.
 */
export async function splitSingleFileToParts(
  cwd: string,
  singleFilePath: string,
  content: string,
  partSizeBytes: number,
  rev: number,
  savedAt: string
): Promise<ProjectPartsWriteResult> {
  const result = await writeProjectParts(cwd, content, partSizeBytes, rev, savedAt)
  if (!result.ok) return result
  await fs.rm(singleFilePath, { force: true }).catch(() => undefined)
  return result
}

/** Test/inspection helper: the absolute path of a given part file under a manifest's generation. */
export function partFilePath(cwd: string, manifest: ProjectPartsManifestV1, partName: string): string {
  return path.join(partsDir(cwd, manifest.generation), partName)
}

export function manifestFilePath(cwd: string): string {
  return manifestPath(cwd)
}
