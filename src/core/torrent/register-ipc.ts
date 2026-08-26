import { IPC } from '../../shared/ipc'
import type { CorePlatform } from '../platform'
import type { TorrentAddInput, TorrentSeedPolicy, TorrentSourceKind } from '../../shared/torrent'
import { TorrentService } from './service'

export function registerTorrentIpc(platform: CorePlatform): { service: TorrentService } {
  const service = new TorrentService({
    userDataDir: platform.userDataDir,
    resourcesPath: platform.resourcesPath,
    isPackaged: platform.isPackaged,
    onTask: (task) => platform.broadcast(IPC.torrentTask, task)
  })
  platform.handle(IPC.torrentRuntime, () => service.runtime())
  platform.handle(IPC.torrentList, (nodeId?: string) => service.list(nodeId))
  platform.handle(IPC.torrentInspect, (input: { sourceKind: TorrentSourceKind; sourceRef: string }) => service.inspect(input))
  platform.handle(IPC.torrentAdd, (input: TorrentAddInput) => service.add(input))
  platform.handle(IPC.torrentChooseFiles, (id: string, paths: string[]) => service.chooseFiles(id, paths))
  platform.handle(IPC.torrentSetDestination, (id: string, destination: string) => service.setDestination(id, destination))
  platform.handle(IPC.torrentPreflight, (id: string) => service.preflight(id))
  platform.handle(IPC.torrentStart, (id: string) => service.start(id))
  platform.handle(IPC.torrentPause, (id: string) => service.pause(id))
  platform.handle(IPC.torrentResume, (id: string) => service.resume(id))
  platform.handle(IPC.torrentCancel, (id: string) => service.cancel(id))
  platform.handle(IPC.torrentRetry, (id: string) => service.retry(id))
  platform.handle(IPC.torrentRemove, (id: string) => service.remove(id))
  platform.handle(IPC.torrentSetSeedPolicy, (id: string, policy: TorrentSeedPolicy) => service.setSeedPolicy(id, policy))
  platform.handle(IPC.torrentReconcile, () => service.reconcile())
  void service.reconcile()
  return { service }
}
