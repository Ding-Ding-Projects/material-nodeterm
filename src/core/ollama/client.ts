// Thin wrapper over Ollama's own documented LOCAL HTTP API (default http://127.0.0.1:11434). This
// is the ONLY thing in the app that talks to Ollama — no unofficial proxy, no cloud model service,
// and no shell-out: every call here is a plain HTTP request to the loopback address Ollama itself
// listens on. See docs/ollama-manager.md for the exact endpoints used and why.

import type { OllamaModelInfo, OllamaRunningModel } from '../../shared/ollama'
import { OLLAMA_DEFAULT_ENDPOINT } from '../../shared/ollama'

const HEALTH_TIMEOUT_MS = 2500
const REQUEST_TIMEOUT_MS = 8000

export class OllamaUnreachableError extends Error {}
export class OllamaHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
  }
}

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  return { signal: ctrl.signal, cancel: () => clearTimeout(t) }
}

export class OllamaClient {
  readonly endpoint: string

  constructor(endpoint: string = process.env.OLLAMA_HOST || OLLAMA_DEFAULT_ENDPOINT) {
    // OLLAMA_HOST may be given as a bare "host:port" (Ollama's own convention) — normalize to a URL.
    this.endpoint = /^https?:\/\//.test(endpoint) ? endpoint : `http://${endpoint}`
  }

  private async req(path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
    const { signal, cancel } = withTimeout(timeoutMs)
    try {
      const res = await fetch(`${this.endpoint}${path}`, { ...init, signal })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new OllamaHttpError(`Ollama ${path} → HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`, res.status)
      }
      return res
    } catch (e) {
      if (e instanceof OllamaHttpError) throw e
      throw new OllamaUnreachableError((e as Error).message || 'Ollama is unreachable')
    } finally {
      cancel()
    }
  }

  /** True/false only — never throws. Used for the health/troubleshooter surface. */
  async ping(): Promise<{ ok: boolean; version: string | null; detail: string | null }> {
    try {
      const res = await this.req('/api/version', {}, HEALTH_TIMEOUT_MS)
      const json = (await res.json()) as { version?: string }
      return { ok: true, version: json.version ?? null, detail: null }
    } catch (e) {
      return { ok: false, version: null, detail: (e as Error).message }
    }
  }

  async tags(): Promise<OllamaModelInfo[]> {
    const res = await this.req('/api/tags')
    const json = (await res.json()) as {
      models?: { name: string; size: number; digest: string; modified_at: string; details?: any }[]
    }
    return (json.models ?? []).map((m) => ({
      name: m.name,
      sizeBytes: m.size,
      digest: m.digest,
      modifiedAt: m.modified_at,
      details: {
        format: m.details?.format,
        family: m.details?.family,
        parameter_size: m.details?.parameter_size,
        quantization_level: m.details?.quantization_level
      },
      contextLength: null,
      capabilities: null
    }))
  }

  async ps(): Promise<OllamaRunningModel[]> {
    const res = await this.req('/api/ps')
    const json = (await res.json()) as {
      models?: { name: string; size: number; size_vram?: number; expires_at: string }[]
    }
    return (json.models ?? []).map((m) => ({
      name: m.name,
      sizeBytes: m.size,
      vramBytes: typeof m.size_vram === 'number' ? m.size_vram : null,
      expiresAt: m.expires_at
    }))
  }

  /** /api/show gives the metadata /api/tags doesn't: declared context length and, on newer Ollama
   *  builds, a `capabilities` array (e.g. ["completion","vision"]) — the ONLY thing that gates the
   *  chat surface's attachment control. Absent ⇒ null, treated as "not verified" everywhere. */
  async show(model: string): Promise<{ contextLength: number | null; capabilities: string[] | null; parameterSize: string | null; quantization: string | null }> {
    const res = await this.req('/api/show', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model })
    })
    const json = (await res.json()) as {
      model_info?: Record<string, unknown>
      capabilities?: string[]
      details?: { parameter_size?: string; quantization_level?: string }
    }
    let contextLength: number | null = null
    if (json.model_info) {
      for (const [k, v] of Object.entries(json.model_info)) {
        if (k.endsWith('.context_length') && typeof v === 'number') {
          contextLength = v
          break
        }
      }
    }
    return {
      contextLength,
      capabilities: Array.isArray(json.capabilities) ? json.capabilities : null,
      parameterSize: json.details?.parameter_size ?? null,
      quantization: json.details?.quantization_level ?? null
    }
  }

  async deleteModel(model: string): Promise<void> {
    await this.req('/api/delete', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model })
    })
  }

  async copyModel(source: string, destination: string): Promise<void> {
    await this.req('/api/copy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source, destination })
    })
  }

  /** Streams /api/pull's NDJSON progress. `onEvent` fires per line; the promise resolves when the
   *  stream ends with a "success" status, or rejects on error/abort. Ollama's pull is itself
   *  resumable across calls (content-addressed blob cache) — re-issuing pull after a cancel/crash
   *  picks back up from whatever layers are already on disk, so no extra resume logic is needed
   *  here beyond calling this again. */
  async pull(
    model: string,
    onEvent: (evt: { status: string; digest?: string; total?: number; completed?: number; error?: string }) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const res = await fetch(`${this.endpoint}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
      signal
    }).catch((e) => {
      throw new OllamaUnreachableError((e as Error).message)
    })
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '')
      throw new OllamaHttpError(`pull → HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`, res.status)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let sawError: string | null = null
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line) continue
        try {
          const evt = JSON.parse(line)
          if (evt.error) sawError = evt.error
          onEvent(evt)
        } catch {
          // a malformed line is skipped, not fatal — the stream continues
        }
      }
    }
    if (sawError) throw new Error(sawError)
  }

  /** Streams /api/chat's NDJSON tokens. `onToken` fires per chunk's `message.content`; resolves
   *  with the final full text once `done: true` arrives. */
  async chatStream(
    body: {
      model: string
      messages: { role: string; content: string }[]
      options?: Record<string, unknown>
    },
    onToken: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const res = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, stream: true }),
      signal
    }).catch((e) => {
      throw new OllamaUnreachableError((e as Error).message)
    })
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '')
      throw new OllamaHttpError(`chat → HTTP ${res.status}${errText ? `: ${errText.slice(0, 300)}` : ''}`, res.status)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let full = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line) continue
        try {
          const evt = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string }
          if (evt.error) throw new Error(evt.error)
          const delta = evt.message?.content ?? ''
          if (delta) {
            full += delta
            onToken(delta)
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue // malformed line — skip
          throw e
        }
      }
    }
    return full
  }
}
