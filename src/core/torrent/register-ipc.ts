import { IPC } from '../../shared/ipc'
import type { CorePlatform } from '../platform'
import type { TorrentAddInput, TorrentSeedPolicy, TorrentSourceKind } from '../../shared/torrent'
import { TorrentService } from './service'
import type { LocalHistoryStore } from '../local-history'

export function registerTorrentIpc(platform: CorePlatform, historyStore?: LocalHistoryStore): { service: TorrentService } {
  let service!: TorrentService
  service = new TorrentService({
    userDataDir: platform.userDataDir,
    resourcesPath: platform.resourcesPath,
    isPackaged: platform.isPackaged,
    onHistory: historyStore ? (event) => historyStore.record({
      domain: 'torrent', filename: 'tasks.json', content: event.content, label: event.label, action: event.action
    }) : undefined,
    onTask: (task) => {
      const owner = service.ownerFor(task.id)
      if (owner === undefined) platform.broadcast(IPC.torrentTask, task)
      else platform.sendTo(owner, IPC.torrentTask, task)
    }
  })
  platform.handle(IPC.torrentRuntime, () => service.runtime())
  platform.handle(IPC.torrentPersistence, () => service.persistence())
  platform.handleWithSender(IPC.torrentList, (senderId: number, nodeId?: string) => service.list(nodeId, senderId))
  platform.handleWithSender(IPC.torrentInspect, (senderId: number, input: { sourceKind: TorrentSourceKind; sourceRef: string }) => service.inspect(input, senderId))
  platform.handleWithSender(IPC.torrentAdd, (senderId: number, input: TorrentAddInput) => service.add(input, senderId))
  platform.handleWithSender(IPC.torrentChooseFiles, (senderId: number, id: string, paths: string[]) => service.chooseFiles(id, paths, senderId))
  platform.handleWithSender(IPC.torrentSetDestination, (senderId: number, id: string, destination: string) => service.setDestination(id, destination, senderId))
  platform.handleWithSender(IPC.torrentPreflight, (senderId: number, id: string) => service.preflight(id, senderId))
  platform.handleWithSender(IPC.torrentStart, (senderId: number, id: string, consent) => service.start(id, consent, senderId))
  platform.handleWithSender(IPC.torrentPause, (senderId: number, id: string) => service.pause(id, senderId))
  platform.handleWithSender(IPC.torrentResume, (senderId: number, id: string, consent) => service.resume(id, consent, senderId))
  platform.handleWithSender(IPC.torrentCancel, (senderId: number, id: string) => service.cancel(id, senderId))
  platform.handleWithSender(IPC.torrentRetry, (senderId: number, id: string, consent) => service.retry(id, consent, senderId))
  platform.handleWithSender(IPC.torrentRemove, (senderId: number, id: string) => service.remove(id, senderId))
  platform.handleWithSender(IPC.torrentSetSeedPolicy, (senderId: number, id: string, policy: TorrentSeedPolicy) => service.setSeedPolicy(id, policy, senderId))
  platform.handle(IPC.torrentReconcile, () => service.reconcile())
  return { service }
}
