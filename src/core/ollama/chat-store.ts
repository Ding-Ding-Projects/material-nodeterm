// Local chat session persistence + streaming orchestration for the Ollama chat surface. One JSON
// file per session under `<userData>/ollama/chats/<id>.json`. Streaming tokens are pushed to the
// caller via a callback (register-ipc.ts broadcasts them as `ollama:chat-stream` events); the
// session file is written once the stream settles (done, stopped, or errored) rather than on every
// token, so a fast model doesn't turn every response into dozens of disk writes.

import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  OLLAMA_CHAT_DEFAULT_PARAMS,
  type OllamaChatMessage,
  type OllamaChatParams,
  type OllamaChatSession,
  type OllamaChatSessionSummary
} from '../../shared/ollama'
import type { OllamaClient } from './client'

let nextId = 1
function freshId(): string {
  return `ch_${Date.now().toString(36)}_${(nextId++).toString(36)}`
}

export interface ChatStreamEvent {
  sessionId: string
  kind: 'token' | 'done' | 'error' | 'stopped'
  delta?: string
  error?: string
}

export class OllamaChatStore {
  private readonly dir: string
  private readonly controllers = new Map<string, AbortController>()

  constructor(
    userDataDir: string,
    private readonly client: OllamaClient,
    private readonly onStream: (evt: ChatStreamEvent) => void
  ) {
    this.dir = join(userDataDir, 'ollama', 'chats')
  }

  private fileFor(id: string): string {
    return join(this.dir, `${id}.json`)
  }

  private async readSession(id: string): Promise<OllamaChatSession | null> {
    try {
      const raw = await readFile(this.fileFor(id), 'utf8')
      return JSON.parse(raw) as OllamaChatSession
    } catch {
      return null
    }
  }

  private async writeSession(session: OllamaChatSession): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const tmp = `${this.fileFor(session.id)}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tmp, JSON.stringify(session, null, 2), 'utf8')
    await rename(tmp, this.fileFor(session.id))
  }

  async list(): Promise<OllamaChatSessionSummary[]> {
    await mkdir(this.dir, { recursive: true })
    let files: string[]
    try {
      files = (await readdir(this.dir)).filter((f) => f.endsWith('.json') && !f.includes('.tmp-'))
    } catch {
      return []
    }
    const out: OllamaChatSessionSummary[] = []
    for (const f of files) {
      try {
        const raw = await readFile(join(this.dir, f), 'utf8')
        const s = JSON.parse(raw) as OllamaChatSession
        const { messages, ...rest } = s
        out.push({ ...rest, messageCount: messages.length })
      } catch {
        // a corrupt session file is skipped rather than crashing the whole list
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(id: string): Promise<OllamaChatSession | null> {
    return this.readSession(id)
  }

  async create(model: string, systemPrompt = '', params: OllamaChatParams = OLLAMA_CHAT_DEFAULT_PARAMS): Promise<OllamaChatSession> {
    const now = Date.now()
    const session: OllamaChatSession = {
      id: freshId(),
      title: 'New chat',
      model,
      systemPrompt,
      params,
      messages: [],
      createdAt: now,
      updatedAt: now
    }
    await this.writeSession(session)
    return session
  }

  async rename(id: string, title: string): Promise<boolean> {
    const s = await this.readSession(id)
    if (!s) return false
    s.title = title.slice(0, 200)
    s.updatedAt = Date.now()
    await this.writeSession(s)
    return true
  }

  async remove(id: string): Promise<void> {
    this.controllers.get(id)?.abort()
    try {
      await unlink(this.fileFor(id))
    } catch {
      // already gone
    }
  }

  async export(id: string, format: 'json' | 'markdown'): Promise<string | null> {
    const s = await this.readSession(id)
    if (!s) return null
    if (format === 'json') return JSON.stringify(s, null, 2)
    const lines = [
      `# ${s.title}`,
      '',
      `Model: ${s.model}  \nExported: ${new Date().toISOString()}`,
      s.systemPrompt ? `\n**System prompt:** ${s.systemPrompt}\n` : '',
      ''
    ]
    for (const m of s.messages) {
      lines.push(`### ${m.role} — ${new Date(m.createdAt).toISOString()}`)
      lines.push('')
      lines.push(m.content)
      lines.push('')
    }
    return lines.join('\n')
  }

  stop(id: string): void {
    this.controllers.get(id)?.abort()
  }

  /** Appends the user message, streams the assistant reply, and persists once the stream settles.
   *  Throws only for a session that doesn't exist — a mid-stream failure is reported via the
   *  'error' stream event and the partial session state is still saved (the user message is never
   *  lost even if the model call fails). */
  async send(id: string, userText: string): Promise<void> {
    const session = await this.readSession(id)
    if (!session) throw new Error('Chat session not found')
    const now = Date.now()
    session.messages.push({ role: 'user', content: userText, createdAt: now })
    if (session.title === 'New chat') session.title = userText.slice(0, 60)
    session.updatedAt = now
    await this.writeSession(session)

    const ctrl = new AbortController()
    this.controllers.set(id, ctrl)
    const wireMessages = [
      ...(session.systemPrompt ? [{ role: 'system', content: session.systemPrompt }] : []),
      ...session.messages.map((m) => ({ role: m.role, content: m.content }))
    ]
    try {
      const full = await this.client.chatStream(
        {
          model: session.model,
          messages: wireMessages,
          options: {
            temperature: session.params.temperature,
            top_p: session.params.topP,
            num_ctx: session.params.numCtx
          }
        },
        (delta) => this.onStream({ sessionId: id, kind: 'token', delta }),
        ctrl.signal
      )
      session.messages.push({ role: 'assistant', content: full, createdAt: Date.now() })
      session.updatedAt = Date.now()
      await this.writeSession(session)
      this.onStream({ sessionId: id, kind: 'done' })
    } catch (e) {
      if (ctrl.signal.aborted) {
        this.onStream({ sessionId: id, kind: 'stopped' })
      } else {
        this.onStream({ sessionId: id, kind: 'error', error: (e as Error).message })
      }
    } finally {
      this.controllers.delete(id)
    }
  }
}

export type { OllamaChatMessage }
