import { IPC } from '../shared/ipc'
import type { PtyRecycleTarget } from '../shared/types'
import type { TerminalProfileIpcMain } from './windows-terminal-profiles'

export interface ConfirmedRecycleManager {
  recycleSessionFromClient(
    clientId: number,
    persistKey: string,
    target?: PtyRecycleTarget
  ): Promise<void>
}

/** Minimal event shape used by the raw Electron handler. */
interface SenderEvent {
  sender: { id: number }
}

/**
 * Register the awaited, desktop-only half of a destructive profile restart.
 *
 * The legacy pty:recycle cast remains available for existing move/restart behavior. This invoke
 * route is intentionally raw Electron IPC so a profile switch can prove the old persistent
 * process was actually destroyed before the renderer mutates local profile state and respawns.
 */
export function registerConfirmedRecycleIpc(
  ipcMain: TerminalProfileIpcMain,
  ptyManager: ConfirmedRecycleManager,
  releaseNodeTails: (persistKey: string) => void
): () => void {
  let disposed = false
  ipcMain.handle(
    IPC.ptyRecycleConfirmed,
    async (
      event: SenderEvent,
      persistKey: string,
      target?: PtyRecycleTarget
    ): Promise<void> => {
      // Validation, rate limiting, existence confirmation and ownership attribution all live in
      // PtyManager. Release transcript tailers only after teardown succeeds: a failed destroy
      // leaves the live process intact, so its tailers must remain intact too.
      if (target === undefined) {
        await ptyManager.recycleSessionFromClient(event.sender.id, persistKey)
      } else {
        await ptyManager.recycleSessionFromClient(event.sender.id, persistKey, target)
      }
      releaseNodeTails(persistKey)
    }
  )

  return () => {
    if (disposed) return
    disposed = true
    ipcMain.removeHandler(IPC.ptyRecycleConfirmed)
  }
}
