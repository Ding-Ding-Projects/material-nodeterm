// Local Ollama suite manager — shared types + the pure hardware-fit evaluator. No Node/Electron
// imports: safe for the renderer. The actual HTTP calls to Ollama's local API, hardware detection,
// pull queue and chat persistence live in src/core/ollama/*. See docs/ollama-manager.md.

export type OllamaHealth =
  | 'unknown'
  | 'checking'
  | 'ok'
  | 'not-installed'
  | 'stopped'
  | 'unreachable'
  | 'unhealthy'

export interface OllamaStatus {
  health: OllamaHealth
  /** The exact host:port probed — surfaced so a troubleshooter can tell the user what to check. */
  endpoint: string
  version: string | null
  /** Human-readable detail behind the health verdict (a real error message, not a guess). */
  detail: string | null
  checkedAt: number
}

export interface OllamaModelDetails {
  format?: string
  family?: string
  parameter_size?: string
  quantization_level?: string
}

export interface OllamaModelInfo {
  name: string
  /** Total on-disk size of the model's blobs, in bytes — real, from Ollama's own /api/tags. */
  sizeBytes: number
  digest: string
  modifiedAt: string
  details: OllamaModelDetails
  /** Present only once /api/show has been fetched for this model (lazy — the tags list alone
   *  doesn't carry it). Null capabilities/contextLength mean "not yet verified", never "none". */
  contextLength: number | null
  capabilities: string[] | null
}

export interface OllamaRunningModel {
  name: string
  sizeBytes: number
  vramBytes: number | null
  expiresAt: string
}

// ---------------------------------------------------------------------------------------------
// Hardware fit
// ---------------------------------------------------------------------------------------------

export type FitVerdict = 'runs-well' | 'runs-with-limits' | 'unlikely' | 'unknown'

export const FIT_VERDICT_LABELS: Record<FitVerdict, string> = {
  'runs-well': 'Runs well',
  'runs-with-limits': 'Runs with limits',
  unlikely: 'Unlikely',
  unknown: 'Unknown'
}

export interface HardwareEvidence {
  totalRamBytes: number | null
  freeRamBytes: number | null
  /** null = GPU presence/VRAM could not be determined on this platform — see hardware.ts for
   *  exactly what is and isn't detected. Never guessed from the CPU name alone. */
  gpuName: string | null
  vramBytes: number | null
  freeDiskBytes: number | null
  arch: string
  platform: string
  computedAt: number
}

export interface ModelFitFacts {
  /** Model blob size on disk, in bytes. null when unknown (not yet pulled, size never observed). */
  sizeBytes: number | null
  /** Parameter count as Ollama reports it (e.g. "7B", "13B") — kept as the exact string; parsed
   *  defensively by parseParamCount() below rather than trusted to always match \d+B. */
  parameterSize: string | null
  quantization: string | null
  contextLength: number | null
}

export interface FitEvaluation {
  verdict: FitVerdict
  /** Concrete facts the verdict was computed from — always populated, even for 'unknown', so the
   *  UI can show exactly what is and isn't known rather than asserting a verdict on faith. */
  evidence: string[]
  assumptions: string[]
  computedAt: number
}

function parseParamCountBillions(s: string | null): number | null {
  if (!s) return null
  const m = /^([\d.]+)\s*([BM])$/i.exec(s.trim())
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  return m[2].toUpperCase() === 'M' ? n / 1000 : n
}

/** A conservative bytes-per-parameter estimate for a quantization label, used only as a fallback
 *  when the model's own blob size is unknown but its parameter count and quantization ARE known
 *  (Ollama's /api/show reports these before the blob is necessarily downloaded in some flows). When
 *  the quantization is unrecognized this returns null and the caller must fall back to 'unknown'
 *  rather than silently assuming a default (never treat missing metadata as zero). */
function bytesPerParamForQuant(q: string | null): number | null {
  if (!q) return null
  const s = q.toUpperCase()
  if (s.includes('Q2')) return 0.35
  if (s.includes('Q3')) return 0.45
  if (s.includes('Q4')) return 0.55
  if (s.includes('Q5')) return 0.7
  if (s.includes('Q6')) return 0.85
  if (s.includes('Q8')) return 1.05
  if (s.includes('F16') || s.includes('FP16')) return 2
  if (s.includes('F32') || s.includes('FP32')) return 4
  return null
}

/**
 * Conservative, evidence-only hardware-fit evaluator. Pure function — no I/O, fully testable, and
 * reused by both the batch-pull cart's per-item fit column and the installed-model browser.
 *
 * Design rules this function exists to enforce (see docs/ollama-manager.md):
 *  - unknown model size AND unknown (param+quant) estimate ⇒ 'unknown', never a guessed verdict.
 *  - a model NAME is never consulted for capability — only the facts passed in.
 *  - RAM headroom for a CPU/unified-memory host is judged against TOTAL ram (the model + OS + the
 *    app itself all share it); a discrete-GPU host with known VRAM is judged against VRAM instead,
 *    with total RAM only as the fallback loader path.
 */
export function evaluateFit(hw: HardwareEvidence, model: ModelFitFacts): FitEvaluation {
  const evidence: string[] = []
  const assumptions: string[] = []

  let effectiveSizeBytes = model.sizeBytes
  if (effectiveSizeBytes !== null) {
    evidence.push(`Model on-disk size: ${(effectiveSizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB (from Ollama)`)
  } else {
    const params = parseParamCountBillions(model.parameterSize)
    const bpp = bytesPerParamForQuant(model.quantization)
    if (params !== null && bpp !== null) {
      effectiveSizeBytes = params * 1e9 * bpp
      assumptions.push(
        `Size estimated from ${model.parameterSize} parameters at ~${bpp} bytes/param for ${model.quantization} — not the model's real blob size.`
      )
    } else {
      evidence.push('Model size is not known (not yet pulled, or Ollama has not reported it).')
      return { verdict: 'unknown', evidence, assumptions, computedAt: Date.now() }
    }
  }

  const hasVram = hw.vramBytes !== null
  const budget = hasVram ? hw.vramBytes! : hw.totalRamBytes
  if (budget === null) {
    evidence.push('Neither VRAM nor total system RAM could be determined on this machine.')
    return { verdict: 'unknown', evidence, assumptions, computedAt: Date.now() }
  }
  evidence.push(
    hasVram
      ? `Comparing against detected VRAM: ${(budget / 1024 / 1024 / 1024).toFixed(1)} GB`
      : `No discrete GPU/VRAM detected — comparing against total system RAM: ${(budget / 1024 / 1024 / 1024).toFixed(1)} GB`
  )
  if (!hasVram) assumptions.push('Unified/CPU memory is shared with the OS and every other running app.')

  // Runtime overhead (KV cache, activations) beyond the raw weights — a conservative flat +20%.
  const neededBytes = effectiveSizeBytes * 1.2
  evidence.push(`Estimated runtime memory need (weights + ~20% overhead): ${(neededBytes / 1024 / 1024 / 1024).toFixed(2)} GB`)

  if (hw.freeDiskBytes !== null && effectiveSizeBytes > hw.freeDiskBytes) {
    evidence.push(
      `Free disk (${(hw.freeDiskBytes / 1024 / 1024 / 1024).toFixed(1)} GB) is less than the model size — the pull itself would fail.`
    )
    return { verdict: 'unlikely', evidence, assumptions, computedAt: Date.now() }
  }

  const ratio = neededBytes / budget
  if (ratio > 1.1) return { verdict: 'unlikely', evidence, assumptions, computedAt: Date.now() }
  if (ratio > 0.75) return { verdict: 'runs-with-limits', evidence, assumptions, computedAt: Date.now() }
  return { verdict: 'runs-well', evidence, assumptions, computedAt: Date.now() }
}

// ---------------------------------------------------------------------------------------------
// Batch pull ("cart" — never money; see docs/ollama-manager.md)
// ---------------------------------------------------------------------------------------------

export type PullItemStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'

export interface PullQueueItem {
  id: string
  ref: string // "name:tag"
  status: PullItemStatus
  /** Bytes as reported by Ollama's pull stream (`completed`/`total`); both null until the stream
   *  has told us its first chunk — an unstarted pull's size is genuinely unknown, never assumed. */
  completedBytes: number | null
  totalBytes: number | null
  digestPhase: string | null
  error?: string
  createdAt: number
  updatedAt: number
}

export interface PullQueueState {
  items: PullQueueItem[]
  concurrency: number
  running: boolean
}

export const OLLAMA_DEFAULT_ENDPOINT = 'http://127.0.0.1:11434'
export const OLLAMA_PULL_DEFAULT_CONCURRENCY = 1
export const OLLAMA_PULL_MAX_CONCURRENCY = 3

/** A small set of well-known model families to seed the "Pull a model" guided picker with. This is
 *  DELIBERATELY NOT presented as Ollama's full official catalog — see docs/ollama-manager.md for why
 *  an exhaustive, paginated, revision-tracked catalog was out of scope for this pass, and what a
 *  future pass needs to do instead. Free-text entry (validated by isValidModelRef) remains the
 *  actual way to reach any model — this list exists only to give the guided form a starting point. */
export const OLLAMA_POPULAR_MODELS: { name: string; note: string }[] = [
  { name: 'llama3.2', note: "Meta's Llama 3.2 — general purpose, several sizes" },
  { name: 'llama3.1', note: "Meta's Llama 3.1 — general purpose, several sizes" },
  { name: 'qwen2.5', note: "Alibaba's Qwen 2.5 — general purpose + coding variants" },
  { name: 'mistral', note: "Mistral AI's 7B general-purpose model" },
  { name: 'phi3', note: "Microsoft's small, fast Phi-3" },
  { name: 'gemma2', note: "Google's Gemma 2" },
  { name: 'codellama', note: "Meta's Code Llama — code generation" },
  { name: 'deepseek-coder-v2', note: 'DeepSeek Coder V2 — code generation' },
  { name: 'nomic-embed-text', note: 'A text-embedding model (no chat)' },
  { name: 'llava', note: 'Multimodal (vision) chat model' }
]

/** Validates a "name" or "name:tag" model reference (the shape Ollama's own CLI accepts). Rejects
 *  anything with path separators, whitespace, or shell-meaningful characters — this string is
 *  later interpolated into a JSON body sent to Ollama's own local API, never into a shell command,
 *  but it is still worth keeping tight since it also becomes a filename fragment for chat exports. */
export function isValidModelRef(ref: string): boolean {
  return /^[a-z0-9]([a-z0-9._-]{0,90})(:[a-z0-9._-]{1,40})?$/i.test(ref.trim())
}

// ---------------------------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------------------------

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  createdAt: number
}

export interface OllamaChatParams {
  temperature: number
  topP: number
  numCtx: number
}

export const OLLAMA_CHAT_DEFAULT_PARAMS: OllamaChatParams = {
  temperature: 0.8,
  topP: 0.9,
  numCtx: 4096
}

export interface OllamaChatSession {
  id: string
  title: string
  model: string
  systemPrompt: string
  params: OllamaChatParams
  messages: OllamaChatMessage[]
  createdAt: number
  updatedAt: number
}

/** What the session list API returns — the full message array is NOT included (see
 *  chat-store.ts): the list is meant for a session picker, not for rendering a transcript. */
export type OllamaChatSessionSummary = Omit<OllamaChatSession, 'messages'> & { messageCount: number }

// ---------------------------------------------------------------------------------------------
// window.nodeTerminal.ollama — the renderer-facing API shape, implemented by the preload
// (Electron) and src/renderer/bridge (Server Edition) over the ollama:* IPC channels registered
// in src/core/ollama/register-ipc.ts.
// ---------------------------------------------------------------------------------------------

export interface OllamaApi {
  status(): Promise<OllamaStatus>
  models(): Promise<OllamaModelInfo[]>
  running(): Promise<OllamaRunningModel[]>
  show(model: string): Promise<{ contextLength: number | null; capabilities: string[] | null; parameterSize: string | null; quantization: string | null }>
  deleteModel(model: string): Promise<void>
  copyModel(source: string, destination: string): Promise<void>
  hardware(): Promise<HardwareEvidence>
  fit(refs: string[]): Promise<Record<string, FitEvaluation>>
  popularModels(): Promise<{ name: string; note: string }[]>
  pullState(): Promise<PullQueueState>
  pullEnqueue(refs: string[]): Promise<{ added: PullQueueItem[]; rejected: { ref: string; error: string }[] }>
  pullStart(): Promise<void>
  pullPause(): Promise<void>
  pullCancelItem(id: string): Promise<void>
  pullRetryItem(id: string): Promise<void>
  pullRemoveItem(id: string): Promise<void>
  pullSetConcurrency(n: number): Promise<number>
  onPullItem(listener: (item: PullQueueItem) => void): () => void
  onPullSummary(listener: (summary: Pick<PullQueueState, 'running' | 'concurrency'>) => void): () => void
  chatSessions(): Promise<OllamaChatSessionSummary[]>
  chatGet(id: string): Promise<OllamaChatSession | null>
  chatCreate(model: string, systemPrompt?: string): Promise<OllamaChatSession>
  chatRename(id: string, title: string): Promise<boolean>
  chatDelete(id: string): Promise<void>
  chatExport(id: string, format: 'json' | 'markdown'): Promise<string | null>
  chatSend(id: string, text: string): Promise<void>
  chatStop(id: string): Promise<void>
  onChatStream(
    listener: (evt: { sessionId: string; kind: 'token' | 'done' | 'error' | 'stopped'; delta?: string; error?: string }) => void
  ): () => void
}
