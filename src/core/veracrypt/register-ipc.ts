import { IPC } from '../../shared/ipc'
import { mountOptionsFrom } from '../../shared/veracrypt'
import type { CorePlatform } from '../platform'
import { VeraCryptManager } from './service'

/** Register the host-local VeraCrypt service for the desktop shell only. Server Edition deliberately
 * does not register these handlers because mounting a host container from a browser session would
 * expose a machine-local destructive capability. Relay peers use their explicit local-only stub. */
export function registerVeraCryptIpc(platform: CorePlatform): { manager: VeraCryptManager } {
  const manager = new VeraCryptManager(platform)
  platform.handle(IPC.veracryptAvailability, () => manager.availability())
  platform.handle(IPC.veracryptFavorites, () => manager.favorites())
  platform.handle(IPC.veracryptSaveFavorite, (raw: unknown) => {
    const favorite = raw && typeof raw === 'object' ? raw : null
    return manager.saveFavorite(favorite as never)
  })
  platform.handle(IPC.veracryptRemoveFavorite, (id: unknown) => manager.removeFavorite(id as string))
  platform.handle(IPC.veracryptPreflight, (raw: unknown) => {
    const options = mountOptionsFrom(raw)
    if (!options) throw new Error('The VeraCrypt mount options are invalid.')
    return manager.preflight(options)
  })
  platform.handle(IPC.veracryptMount, (raw: unknown) => {
    const options = mountOptionsFrom(raw)
    if (!options) throw new Error('The VeraCrypt mount options are invalid.')
    return manager.mount(options)
  })
  platform.handle(IPC.veracryptRefresh, () => manager.refresh())
  platform.handle(IPC.veracryptExplore, (letter: unknown) => manager.explore(letter as string))
  platform.handle(IPC.veracryptUnmount, (letter: unknown, force?: unknown) => manager.unmount(letter as string, force === true))
  platform.handle(IPC.veracryptWipeCache, () => manager.wipeCache())
  platform.handle(IPC.veracryptCancel, (id: unknown) => manager.cancel(id as string))
  manager.onOperation((operation) => platform.broadcast(IPC.veracryptOperation, operation))
  return { manager }
}
