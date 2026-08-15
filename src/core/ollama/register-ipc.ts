import { IPC } from '../../shared/ipc'
import type { CorePlatform } from '../platform'
import {
  OLLAMA_POPULAR_MODELS,
  evaluateFit,
  type FitEvaluation,
  type ModelFitFacts,
  type OllamaStatus
} from '../../shared/ollama'
import { OllamaClient, OllamaUnreachableError } from './client'
import { detectHardware } from './hardware'
import { OllamaPullQueue } from './pull-queue'
import { OllamaChatStore } from './chat-store'

/** Registers the ollama:* RPC surface on a CorePlatform. Every call here reaches only Ollama's own
 *  local HTTP API (OllamaClient) — see docs/ollama-manager.md for the full contract. */
export function registerOllamaIpc(platform: CorePlatform): { client: OllamaClient } {
  const client = new OllamaClient()

  platform.handle(IPC.ollamaStatus, async (): Promise<OllamaStatus> => {
    const ping = await client.ping()
    return {
      health: ping.ok ? 'ok' : classifyFailure(ping.detail),
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
  platform.handle(IPC.ollamaPopularModels, () => OLLAMA_POPULAR_MODELS)

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
      let facts: ModelFitFacts
      if (model) {
        facts = {
          sizeBytes: model.sizeBytes,
          parameterSize: model.details.parameter_size ?? null,
          quantization: model.details.quantization_level ?? null,
          contextLength: null
        }
      } else {
        // Not installed — we have no verified size/param/quant for it. Never guessed from the name.
        facts = { sizeBytes: null, parameterSize: null, quantization: null, contextLength: null }
      }
      out[ref] = evaluateFit(hw, facts)
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

function classifyFailure(detail: string | null): OllamaStatus['health'] {
  if (!detail) return 'unreachable'
  const d = detail.toLowerCase()
  if (d.includes('econnrefused')) return 'stopped'
  if (d.includes('abort') || d.includes('timeout')) return 'unreachable'
  return 'unhealthy'
}

export { OllamaUnreachableError }
