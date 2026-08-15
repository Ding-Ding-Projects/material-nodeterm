// Paged, constant-memory directory discovery for "Add folder…". Yields one path at a time via an
// async generator instead of building a single giant array — a tree with millions of entries is
// walked without ever holding more than one directory's listing (plus a small pending-directory
// stack) in memory at once. The caller (service.ts) drains this in bounded-size pages so the
// persisted queue record grows incrementally rather than after one huge synchronous scan.

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Directory names skipped by default — dependency/VCS trees a user almost never means to convert
 *  when they pick "this whole project folder", and which can be enormous. */
export const DEFAULT_SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'out', '.nodeterm'])

/** Non-recursive listing: just the files directly inside `root`, no descent into subdirectories.
 *  Used when the caller explicitly asked for "this folder only". */
export async function listTopLevelFiles(root: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.filter((e) => e.isFile()).map((e) => join(root, e.name))
}

export async function* walkFiles(
  root: string,
  opts: { skipDirs?: Set<string>; signal?: AbortSignal } = {}
): AsyncGenerator<string> {
  const skip = opts.skipDirs ?? DEFAULT_SKIP_DIRS
  const stack: string[] = [root]
  while (stack.length > 0) {
    if (opts.signal?.aborted) return
    const dir = stack.pop()!
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue // unreadable directory (permissions, vanished) — skip rather than abort the whole scan
    }
    for (const entry of entries) {
      if (opts.signal?.aborted) return
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) stack.push(full)
      } else if (entry.isFile()) {
        yield full
      }
    }
  }
}

/** Drain up to `pageSize` paths from an in-flight walk, returning the page plus whether more remain.
 *  Keeps the generator alive between calls so the caller can persist a page, yield to the event
 *  loop, and come back for the next one without re-walking anything already visited. */
export async function nextPage(
  gen: AsyncGenerator<string>,
  pageSize: number
): Promise<{ page: string[]; done: boolean }> {
  const page: string[] = []
  for (let i = 0; i < pageSize; i++) {
    const { value, done } = await gen.next()
    if (done) return { page, done: true }
    page.push(value)
  }
  return { page, done: false }
}
