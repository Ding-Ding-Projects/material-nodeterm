// Electron-facing half of unpacked browser-extension loading: given a partition string (see
// `shared/browser-profiles.ts`), resolves the real `session` and drives its
// `session.extensions.{loadExtension,removeExtension,getAllExtensions}` API.
//
// TRUTH ESTABLISHED FROM THE PINNED ELECTRON 42.8.1 TYPINGS (node_modules/electron/electron.d.ts,
// `Session.extensions`), not assumed:
//   - Unpacked extensions only — "This API does not support loading packed (.crx) extensions."
//   - "Loading extensions into in-memory (non-persistent) sessions is not supported." Every
//     partition this app hands to a <webview> is either the app's default persistent session or a
//     `persist:browser-profile-...` partition (see `browserPartitionFor`) — never an in-memory
//     `partition:` (no `persist:` prefix) one — so this constraint is met by construction, not by
//     an extra check here; if that ever changes, `loadExtensionInto` will surface Electron's own
//     rejection rather than silently doing nothing.
//   - "loadExtension must be called on every boot of your app if you want the modifications to be
//     applied" — Electron does NOT remember loaded extensions across restarts on its own. That is
//     why a path list is persisted in `browser-extensions-store.ts` and replayed at boot
//     (`reloadPersistedBrowserExtensions`) rather than relying on Electron's own state.
//   - "Note that Electron does not support the full range of Chrome extensions APIs." — chrome.*
//     surface is a SUBSET of real Chrome; some extensions (ones relying on APIs Electron hasn't
//     implemented) will partly or fully fail. This module cannot detect that in advance; it can
//     only report whether `loadExtension` itself succeeded or rejected.

import { session } from 'electron'
import {
  addBrowserExtension,
  allBrowserExtensionEntries,
  browserExtensionsKeyFor,
  removeBrowserExtension,
  type BrowserExtensionsStore
} from './browser-extensions-core'
import { loadBrowserExtensions, mutateBrowserExtensions } from './browser-extensions-store'
import { isBrowserProfilePartition } from '../shared/browser-profiles'

/** What the renderer sees for one loaded extension. Electron assigns `id`/`name`/`version` from
 *  the extension's own manifest at load time — this app never invents them. */
export interface BrowserExtensionInfo {
  id: string
  name: string
  version: string
  path: string
}

function sessionForPartitionKey(key: string): Electron.Session {
  return key === 'default' ? session.defaultSession : session.fromPartition(key)
}

function toInfo(ext: Electron.Extension): BrowserExtensionInfo {
  return { id: ext.id, name: ext.name, version: ext.version, path: ext.path }
}

/** Currently loaded extensions for a partition — read LIVE from Electron (`getAllExtensions`),
 *  never from the persisted path list, so a load that failed at boot (bad manifest, since
 *  deleted directory) shows up as absent rather than as a phantom success. */
export function listLoadedExtensions(partition: string | undefined): BrowserExtensionInfo[] {
  const key = browserExtensionsKeyFor(partition)
  return sessionForPartitionKey(key).extensions.getAllExtensions().map(toInfo)
}

export type LoadExtensionResult =
  | { ok: true; extension: BrowserExtensionInfo }
  | { ok: false; error: string }

/** Load an unpacked extension directory into a partition's session and persist the path so it
 *  reloads on the next app boot. Errors from Electron (bad manifest, unsupported layout, …) are
 *  caught and reported as text — never thrown across the IPC boundary as an opaque rejection. */
export async function addExtension(
  partition: string | undefined,
  dirPath: string
): Promise<LoadExtensionResult> {
  const key = browserExtensionsKeyFor(partition)
  try {
    const ext = await sessionForPartitionKey(key).extensions.loadExtension(dirPath)
    await mutateBrowserExtensions((store) => addBrowserExtension(store, key, dirPath))
    return { ok: true, extension: toInfo(ext) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Unload an extension from its partition's live session and drop its path from the persisted
 *  list. `extensionPath` (not the ephemeral Electron-assigned id) is what identifies the entry in
 *  the persisted store; the id is looked up live so a caller only ever needs the path it added. */
export async function removeExtensionByPath(
  partition: string | undefined,
  dirPath: string
): Promise<void> {
  const key = browserExtensionsKeyFor(partition)
  const ses = sessionForPartitionKey(key)
  const match = ses.extensions.getAllExtensions().find((e) => e.path === dirPath)
  if (match) ses.extensions.removeExtension(match.id)
  await mutateBrowserExtensions((store) => removeBrowserExtension(store, key, dirPath))
}

/**
 * Reset one browser profile's machine-local session. The project-owned tab list and profile name
 * stay untouched, while cookies, storage, cache and loaded unpacked extensions are removed. The
 * partition is checked here as well as at the UI boundary because IPC input is not trusted.
 */
export async function resetBrowserProfile(
  partition: string | undefined
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isBrowserProfilePartition(partition)) {
    return { ok: false, error: 'The requested browser profile session is not managed by this app.' }
  }
  const key = browserExtensionsKeyFor(partition)
  const ses = sessionForPartitionKey(key)
  try {
    for (const ext of ses.extensions.getAllExtensions()) ses.extensions.removeExtension(ext.id)
    await ses.clearStorageData()
    await ses.clearCache()
    await mutateBrowserExtensions((store) => {
      if (!(key in store)) return store
      const next = { ...store }
      delete next[key]
      return next
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Replay every persisted extension path into its session at app startup. Electron forgets loaded
 *  extensions across restarts (see the module doc above), so this is what makes an extension
 *  survive relaunching the app. Called once from `app.whenReady()`. A failed reload (directory
 *  moved/deleted since last run) is logged and otherwise ignored — it does not remove the entry
 *  from the persisted list, so a temporarily-unavailable path (an external drive, say) is not
 *  silently forgotten; the user's "New extension…" flow is the only way an entry is removed.
 */
export async function reloadPersistedBrowserExtensions(): Promise<void> {
  let store: BrowserExtensionsStore
  try {
    store = await loadBrowserExtensions()
  } catch (err) {
    console.warn('[browser-extensions] could not read persisted extension list', err)
    return
  }
  for (const { key, path } of allBrowserExtensionEntries(store)) {
    try {
      await sessionForPartitionKey(key).extensions.loadExtension(path)
    } catch (err) {
      console.warn(`[browser-extensions] failed to reload extension at ${path} for ${key}`, err)
    }
  }
}
