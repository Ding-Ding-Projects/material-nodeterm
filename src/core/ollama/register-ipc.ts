import { IPC } from '../../shared/ipc'
import type { CorePlatform } from '../platform'
import {
  evaluateFit,
  type FitEvaluation,
  type ModelFitFacts,
  type OllamaStatus
} from '../../shared/ollama'
import { OllamaClient, OllamaUnreachableError } from './client'
import { OllamaCatalogStore } from './catalog-store'
import { detectHardware } from './hardware'
import { classifyOllamaHealth, detectOllamaInstalled, type OllamaInstallEvidence } from './installation'
import { OllamaPullQueue } from './pull-queue'
import { OllamaChatStore } from './chat-store'

export interface RegisterOllamaIpcDeps {
  /** Override for detectOllamaInstalled — real fs/PATH detection by default. Exists so tests can
   *  make the 'stopped' vs 'not-installed' verdict deterministic instead of depending on whether
   *  Ollama happens to be installed on the machine running the suite. */
  checkInstalled?: () => OllamaInstallEvidence
  /** Override for the exhaustive model catalog (network + cache). Injectable so a suite can drive
   *  the catalog without any real HTTP. */
  catalog?: OllamaCatalogStore
}

/** Registers the ollama:* RPC surface on a CorePlatform. Every call here reaches only Ollama's own
 *  local HTTP API (OllamaClient) — see docs/ollama-manager.md for the full contract. */
export function registerOllamaIpc(platform: CorePlatform, deps: RegisterOllamaIpcDeps = {}): { client: OllamaClient } {
  const client = new OllamaClient()
  const checkInstalled = deps.checkInstalled ?? detectOllamaInstalled

  platform.handle(IPC.ollamaStatus, async (): Promise<OllamaStatus> => {
    const ping = await client.ping()
    return {
      health: ping.ok ? 'ok' : classifyOllamaHealth(ping.code, ping.detail, checkInstalled),
      endpoint: client.endpoint,
      version: ping.version,
      detail: ping.detail,
      checkedAt: Date.now()
    }
  })

  platform.handle(IPC.ollamaModels, () => client.tags().catch(() => []))
  platform.handle(IPC.ollamaRunning, () => client.ps().catch(() => []))
  platform.handle(IPC.ollamaShow, (model: string) => client.show(model))
  platform.handle(IPC.ollamaDelete, (model: string) => client.deleteModel(model))
  platform.handle(IPC.ollamaCopy, (source: string, destination: string) => client.copyModel(source, destination))
  // The exhaustive catalog rides the existing (argument-less) popular-models channel: this pass does
  // not own src/shared/ipc.ts or the preload, so a new channel could not be added. The payload is
  // now a CatalogSnapshot object instead of the old `{name, note}[]` array; the renderer validates
  // whatever arrives (catalogView.ts) and still understands the legacy array from an older core.
  // Nothing is fetched until this handler is actually called — i.e. until the user opens the
  // manager. Widening `OllamaApi.popularModels()`'s declared type is owed follow-up work in the
  // file that declares it. See docs/ollama-manager.md.
  const catalog = deps.catalog ?? new OllamaCatalogStore({ userDataDir: platform.userDataDir, client })
  platform.handle(IPC.ollamaPopularModels, () => catalog.snapshot())

  platform.handle(IPC.ollamaHardware, () => detectHardware(platform.userDataDir))

  platform.handle(IPC.ollamaFit, async (refs: string[]): Promise<Record<string, FitEvaluation>> => {
    const [hw, installed] = await Promise.all([
      detectHardware(platform.userDataDir),
      client.tags().catch(() => [])
    ])
    const byName = new Map(installed.map((m) => [m.name, m]))
    const out: Record<string, FitEvaluation> = {}
    for (const ref of refs) {
      const model = byName.get(ref)
      if (model) {
        const facts: ModelFitFacts = {
          sizeBytes: model.sizeBytes,
          parameterSize: model.details.parameter_size ?? null,
          quantization: model.details.quantization_level ?? null,
          contextLength: null
        }
        out[ref] = evaluateFit(hw, facts)
        continue
      }
      // Not installed. The catalog may still know this exact tag's PUBLISHED download size, which
      // is a real measured fact about the model rather than a guess from its name — that is what
      // makes a pre-pull verdict possible at all. Its precision is named explicitly, because
      // evaluateFit's own evidence line calls the number an on-disk size (true for an installed
      // model, and the reason this line goes in front of it). Nothing is ever inferred from the
      // reference text; a model with no published size stays 'unknown'.
      const published = await catalog.publishedSize(ref).catch(() => null)
      const facts: ModelFitFacts = {
        sizeBytes: published?.sizeBytes ?? null,
        parameterSize: null,
        quantization: null,
        contextLength: null
      }
      const evaluation = evaluateFit(hw, facts)
      if (published) {
        evaluation.evidence.unshift(
          published.exact
            ? `${ref} is not installed; the size below is its exact published download size from Ollama's registry manifest.`
            : `${ref} is not installed; the size below is the published download size as Ollama's library page rounds it (approximate).`
        )
      }
      out[ref] = evaluation
    }
    return out
  })

  // ---- Batch pull ("cart" — never money; see docs/ollama-manager.md) ---------------------------
  const pulls = new OllamaPullQueue({
    userDataDir: platform.userDataDir,
    client,
    onItemChange: (item) => platform.broadcast(IPC.ollamaPullItem, item),
    onSummaryChange: (summary) => platform.broadcast(IPC.ollamaPullSummary, summary)
  })
  platform.handle(IPC.ollamaPullState, () => pulls.state())
  platform.handle(IPC.ollamaPullEnqueue, (refs: string[]) => pulls.enqueue(refs))
  platform.handle(IPC.ollamaPullStart, () => pulls.start())
  platform.handle(IPC.ollamaPullPause, () => pulls.pause())
  platform.handle(IPC.ollamaPullCancelItem, (id: string) => pulls.cancelItem(id))
  platform.handle(IPC.ollamaPullRetryItem, (id: string) => pulls.retryItem(id))
  platform.handle(IPC.ollamaPullRemoveItem, (id: string) => pulls.removeItem(id))
  platform.handle(IPC.ollamaPullSetConcurrency, (n: number) => pulls.setConcurrency(n))

  // ---- Chat --------------------------------------------------------------------------------
  const chats = new OllamaChatStore(platform.userDataDir, client, (evt) =>
    platform.broadcast(IPC.ollamaChatStream, evt)
  )
  platform.handle(IPC.ollamaChatSessions, () => chats.list())
  platform.handle(IPC.ollamaChatGet, (id: string) => chats.get(id))
  platform.handle(IPC.ollamaChatCreate, (model: string, systemPrompt?: string) =>
    chats.create(model, systemPrompt ?? '')
  )
  platform.handle(IPC.ollamaChatRename, (id: string, title: string) => chats.rename(id, title))
  platform.handle(IPC.ollamaChatDelete, (id: string) => chats.remove(id))
  platform.handle(IPC.ollamaChatExport, (id: string, format: 'json' | 'markdown') => chats.export(id, format))
  platform.handle(IPC.ollamaChatSend, (id: string, text: string) => chats.send(id, text))
  platform.handle(IPC.ollamaChatStop, (id: string) => chats.stop(id))

  return { client }
}

export { OllamaUnreachableError }
