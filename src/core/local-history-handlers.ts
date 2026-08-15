import type { CorePlatform } from './platform'
import { IPC } from '../shared/ipc'
import type { HistoryFilters, HistoryListResult, HistoryRestoreResult } from '../shared/local-history'
import type { LocalHistoryStore } from './local-history'

/** Domain-specific "apply a restore" hooks. Reading an old revision back is generic
 *  (`LocalHistoryStore.restoreContent`); APPLYING it is not — the settings domain has to run the
 *  restored JSON through the normal validated save path (`SettingsStore`) rather than this module
 *  writing the live file directly, so the restore itself gets the SAME atomic-write and listener
 *  guarantees an ordinary save has. Only 'settings' is wired today; an unknown domain is refused
 *  rather than silently doing nothing. */
export interface HistoryRestoreHandler {
  (content: string, sha: string): Promise<void>
}

export function registerLocalHistoryHandlers(
  platform: CorePlatform,
  deps: {
    historyStore: LocalHistoryStore
    /** filename, e.g. `'settings.json'` for the 'settings' domain. */
    domainFilenames: Record<string, string>
    restoreHandlers: Record<string, HistoryRestoreHandler>
  }
): void {
  platform.handle(
    IPC.historyList,
    async (domain: string, filters?: HistoryFilters): Promise<HistoryListResult> => {
      const entries = await deps.historyStore.list(domain, filters)
      if (entries === null) return { ok: false, error: `Could not read history for "${domain}".` }
      return { ok: true, entries }
    }
  )

  platform.handle(
    IPC.historyRestore,
    async (domain: string, sha: string): Promise<HistoryRestoreResult> => {
      const handler = deps.restoreHandlers[domain]
      const filename = deps.domainFilenames[domain]
      if (!handler || !filename) return { ok: false, error: `Unknown history domain: ${domain}` }
      try {
        const content = await deps.historyStore.restoreContent(domain, sha, filename)
        await handler(content, sha)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}
