import { join } from 'node:path'
import type { AdvancedMediaDependencyId } from '../../shared/advanced-media'
import type { CorePlatform } from '../platform'
import { IPC } from '../../shared/ipc'
import { MediaDependencyManager, type MediaDependencySpec } from './dependencies'
import { AdvancedMediaService } from './service'

export interface RegisterAdvancedMediaOptions {
  /** Exact dependency records shipped by the package builder. An empty list keeps external rows disabled. */
  dependencies?: readonly MediaDependencySpec[]
}

/** Register the advanced pipeline on the same platform seam as the express converter. */
export function registerAdvancedMediaIpc(platform: CorePlatform, opts: RegisterAdvancedMediaOptions = {}): AdvancedMediaService {
  const manager = new MediaDependencyManager({ root: join(platform.userDataDir, 'advanced-media', 'tools'), manifest: opts.dependencies ?? [] })
  const service = new AdvancedMediaService({
    userDataDir: platform.userDataDir,
    dependencies: manager,
    onProgress: (event) => platform.broadcast(IPC.advancedMediaProgress, event)
  })
  platform.handle(IPC.advancedMediaCatalog, () => service.catalog())
  platform.handle(IPC.advancedMediaInspect, (path: string) => service.inspect(path))
  platform.handle(IPC.advancedMediaEnqueue, (request) => service.enqueue(request))
  platform.handle(IPC.advancedMediaState, (offset?: number, limit?: number) => service.state(offset, limit))
  platform.handle(IPC.advancedMediaStart, () => service.start())
  platform.handle(IPC.advancedMediaPause, () => service.pause())
  platform.handle(IPC.advancedMediaCancel, (id: string) => service.cancel(id))
  platform.handle(IPC.advancedMediaRetry, (id: string) => service.retry(id))
  platform.handle(IPC.advancedMediaRemove, (id: string) => service.remove(id))
  return service
}

export function dependencyIdsWithVerifiedTools(service: AdvancedMediaService): Promise<Set<AdvancedMediaDependencyId>> {
  return service.catalog().then((catalog) => new Set(catalog.dependencies.filter((entry) => entry.verified).map((entry) => entry.id)))
}

