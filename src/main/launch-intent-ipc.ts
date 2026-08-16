import { IPC } from '../shared/ipc'
import type {
  LaunchIntentExecutionResult,
  TerminalLaunchIntent
} from '../shared/types'
import type { TerminalProfileIpcMain } from './windows-terminal-profiles'

export interface LaunchIntentManager {
  executeLaunchIntent(
    clientId: number,
    sessionId: string,
    launchId: string,
    intent: TerminalLaunchIntent
  ): Promise<LaunchIntentExecutionResult>
}

interface SenderEvent {
  sender: { id: number }
}

/**
 * Register the Windows renderer's semantic launch command on native Electron IPC.
 *
 * This must not use CorePlatform: ElectronPlatform's handler table is the approved-relay RPC
 * surface, while a launch intent is authorized against one exact local webContents subscription.
 * PtyManager owns all runtime validation, live-generation binding, and private command rendering;
 * this adapter contributes only the unforgeable Electron sender id.
 */
export function registerLaunchIntentIpc(
  ipcMain: TerminalProfileIpcMain,
  manager: LaunchIntentManager
): () => void {
  let disposed = false
  ipcMain.handle(
    IPC.ptyExecuteLaunchIntent,
    (
      event: SenderEvent,
      sessionId: string,
      launchId: string,
      intent: TerminalLaunchIntent
    ): Promise<LaunchIntentExecutionResult> =>
      manager.executeLaunchIntent(event.sender.id, sessionId, launchId, intent)
  )

  return () => {
    if (disposed) return
    disposed = true
    ipcMain.removeHandler(IPC.ptyExecuteLaunchIntent)
  }
}
