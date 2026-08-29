/** Pure decisions for the Files node. Paths are slash-separated so local and SSH listings share
 * one implementation. Keep these small and deterministic: the renderer can exercise them without
 * touching a host filesystem. */
import { isVideoFile } from '../state/workspace'
import { opensInEditor } from './openTarget'

export interface FileCrumb {
  name: string
  path: string
}

export function parentDir(path: string): string {
  if (/^[A-Za-z]:[\\/]*$/.test(path)) return path.replace(/[\\/]+$/, '\\')
  const clean = path.replace(/[\\/]+$/, '')
  const index = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'))
  if (index < 0) return '/'
  if (/^[A-Za-z]:$/.test(clean.slice(0, index))) return `${clean.slice(0, index + 1)}\\`
  return index === 0 ? clean.slice(0, 1) : clean.slice(0, index)
}

export function childPath(dir: string, name: string): string {
  const base = dir.replace(/[\\/]+$/, '')
  return `${base || ''}/${name}` || `/${name}`
}

export function folderTitle(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? '/'
}

export function breadcrumbs(path: string, maxTrailingSegments = 3): FileCrumb[] {
  const parts = path.split(/[\\/]/).filter(Boolean)
  const all: FileCrumb[] = [{ name: '/', path: '/' }]
  let current = ''
  for (const part of parts) {
    current += `/${part}`
    all.push({ name: part, path: current })
  }
  if (all.length <= maxTrailingSegments + 1) return all
  const hidden = all.slice(1, all.length - maxTrailingSegments)
  return [all[0], { name: '…', path: hidden.at(-1)!.path }, ...all.slice(-maxTrailingSegments)]
}

export function filterEntries<T extends { name: string }>(entries: T[], query: string): T[] {
  const value = query.trim().toLocaleLowerCase()
  if (!value) return entries
  return entries.filter((entry) => entry.name.toLocaleLowerCase().includes(value))
}

/** Directories are opened in-place. Local files supported by the existing editor/video routes are
 * handed back to Canvas. Other local files may use the operating system, but a remote path must
 * never be passed to the local shell. */
export function fileOpenTarget(path: string, options: { remote?: boolean } = {}): 'canvas' | 'os' {
  if (options.remote || isVideoFile(path)) return 'canvas'
  return opensInEditor(path) ? 'canvas' : 'os'
}
