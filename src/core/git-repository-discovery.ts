import fs from 'fs'
import path from 'path'
import type { GitRepositoryDiscovery, GitRepositoryDiscoveryEntry } from '../shared/types'

/**
 * Nested repository discovery is intentionally a shallow, local filesystem operation. A project
 * folder can contain generated trees with millions of entries, so the scan never follows links,
 * never enters known dependency/output directories, and never visits more than these bounds.
 */
export const NESTED_REPOSITORY_MAX_DEPTH = 4
export const NESTED_REPOSITORY_MAX_DIRECTORIES = 512

const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  '.venv',
  'venv',
  '__pycache__'
])

export interface GitRepositoryExecutor {
  (cwd: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }>
}

function samePath(a: string, b: string): boolean {
  const left = path.normalize(a)
  const right = path.normalize(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function parseSimpleIgnoreNames(contents: string): Set<string> {
  const names = new Set<string>()
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('!') || line.includes('*')) continue
    const candidate = line.replace(/^\//, '').replace(/\/$/, '')
    if (candidate && !candidate.includes('/') && !candidate.includes('\\')) names.add(candidate)
  }
  return names
}

async function localIgnoreNames(directory: string): Promise<Set<string>> {
  try {
    const text = await fs.promises.readFile(path.join(directory, '.gitignore'), 'utf8')
    return parseSimpleIgnoreNames(text)
  } catch {
    return new Set<string>()
  }
}

async function gitTopLevel(executor: GitRepositoryExecutor, directory: string): Promise<string | null> {
  const result = await executor(directory, ['rev-parse', '--show-toplevel'])
  if (!result.ok) return null
  const top = result.out.trim()
  return top || null
}

/**
 * Find Git repositories below a project folder. The returned `relativePath` is the portable
 * identity used by project metadata. `path` is deliberately machine-local runtime data and must
 * never be persisted in a project projection or export.
 */
export async function discoverNestedRepositories(
  root: string,
  executor: GitRepositoryExecutor
): Promise<GitRepositoryDiscovery> {
  const empty = (message?: string): GitRepositoryDiscovery => ({
    ok: !message,
    complete: false,
    root: path.resolve(root || '.'),
    rootIsRepository: false,
    repositories: [],
    scannedDirectories: 0,
    skippedIgnoredDirectories: 0,
    skippedSymlinks: 0,
    truncated: false,
    message
  })
  if (!root) return empty('A project folder is required to discover nested repositories.')

  let rootPath: string
  try {
    const rootStat = await fs.promises.lstat(root)
    if (rootStat.isSymbolicLink()) return empty('The project folder is a symbolic link; discovery does not follow links.')
    if (!rootStat.isDirectory()) return empty('The project folder is not a directory.')
    rootPath = await fs.promises.realpath(root)
  } catch (error) {
    return empty(`The project folder could not be read: ${error instanceof Error ? error.message : String(error)}`)
  }

  const rootTop = await gitTopLevel(executor, rootPath)
  const result: GitRepositoryDiscovery = {
    ok: true,
    complete: true,
    root: rootPath,
    rootIsRepository: !!rootTop && samePath(rootTop, rootPath),
    repositories: [],
    scannedDirectories: 0,
    skippedIgnoredDirectories: 0,
    skippedSymlinks: 0,
    truncated: false
  }

  const queue: Array<{ directory: string; depth: number }> = [{ directory: rootPath, depth: 0 }]
  const seen = new Set<string>([rootPath])
  while (queue.length > 0) {
    const current = queue.shift()!
    result.scannedDirectories += 1

    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(current.directory, { withFileTypes: true })
    } catch (error) {
      if (current.directory === rootPath) {
        result.ok = false
        result.complete = false
        result.message = `The project folder could not be enumerated: ${error instanceof Error ? error.message : String(error)}`
        return result
      }
      result.complete = false
      result.message = 'Some nested folders could not be read; the repository list may be incomplete.'
      continue
    }

    const ignoredFromFile = await localIgnoreNames(current.directory)
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        if (entry.isSymbolicLink()) result.skippedSymlinks += 1
        continue
      }
      if (IGNORED_DIRECTORY_NAMES.has(entry.name) || ignoredFromFile.has(entry.name)) {
        result.skippedIgnoredDirectories += 1
        continue
      }
      if (current.depth >= NESTED_REPOSITORY_MAX_DEPTH) {
        result.truncated = true
        result.complete = false
        result.message = `Nested repository discovery stopped at depth ${NESTED_REPOSITORY_MAX_DEPTH}.`
        continue
      }
      if (result.scannedDirectories + queue.length >= NESTED_REPOSITORY_MAX_DIRECTORIES) {
        result.truncated = true
        result.complete = false
        result.message = `Nested repository discovery stopped after ${NESTED_REPOSITORY_MAX_DIRECTORIES} folders.`
        break
      }

      const candidate = path.join(current.directory, entry.name)
      let gitMarker: fs.Stats | null = null
      try {
        gitMarker = await fs.promises.lstat(path.join(candidate, '.git'))
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') {
          result.complete = false
          result.message = 'Some Git markers could not be read; the repository list may be incomplete.'
          continue
        }
      }
      if (gitMarker?.isSymbolicLink()) {
        result.skippedSymlinks += 1
        continue
      }
      if (gitMarker?.isDirectory() || gitMarker?.isFile()) {
        const top = await gitTopLevel(executor, candidate)
        if (top && samePath(top, candidate)) {
          const relativePath = path.relative(rootPath, candidate).split(path.sep).join('/')
          const record: GitRepositoryDiscoveryEntry = {
            relativePath,
            path: candidate,
            name: path.basename(candidate)
          }
          if (!result.repositories.some((repo) => repo.relativePath === relativePath)) {
            result.repositories.push(record)
          }
        } else {
          result.complete = false
          result.message = 'A nested Git marker could not be resolved to its containing folder.'
        }
      }
      if (!seen.has(candidate)) {
        seen.add(candidate)
        queue.push({ directory: candidate, depth: current.depth + 1 })
      }
    }
  }

  result.repositories.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  return result
}
