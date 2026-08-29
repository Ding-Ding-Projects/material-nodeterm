import { IPC } from '../../shared/ipc'
import type { CdkApi, CdkReviewedChange } from '../../shared/cdk'
import type { CorePlatform } from '../platform'
import { CdkManager } from './manager'

export function registerCdkIpc(platform: CorePlatform): CdkManager {
  const manager = new CdkManager()
  platform.handle(IPC.cdkInspect, (folder: string) => manager.inspect(folder))
  platform.handle(IPC.cdkStatus, (folder?: string) => manager.status(folder))
  platform.handle(IPC.cdkBootstrap, (folder: string) => manager.bootstrap(folder))
  platform.handle(IPC.cdkSynth, (folder: string, review: CdkReviewedChange) => manager.synth(folder, review))
  platform.handle(IPC.cdkDiff, (folder: string, review: CdkReviewedChange) => manager.diff(folder, review))
  platform.handle(IPC.cdkDeploy, (folder: string, review: CdkReviewedChange) => manager.deploy(folder, review))
  platform.handle(IPC.cdkDestroy, (folder: string, review: CdkReviewedChange) => manager.destroy(folder, review))
  platform.handle(IPC.cdkCancel, (folder: string) => manager.cancel(folder))
  void manager.onEvent((event) => platform.broadcast(IPC.cdkEvent, event))
  return manager
}

export type RegisteredCdkApi = Pick<CdkApi, 'inspect' | 'status' | 'bootstrap' | 'synth' | 'diff' | 'deploy' | 'destroy'>
