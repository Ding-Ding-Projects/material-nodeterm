// Disk read/write for the machine-local "which unpacked extensions load into which browser
// profile" list. Pure decision logic lives in `browser-extensions-core.ts`; this only touches the
// filesystem, atomically (see CLAUDE.md's "Atomic writes" section — never a bare `fs.rename`).
//
// Stored at <userData>/browser-extensions.json. Contents are local directory paths only, never a
// credential — normal (non-0600) file mode is fine, matching the workspace/settings stores.

import { promises as fs } from 'fs'
import path from 'path'
import { app } from 'electron'
import { writeFileAtomic } from '../core/fs-atomic'
import {
  emptyBrowserExtensionsStore,
  parsePersistedBrowserExtensions,
  type BrowserExtensionsStore
} from './browser-extensions-core'

function file(): string {
  return path.join(app.getPath('userData'), 'browser-extensions.json')
}

/** Every read and write enters one queue, same discipline as `approved-devices.ts`: atomic
 *  rename prevents torn bytes, this queue prevents a stale read-modify-write snapshot from
 *  winning after a later mutation (add/remove race from two IPC calls in flight at once). */
let storeTail: Promise<void> = Promise.resolve()

function serializeStore<T>(operation: () => Promise<T>): Promise<T> {
  const result = storeTail.then(operation)
  storeTail = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

async function readStore(): Promise<BrowserExtensionsStore> {
  try {
    const json = JSON.parse(await fs.readFile(file(), 'utf-8')) as unknown
    return parsePersistedBrowserExtensions(json)
  } catch (err) {
    // Only ENOENT means "nothing configured yet". Any other read failure (permissions, I/O,
    // malformed JSON, wrong shape) must not be read as an empty store, or the next save silently
    // erases the only evidence something was wrong.
    if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return emptyBrowserExtensionsStore()
    throw err
  }
}

export function loadBrowserExtensions(): Promise<BrowserExtensionsStore> {
  return serializeStore(readStore)
}

async function writeStore(store: BrowserExtensionsStore): Promise<void> {
  const valid = parsePersistedBrowserExtensions(store)
  await writeFileAtomic(file(), JSON.stringify(valid))
}

/** One read-modify-write mutation against the store, serialized behind the same queue as reads
 *  so an add and a remove issued back-to-back can never race each other onto disk. */
export function mutateBrowserExtensions(
  mutation: (current: BrowserExtensionsStore) => BrowserExtensionsStore
): Promise<BrowserExtensionsStore> {
  return serializeStore(async () => {
    const current = await readStore()
    const next = mutation(current)
    if (next !== current) await writeStore(next)
    return next
  })
}
