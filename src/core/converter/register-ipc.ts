import { IPC } from '../../shared/ipc'
import type { CorePlatform } from '../platform'
import { ConverterService } from './service'
import { assertRegistryMatchesCatalog } from './registry'
import { CONVERTER_CATALOG } from '../../shared/converter'
import { ADVANCED_PIPELINE_CATALOG, validateAdvancedPipelineCatalog } from './advanced-pipelines'
import { AdvancedPipelineQueue } from './advanced-queue'

/** Registers the converter:* RPC surface on a CorePlatform (shared by Electron main and the
 *  Server Edition — see docs/file-converter.md). Progress is pushed as events rather than polled:
 *  `converterItem` for a single item's status/progress and `converterSummary` for queue-wide facts
 *  (running/scanning/concurrency/total), both broadcast to every attached client. */
export function registerConverterIpc(platform: CorePlatform): ConverterService {
  assertRegistryMatchesCatalog()
  validateAdvancedPipelineCatalog()

  const service = new ConverterService({
    userDataDir: platform.userDataDir,
    onItemChange: (item) => platform.broadcast(IPC.converterItem, item),
    onSummaryChange: (summary) => platform.broadcast(IPC.converterSummary, summary)
  })
  const advanced = new AdvancedPipelineQueue({
    userDataDirectory: platform.userDataDir,
    onItem: (item) => platform.broadcast(IPC.converterAdvancedItem, item),
    onSummary: (summary) => platform.broadcast(IPC.converterAdvancedSummary, summary)
  })

  platform.handle(IPC.converterCatalog, () => CONVERTER_CATALOG)
  platform.handle(IPC.converterDetect, (path: string) => service.detect(path))
  platform.handle(IPC.converterPreflight, (destDir: string) => service.preflight(destDir))
  platform.handle(IPC.converterState, (offset?: number, limit?: number) => service.state(offset, limit))
  platform.handle(
    IPC.converterAddFiles,
    (paths: string[], destDir: string, adapterId: string, lossyAcknowledged?: boolean) =>
      service.addFiles(paths, destDir, adapterId, { lossyAcknowledged })
  )
  platform.handle(
    IPC.converterAddFolder,
    (root: string, destDir: string, adapterId: string, opts?: { lossyAcknowledged?: boolean; recursive?: boolean }) =>
      service.addFolder(root, destDir, adapterId, opts ?? {})
  )
  platform.handle(IPC.converterCancelScan, () => service.cancelScan())
  platform.handle(
    IPC.converterResolvePending,
    (ids: string[], opts: { overwrite?: boolean; lossyAcknowledged?: boolean }) =>
      service.resolvePending(ids, opts)
  )
  platform.handle(IPC.converterStart, () => service.start())
  platform.handle(IPC.converterPause, () => service.pause())
  platform.handle(IPC.converterCancelItem, (id: string) => service.cancelItem(id))
  platform.handle(IPC.converterCancelAll, () => service.cancelAll())
  platform.handle(IPC.converterRetryItem, (id: string) => service.retryItem(id))
  platform.handle(IPC.converterRemoveItem, (id: string) => service.removeItem(id))
  platform.handle(IPC.converterClearFinished, () => service.clearFinished())
  platform.handle(IPC.converterSetConcurrency, (n: number) => service.setConcurrency(n))
  platform.handle(IPC.converterAdvancedCatalog, () => ADVANCED_PIPELINE_CATALOG)
  platform.handle(IPC.converterAdvancedState, () => advanced.state())
  platform.handle(IPC.converterAdvancedAdd, (request) => advanced.add(request))
  platform.handle(IPC.converterAdvancedStart, () => advanced.start())
  platform.handle(IPC.converterAdvancedPause, () => advanced.pause())
  platform.handle(IPC.converterAdvancedCancel, (id: string) => advanced.cancel(id))
  platform.handle(IPC.converterAdvancedRetry, (id: string) => advanced.retry(id))
  platform.handle(IPC.converterAdvancedSetConcurrency, (n: number) => advanced.setConcurrency(n))

  return service
}
