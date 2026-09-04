// Local AWS CLI v2 model discovery and cache. This module reads model files from an installed AWS
// CLI, never runs an AWS operation, never reads credentials, and never performs a network hunt for
// documentation. Official documentation links are deterministic and live in the shared index.

import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname, join, normalize, resolve } from 'node:path'
import { writeFileAtomic } from '../fs-atomic'
import {
  AWS_CLI_INDEX_KIND,
  AWS_CLI_INDEX_VERSION,
  AWS_CLI_LIMITS,
  awsCliHelpArgv,
  emptyAwsCliIndex,
  parseAwsCliModelFiles,
  type AwsCliIndexSnapshot,
  type AwsCliModelFileInput,
  type AwsCliModelFileKind
} from '../../shared/aws-cli'

const CACHE_VERSION = 1
const CACHE_RELATIVE_PATH = join('aws', 'aws-cli-index.json')
const MODEL_FILE_NAMES: ReadonlyMap<string, AwsCliModelFileKind> = new Map([
  ['service-2.json', 'service'],
  ['paginators-1.json', 'paginator'],
  ['waiters-2.json', 'waiter'],
  ['cli.json', 'cli']
])

export interface AwsCliModelDiscovery {
  roots: string[]
  files: AwsCliModelFileInput[]
  skipped: string[]
}

export interface AwsCliIndexLoaderOptions {
  userDataDir: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  now?: () => number
  roots?: readonly string[]
  cachePath?: string
  /** Skip disk discovery for callers that want to display a known offline snapshot. */
  offline?: boolean
}

interface CachedAwsCliIndex {
  version: typeof CACHE_VERSION
  revision: string
  savedAt: number
  snapshot: AwsCliIndexSnapshot
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function envPath(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function candidateRoots(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const explicit = envPath(env, 'AWS_CLI_DATA_DIR')
  const out = explicit ? [explicit] : []
  if (platform === 'win32') {
    const programFiles = envPath(env, 'ProgramFiles')
    const programFilesX86 = envPath(env, 'ProgramFiles(x86)')
    const localAppData = envPath(env, 'LOCALAPPDATA')
    for (const root of [programFiles, programFilesX86, localAppData]) {
      if (root) out.push(join(root, 'Amazon', 'AWSCLIV2'))
    }
  } else if (platform === 'darwin') {
    out.push('/usr/local/aws-cli', '/opt/homebrew/aws-cli')
  } else {
    out.push('/usr/local/aws-cli', '/opt/aws-cli', '/usr/lib/aws-cli')
  }
  return [...new Set(out.map((value) => normalize(value)))]
}

function likelyModelRoot(root: string): string[] {
  return [
    root,
    join(root, 'awscli'),
    join(root, 'awscli', 'data'),
    join(root, 'botocore', 'data'),
    join(root, 'v2', 'current'),
    join(root, 'v2', 'current', 'dist')
  ]
}

async function walk(root: string, files: AwsCliModelFileInput[], skipped: string[], depth = 0): Promise<void> {
  if (depth > 10 || files.length >= AWS_CLI_LIMITS.maxFiles) return
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (files.length >= AWS_CLI_LIMITS.maxFiles) return
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      await walk(path, files, skipped, depth + 1)
      continue
    }
    const kind = MODEL_FILE_NAMES.get(entry.name)
    if (!kind) continue
    try {
      const stat = await lstat(path)
      if (!stat.isFile()) {
        skipped.push(`${path}: not a regular file`)
        continue
      }
      if (stat.size > AWS_CLI_LIMITS.maxFileBytes) {
        skipped.push(`${path}: ${stat.size} bytes exceeds the model limit`)
        continue
      }
      files.push({
        path,
        kind,
        text: await readFile(path, 'utf8'),
        modifiedAt: stat.mtimeMs
      })
    } catch (error) {
      skipped.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/** Discover model files without invoking the AWS CLI or reading any credential file. */
export async function discoverAwsCliModels(options: Pick<AwsCliIndexLoaderOptions, 'env' | 'platform' | 'roots'>): Promise<AwsCliModelDiscovery> {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const roots = [...(options.roots ?? candidateRoots(env, platform))]
  const files: AwsCliModelFileInput[] = []
  const skipped: string[] = []
  const visited = new Set<string>()
  for (const root of roots.flatMap(likelyModelRoot)) {
    const absolute = resolve(root)
    if (visited.has(absolute)) continue
    visited.add(absolute)
    await walk(absolute, files, skipped)
  }
  // One path can contain a mirrored model tree in both the root and a derived child. Keeping the
  // newest file would be a guess, so de-duplicate by absolute path and kind only.
  const deduped = [...new Map(files.map((file) => [`${resolve(file.path)}:${file.kind}`, file])).values()]
  return { roots, files: deduped.slice(0, AWS_CLI_LIMITS.maxFiles), skipped }
}

function revisionFor(files: readonly AwsCliModelFileInput[]): string {
  const hash = createHash('sha256')
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind))) {
    hash.update(file.kind)
    hash.update('\0')
    hash.update(resolve(file.path))
    hash.update('\0')
    hash.update(file.text, 'utf8')
    hash.update('\0')
  }
  return hash.digest('hex')
}

function cachePath(options: AwsCliIndexLoaderOptions): string {
  return options.cachePath ? resolve(options.cachePath) : join(resolve(options.userDataDir), CACHE_RELATIVE_PATH)
}

async function readCache(path: string): Promise<{ cached: CachedAwsCliIndex | null; state: AwsCliIndexSnapshot['cache']; error: string | null }> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : ''
    if (code === 'ENOENT') return { cached: null, state: { state: 'missing', path, error: null }, error: null }
    return { cached: null, state: { state: 'unreadable', path, error: error instanceof Error ? error.message : String(error) }, error: error instanceof Error ? error.message : String(error) }
  }
  try {
    const value: unknown = JSON.parse(raw)
    const object = isRecord(value) ? value : null
    const snapshot = object && isRecord(object.snapshot) ? object.snapshot : null
    if (!object || object.version !== CACHE_VERSION || typeof object.revision !== 'string' || !snapshot) {
      throw new Error('unexpected AWS CLI cache shape')
    }
    if (snapshot.kind !== AWS_CLI_INDEX_KIND || snapshot.version !== AWS_CLI_INDEX_VERSION || !Array.isArray(snapshot.services)) {
      throw new Error('unsupported AWS CLI cache version')
    }
    return { cached: value as unknown as CachedAwsCliIndex, state: { state: 'loaded', path, error: null }, error: null }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { cached: null, state: { state: 'invalid', path, error: detail }, error: detail }
  }
}

async function saveCache(path: string, snapshot: AwsCliIndexSnapshot, revision: string, savedAt: number): Promise<string | null> {
  const payload: CachedAwsCliIndex = { version: CACHE_VERSION, revision, savedAt, snapshot }
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFileAtomic(path, JSON.stringify(payload))
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function decorate(snapshot: AwsCliIndexSnapshot, fields: Partial<AwsCliIndexSnapshot>): AwsCliIndexSnapshot {
  return { ...snapshot, ...fields, cache: fields.cache ?? snapshot.cache, revision: fields.revision ?? snapshot.revision, completeness: fields.completeness ?? snapshot.completeness }
}

/** Load the installed AWS CLI model index, with a cache-only fallback for offline use. */
export async function loadAwsCliIndex(options: AwsCliIndexLoaderOptions): Promise<AwsCliIndexSnapshot> {
  const now = options.now ?? (() => Date.now())
  const path = cachePath(options)
  const cache = await readCache(path)
  if (options.offline) {
    if (cache.cached) {
      return decorate(cache.cached.snapshot, {
        source: 'cache',
        state: cache.cached.snapshot.state === 'complete' ? 'stale' : cache.cached.snapshot.state,
        cache: { state: 'loaded', path, error: null },
        error: 'Offline mode is active. This index is the last cached model snapshot.'
      })
    }
    return emptyAwsCliIndex('Offline mode is active and no AWS CLI model cache is available.', cache.state)
  }

  const discovery = await discoverAwsCliModels(options)
  if (discovery.files.length === 0) {
    if (cache.cached) {
      const stale = decorate(cache.cached.snapshot, {
        source: 'cache',
        state: 'stale',
        cache: { state: 'loaded', path, error: null },
        error: discovery.skipped.length > 0
          ? `Installed AWS CLI models could not be read. Using the cached index. ${discovery.skipped.slice(0, 3).join('; ')}`
          : 'No installed AWS CLI model files were found. Using the cached index.'
      })
      return stale
    }
    return emptyAwsCliIndex(
      discovery.skipped.length > 0
        ? `No readable AWS CLI model files were found. ${discovery.skipped.slice(0, 3).join('; ')}`
        : 'No installed AWS CLI model files were found. Install AWS CLI v2 or configure AWS_CLI_DATA_DIR.',
      cache.state
    )
  }

  const revision = revisionFor(discovery.files)
  const parsed = parseAwsCliModelFiles(discovery.files, now())
  const revisionInfo = { value: revision, kind: 'exact' as const, observedAt: now(), files: discovery.files.length }
  const revised = decorate(parsed, { revision: revisionInfo })
  const cacheError = await saveCache(path, revised, revision, now())
  return decorate(revised, {
    source: cache.cached ? 'mixed' : 'installed',
    state: parsed.completeness.state === 'complete' ? 'complete' : 'partial',
    cache: cacheError
      ? { state: cache.state.state === 'loaded' ? 'loaded' : 'unreadable', path, error: `Index loaded but could not be cached: ${cacheError}` }
      : { state: 'written', path, error: null },
    revision: revisionInfo,
    installedRoot: discovery.roots[0] ?? null,
    error: discovery.skipped.length > 0 ? `${discovery.skipped.length} model file${discovery.skipped.length === 1 ? '' : 's'} were skipped.` : null
  })
}

/** An operation-safe fallback that the UI can display when a model entry is unavailable. */
export function awsCliHelpFallback(service?: string, command?: string): { argv: string[]; label: string; reason: string } {
  const argv = awsCliHelpArgv(service, command)
  return {
    argv,
    label: service && command ? `Open local help for ${service} ${command}` : service ? `Open local help for ${service}` : 'Open local AWS CLI help',
    reason: 'The installed model does not contain this documentation entry. AWS CLI help is the local fallback; no operation is executed.'
  }
}
