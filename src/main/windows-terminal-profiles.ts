import { IPC } from '../shared/ipc'
import type { WindowsTerminalProfile } from '../shared/types'

/** The two safe catalog operations exposed by the trusted core service. Launch plans stay private. */
export interface DesktopTerminalProfileCatalog {
  list(): WindowsTerminalProfile[] | Promise<WindowsTerminalProfile[]>
  refresh(customExecutable?: string): WindowsTerminalProfile[] | Promise<WindowsTerminalProfile[]>
}

/** Narrow Electron seam so registration and cleanup are behavior-testable without booting Electron. */
export interface TerminalProfileIpcMain {
  handle(channel: string, listener: (...args: any[]) => unknown): void
  removeHandler(channel: string): void
}

function publicProfile(profile: WindowsTerminalProfile): WindowsTerminalProfile {
  // Copy the allowlisted public fields instead of returning a core object by reference. The core
  // resolver also carries the executable and argv needed to spawn; even if a future service
  // accidentally returns that richer object here, local renderer code must never receive it.
  return {
    id: profile.id,
    label: profile.label,
    kind: profile.kind,
    available: profile.available,
    ...(profile.unavailableReason === undefined
      ? {}
      : { unavailableReason: profile.unavailableReason })
  }
}

async function publicProfiles(
  read: () => WindowsTerminalProfile[] | Promise<WindowsTerminalProfile[]>
): Promise<WindowsTerminalProfile[]> {
  return (await read()).map(publicProfile)
}

/**
 * Register the Windows-only catalog on native Electron IPC.
 *
 * Deliberately accepts ipcMain rather than CorePlatform: a relay peer is answered from
 * ElectronPlatform's handler table and therefore cannot invoke these handlers. Registration is
 * transactional, and the returned cleanup is idempotent so partial startup and app teardown never
 * leave one half of the API installed.
 */
export function registerWindowsTerminalProfileIpc(
  ipcMain: TerminalProfileIpcMain,
  catalog: DesktopTerminalProfileCatalog
): () => void {
  const installed: string[] = []
  let disposed = false

  try {
    ipcMain.handle(IPC.terminalProfilesList, () => publicProfiles(() => catalog.list()))
    installed.push(IPC.terminalProfilesList)
    ipcMain.handle(IPC.terminalProfilesRefresh, (_event: unknown, customExecutable?: unknown) => {
      if (
        customExecutable !== undefined &&
        (typeof customExecutable !== 'string' ||
          customExecutable.length > 4096 ||
          /[\u0000-\u001f\u007f]/.test(customExecutable))
      ) {
        throw new Error('The custom executable used for profile detection is invalid.')
      }
      return publicProfiles(() => catalog.refresh(customExecutable))
    })
    installed.push(IPC.terminalProfilesRefresh)
  } catch (error) {
    for (const channel of installed) ipcMain.removeHandler(channel)
    throw error
  }

  return () => {
    if (disposed) return
    disposed = true
    for (const channel of installed) ipcMain.removeHandler(channel)
  }
}
