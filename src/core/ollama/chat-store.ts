// Local chat session persistence + streaming orchestration for the Ollama chat surface. One JSON
// file per session under `<userData>/ollama/chats/<id>.json`. Streaming tokens are pushed to the
// caller via a callback (register-ipc.ts broadcasts them as `ollama:chat-stream` events); the
// session file is written once the stream settles (done, stopped, or errored) rather than on every
// token, so a fast model doesn't turn every response into dozens of disk writes.

import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  OLLAMA_CHAT_DEFAULT_PARAMS,
  type OllamaChatMessage,
  type OllamaChatParams,
  type OllamaChatSession,
  type OllamaChatSessionSummary
} from '../../shared/ollama'
import type { OllamaClient } from './client'
import { renameAtomic } from '../fs-atomic'

let nextId = 1
const CHAT_ID_RE = /^ch_[0-9a-z]+_[0-9a-z]+$/

function freshId(): string {
  return `ch_${Date.now().toString(36)}_${(nextId++).toString(36)}`
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : ''
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
  private readonly mutationTails = new Map<string, Promise<void>>()

  constructor(
    userDataDir: string,
    private readonly client: OllamaClient,
    private readonly onStream: (evt: ChatStreamEvent) => void
  ) {
    this.dir = join(userDataDir, 'ollama', 'chats')
  }

  private fileFor(id: string): string {
    // IDs cross IPC/RPC boundaries. Joining an unchecked `../` id would let get/export/remove
    // escape the managed chat directory, especially on Windows where either separator is valid.
    if (!CHAT_ID_RE.test(id)) throw new Error('Invalid chat session id')
    return join(this.dir, `${id}.json`)
  }

  /** Session files are whole-document snapshots, so an atomic replacement only prevents torn
   *  bytes; it cannot stop an older read from overwriting a newer generation. Keep the complete
   *  read -> decision -> write operation in one per-session FIFO. A settled tail deliberately
   *  swallows either outcome so one failed mutation cannot poison everything queued behind it. */
  private async serializeMutation<T>(id: string, mutation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTails.get(id) ?? Promise.resolve()
    const run = previous.then(mutation)
    const settled = run.then(
      () => undefined,
      () => undefined
    )
    this.mutationTails.set(id, settled)
    try {
      return await run
    } finally {
      if (this.mutationTails.get(id) === settled) this.mutationTails.delete(id)
    }
  }

  private async readSession(id: string): Promise<OllamaChatSession | null> {
    try {
      const raw = await readFile(this.fileFor(id), 'utf8')
      return JSON.parse(raw) as OllamaChatSession
    } catch (error) {
      // Absence is the only null result. Permission, I/O, and parse failures must remain visible;
      // treating them as missing can make a later mutation overwrite or delete recoverable state.
      if (errorCode(error) === 'ENOENT') return null
      throw error
    }
  }

  private async writeSession(session: OllamaChatSession): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const tmp = `${this.fileFor(session.id)}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tmp, JSON.stringify(session, null, 2), 'utf8')
    await renameAtomic(tmp, this.fileFor(session.id))
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
    return this.serializeMutation(id, async () => {
      const s = await this.readSession(id)
      if (!s) return false
      s.title = title.slice(0, 200)
      s.updatedAt = Date.now()
      await this.writeSession(s)
      return true
    })
  }

  async remove(id: string): Promise<void> {
    this.controllers.get(id)?.abort()
    await this.serializeMutation(id, async () => {
      try {
        await unlink(this.fileFor(id))
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error
      }
    })
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
    // Reserve the generation before the first await. Stream events carry only a session id, so
    // two generations cannot be rendered honestly; queuing the second would also have no matching
    // "started" event after the first generation's "done" makes the panel idle.
    if (this.controllers.has(id)) throw new Error('A reply is already being generated for this chat')
    const ctrl = new AbortController()
    this.controllers.set(id, ctrl)

    let session: OllamaChatSession
    try {
      session = await this.serializeMutation(id, async () => {
        const latest = await this.readSession(id)
        if (!latest) throw new Error('Chat session not found')
        const now = Date.now()
        latest.messages.push({ role: 'user', content: userText, createdAt: now })
        if (latest.title === 'New chat') latest.title = userText.slice(0, 60)
        latest.updatedAt = now
        await this.writeSession(latest)
        return latest
      })
    } catch (e) {
      if (this.controllers.get(id) === ctrl) this.controllers.delete(id)
      throw e
    }

    let terminalEventSent = false
    const emitTerminal = (event: ChatStreamEvent): void => {
      if (terminalEventSent) return
      terminalEventSent = true
      this.onStream(event)
    }
    const emitStopped = (): void => emitTerminal({ sessionId: id, kind: 'stopped' })

    try {
      if (ctrl.signal.aborted) {
        emitStopped()
        return
      }

      const wireMessages = [
        ...(session.systemPrompt ? [{ role: 'system', content: session.systemPrompt }] : []),
        ...session.messages.map((m) => ({ role: m.role, content: m.content }))
      ]
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
        (delta) => {
          if (!ctrl.signal.aborted) this.onStream({ sessionId: id, kind: 'token', delta })
        },
        ctrl.signal
      )
      if (ctrl.signal.aborted) {
        emitStopped()
        return
      }

      // A rename may have landed during the stream. Re-read under the same mutation authority and
      // merge only the assistant message; publishing the pre-stream snapshot would erase it.
      const persisted = await this.serializeMutation(id, async (): Promise<'saved' | 'missing' | 'aborted'> => {
        if (ctrl.signal.aborted) return 'aborted'
        const latest = await this.readSession(id)
        if (!latest) return 'missing'
        if (ctrl.signal.aborted) return 'aborted'
        latest.messages.push({ role: 'assistant', content: full, createdAt: Date.now() })
        latest.updatedAt = Date.now()
        await this.writeSession(latest)
        return 'saved'
      })
      if (ctrl.signal.aborted || persisted === 'aborted') {
        emitStopped()
      } else if (persisted === 'missing') {
        emitTerminal({ sessionId: id, kind: 'error', error: 'Chat session was removed before the reply could be saved' })
      } else {
        emitTerminal({ sessionId: id, kind: 'done' })
      }
    } catch (e) {
      if (ctrl.signal.aborted) {
        emitStopped()
      } else {
        emitTerminal({ sessionId: id, kind: 'error', error: (e as Error).message })
      }
    } finally {
      if (this.controllers.get(id) === ctrl) this.controllers.delete(id)
    }
  }
}

export type { OllamaChatMessage }
