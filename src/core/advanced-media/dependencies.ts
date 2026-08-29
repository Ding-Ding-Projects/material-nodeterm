import { createHash } from 'node:crypto'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { removeAtomic, renameAtomic, tempNameFor } from '../fs-atomic'
import type { AdvancedMediaDependencyId, VerifiedMediaDependency } from '../../shared/advanced-media'

const SHA256 = /^[0-9a-f]{64}$/i
const MAX_DEPENDENCY_BYTES = 512 * 1024 * 1024

export interface MediaDependencySpec extends VerifiedMediaDependency {
  /** Maximum download size accepted for this dependency. */
  maxBytes?: number
}

export interface MediaDependencyManagerOptions {
  root: string
  /** A per-install manifest is supplied by the signed application package, never by the renderer. */
  manifest: readonly MediaDependencySpec[]
}

function assertSpec(spec: MediaDependencySpec): void {
  if (!/^[a-z][a-z0-9-]{1,48}$/.test(spec.id)) throw new Error(`Invalid media dependency id: ${spec.id}`)
  if (!SHA256.test(spec.sha256)) throw new Error(`Dependency ${spec.id} has no valid SHA-256 digest.`)
  let url: URL
  try {
    url = new URL(spec.sourceUrl)
  } catch {
    throw new Error(`Dependency ${spec.id} has an invalid source URL.`)
  }
  if (url.protocol !== 'https:') throw new Error(`Dependency ${spec.id} must use an HTTPS source.`)
  if (!spec.executable || spec.executable.includes('/') || spec.executable.includes('\\')) {
    throw new Error(`Dependency ${spec.id} has an unsafe executable name.`)
  }
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function pathInside(root: string, file: string): boolean {
  const base = resolve(root) + sep
  return resolve(file).startsWith(base)
}

/**
 * Owns only application-private, digest-pinned tools. It never searches PATH, accepts an arbitrary
 * URL, invokes an installer, or places a downloaded file in the checkout. The caller can ask for
 * an install only after the packaged manifest supplies the exact URL, version, executable name,
 * and digest.
 */
export class MediaDependencyManager {
  private readonly byId = new Map<AdvancedMediaDependencyId, MediaDependencySpec>()
  private readonly root: string

  constructor(opts: MediaDependencyManagerOptions) {
    this.root = resolve(opts.root)
    for (const spec of opts.manifest) {
      assertSpec(spec)
      if (this.byId.has(spec.id)) throw new Error(`Duplicate media dependency ${spec.id}.`)
      this.byId.set(spec.id, spec)
    }
  }

  catalog(verifiedIds: ReadonlySet<AdvancedMediaDependencyId> = new Set()): VerifiedMediaDependency[] {
    return [...this.byId.values()].map((spec) => ({ ...spec, verified: verifiedIds.has(spec.id) }))
  }

  spec(id: AdvancedMediaDependencyId): MediaDependencySpec | undefined {
    return this.byId.get(id)
  }

  declaredIds(): Set<AdvancedMediaDependencyId> {
    return new Set(this.byId.keys())
  }

  private executablePath(spec: MediaDependencySpec): string {
    const file = join(this.root, spec.executable)
    if (!pathInside(this.root, file)) throw new Error(`Dependency ${spec.id} resolves outside its private tool directory.`)
    return file
  }

  async verify(id: AdvancedMediaDependencyId): Promise<{ ok: true; path: string; dependency: VerifiedMediaDependency } | { ok: false; error: string }> {
    const spec = this.byId.get(id)
    if (!spec) return { ok: false, error: `No verified manifest entry exists for ${id}.` }
    const file = this.executablePath(spec)
    try {
      const st = await stat(file)
      if (!st.isFile()) return { ok: false, error: `The verified ${id} path is not a regular file.` }
      if (st.size > (spec.maxBytes ?? MAX_DEPENDENCY_BYTES)) return { ok: false, error: `The verified ${id} file exceeds its size limit.` }
      const bytes = await readFile(file)
      const actual = digest(bytes)
      if (actual !== spec.sha256.toLowerCase()) return { ok: false, error: `The ${id} digest does not match the packaged manifest.` }
      return { ok: true, path: file, dependency: { ...spec, verified: true } }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { ok: false, error: `The verified ${id} tool is not installed yet.` }
      return { ok: false, error: `Could not verify ${id}: ${(error as Error).message}` }
    }
  }

  /** Download one manifest-pinned tool into the private cache, then verify the resulting bytes. */
  async ensure(id: AdvancedMediaDependencyId, signal?: AbortSignal): Promise<{ path: string; dependency: VerifiedMediaDependency }> {
    const spec = this.byId.get(id)
    if (!spec) throw new Error(`No verified manifest entry exists for ${id}.`)
    const existing = await this.verify(id)
    if (existing.ok) return existing
    await mkdir(this.root, { recursive: true })
    const response = await fetch(spec.sourceUrl, { signal, redirect: 'error' })
    if (!response.ok) throw new Error(`Could not download ${id}: HTTPS ${response.status}.`)
    const limit = spec.maxBytes ?? MAX_DEPENDENCY_BYTES
    const declared = response.headers.get('content-length')
    if (declared && Number(declared) > limit) throw new Error(`The ${id} download exceeds its size limit.`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length > limit) throw new Error(`The ${id} download exceeds its size limit.`)
    if (digest(bytes) !== spec.sha256.toLowerCase()) throw new Error(`The downloaded ${id} digest does not match the packaged manifest.`)
    const file = this.executablePath(spec)
    const tmp = tempNameFor(file)
    try {
      await writeFile(tmp, bytes, { flag: 'wx', mode: 0o700 })
      await renameAtomic(tmp, file)
    } finally {
      await removeAtomic(tmp).catch(() => {})
    }
    const verified = await this.verify(id)
    if (!verified.ok) throw new Error(verified.error)
    return verified
  }

  async isWritable(): Promise<boolean> {
    try {
      await mkdir(this.root, { recursive: true })
      await access(this.root, fsConstants.W_OK)
      return true
    } catch {
      return false
    }
  }
}

export function executableNameForDependency(id: AdvancedMediaDependencyId): string {
  return id === 'ffprobe' ? 'ffprobe.exe' : id === 'tesseract' ? 'tesseract.exe' : 'pdftoppm.exe'
}

export function dependencyFileName(spec: Pick<MediaDependencySpec, 'executable'>): string {
  return basename(spec.executable)
}
