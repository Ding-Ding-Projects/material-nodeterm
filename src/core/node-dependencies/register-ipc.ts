import { IPC } from '../../shared/ipc'
import type { CorePlatform } from '../platform'
import { NodeDependencyService } from './service'

/** Register the node-feature dependency foundation on both privileged shells. The browser client
 * never performs installation itself: ServerPlatform executes this on its own host, while the
 * Electron shell executes it in the main process. */
export function registerNodeDependencyIpc(platform: CorePlatform): NodeDependencyService {
  const service = new NodeDependencyService(
    (value) => platform.broadcast(IPC.nodeDependencyState, value),
    (value) => platform.broadcast(IPC.nodeDependencyProgress, value)
  )

  platform.handle(IPC.nodeDependencyCatalog, () => service.catalog())
  platform.handle(IPC.nodeDependencyStatus, (id: string) => service.status(id))
  platform.handle(IPC.nodeDependencyDetails, (id: string) => service.details(id))
  platform.handle(IPC.nodeDependencyInstall, (id: string) => service.install(id))
  platform.handle(IPC.nodeDependencyCancel, (operationId: string) => service.cancel(operationId))
  platform.handle(IPC.nodeDependencyRepair, (id: string) => service.repair(id))
  platform.handle(IPC.nodeDependencyReconcile, () => service.reconcile())

  // Reconcile only machine-local records. It is deliberately non-blocking for boot and does not
  // claim readiness until the persisted path and executable health probe both succeed.
  void service.reconcile().catch((error) => {
    platform.broadcast(IPC.nodeDependencyState, {
      error: error instanceof Error ? error.message : String(error),
      state: 'failed',
      available: false
    })
  })
  return service
}
