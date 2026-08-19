// The minecraft:* RPC surface — registered on BOTH shells over the shared CorePlatform seam, the
// same pattern registerOllamaIpc uses, so the engine cannot drift between the desktop and the
// Server Edition. See docs/minecraft-server-manager.md.

import { IPC } from '../../shared/ipc'
import type { CorePlatform } from '../platform'
import type {
  MinecraftConsoleLine,
  MinecraftCreateInput,
  MinecraftServerStatus,
  MinecraftVersionList
} from '../../shared/minecraft'
import { MinecraftServerManager, type MinecraftServerManagerOptions } from './server-manager'

export interface RegisterMinecraftIpcDeps {
  /** Overrides for MinecraftServerManager's own injectable seams — network, java detection, spawn,
   *  clock — so a test can drive the whole surface without a real download or a real java. */
  managerOptions?: Partial<MinecraftServerManagerOptions>
}

export function registerMinecraftIpc(
  platform: CorePlatform,
  deps: RegisterMinecraftIpcDeps = {}
): { manager: MinecraftServerManager } {
  const manager = new MinecraftServerManager({
    userDataDir: platform.userDataDir,
    ...deps.managerOptions,
    onEvent: (event) => {
      deps.managerOptions?.onEvent?.(event)
      platform.broadcast(IPC.minecraftEvent, event)
    }
  })

  platform.handle(IPC.minecraftVersions, (): Promise<MinecraftVersionList> => manager.versions())
  platform.handle(IPC.minecraftStatus, (id: string): Promise<MinecraftServerStatus> => manager.status(id))
  platform.handle(
    IPC.minecraftCreate,
    (input: MinecraftCreateInput): Promise<MinecraftServerStatus> => manager.create(input)
  )
  platform.handle(
    IPC.minecraftAcceptEula,
    (id: string): Promise<MinecraftServerStatus> => manager.acceptEula(id)
  )
  platform.handle(IPC.minecraftStart, (id: string): Promise<MinecraftServerStatus> => manager.start(id))
  platform.handle(IPC.minecraftStop, (id: string): Promise<MinecraftServerStatus> => manager.stop(id))
  platform.handle(
    IPC.minecraftSendCommand,
    (id: string, command: string): Promise<boolean> => manager.sendCommand(id, command)
  )
  platform.handle(
    IPC.minecraftRemove,
    (id: string, deleteFiles: boolean): Promise<void> => manager.remove(id, deleteFiles)
  )
  platform.handle(
    IPC.minecraftRecentConsole,
    (id: string): Promise<MinecraftConsoleLine[]> => manager.recentConsole(id)
  )

  return { manager }
}
