import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OllamaChatSession } from '../../shared/ollama'
import { OllamaClient } from './client'
import { OllamaChatStore, type ChatStreamEvent } from './chat-store'

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface ControlledChatCall {
  body: Parameters<OllamaClient['chatStream']>[0]
  onToken: Parameters<OllamaClient['chatStream']>[1]
  signal: AbortSignal | undefined
  result: Deferred<string>
}

class ControlledOllamaClient extends OllamaClient {
  readonly calls: ControlledChatCall[] = []
  onCall?: (call: ControlledChatCall, index: number) => void
  private callWaiters: Array<() => void> = []

  override chatStream(
    body: Parameters<OllamaClient['chatStream']>[0],
    onToken: Parameters<OllamaClient['chatStream']>[1],
    signal?: AbortSignal
  ): Promise<string> {
    const result = deferred<string>()
    const call = { body, onToken, signal, result }
    const index = this.calls.push(call) - 1
    for (const wake of this.callWaiters.splice(0)) wake()
    this.onCall?.(call, index)
    return result.promise
  }

  async waitForCall(index: number): Promise<ControlledChatCall> {
    while (!this.calls[index]) {
      await new Promise<void>((resolve) => this.callWaiters.push(resolve))
    }
    return this.calls[index]
  }
}

interface ChatStoreInternals {
  readSession(id: string): Promise<OllamaChatSession | null>
  writeSession(session: OllamaChatSession): Promise<void>
}

describe('OllamaChatStore same-session mutation ordering', () => {
  let root: string
  let client: ControlledOllamaClient
  let events: ChatStreamEvent[]
  let store: OllamaChatStore

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'nt-ollama-chat-'))
    client = new ControlledOllamaClient()
    events = []
    store = new OllamaChatStore(root, client, (event) => events.push(event))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  it('preserves a rename made while an earlier reply is still streaming', async () => {
    const session = await store.create('llama3.2')
    const sending = store.send(session.id, 'First question')
    const stream = await client.waitForCall(0)

    // Rename is a short mutation, not something that waits behind model generation. Completion
    // must re-read this newer document instead of publishing its pre-stream snapshot.
    await expect(store.rename(session.id, 'Named while streaming')).resolves.toBe(true)
    expect((await store.get(session.id))?.title).toBe('Named while streaming')

    stream.onToken('Answer one')
    stream.result.resolve('Answer one')
    await sending

    const saved = await store.get(session.id)
    expect(saved?.title).toBe('Named while streaming')
    expect(saved?.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'Answer one' }
    ])
    expect(events.map(({ kind }) => kind)).toEqual(['token', 'done'])
  })

  it('serializes a rename behind an in-flight final write without losing either change', async () => {
    const session = await store.create('llama3.2')
    const internal = store as unknown as ChatStoreInternals
    const realWrite = internal.writeSession.bind(store)
    const finalWriteEntered = deferred<void>()
    const releaseFinalWrite = deferred<void>()
    let heldFinalWrite = false
    vi.spyOn(internal, 'writeSession').mockImplementation(async (next) => {
      if (!heldFinalWrite && next.messages.length === 2) {
        heldFinalWrite = true
        finalWriteEntered.resolve()
        await releaseFinalWrite.promise
      }
      await realWrite(next)
    })

    const sending = store.send(session.id, 'Question before rename')
    const stream = await client.waitForCall(0)
    stream.result.resolve('Answer before rename')
    await finalWriteEntered.promise
    const renaming = store.rename(session.id, 'Renamed during final write')
    releaseFinalWrite.resolve()
    await Promise.all([sending, renaming])

    const saved = await store.get(session.id)
    expect(saved?.title).toBe('Renamed during final write')
    expect(saved?.messages.map(({ content }) => content)).toEqual([
      'Question before rename',
      'Answer before rename'
    ])
  })

  it('refuses traversal ids before reading or deleting outside the managed chat directory', async () => {
    const outside = join(root, 'victim.json')
    await writeFile(outside, '{"keep":true}', 'utf8')

    await expect(store.get('../../victim')).rejects.toThrow('Invalid chat session id')
    await expect(store.export('..\\..\\victim', 'json')).rejects.toThrow('Invalid chat session id')
    await expect(store.remove('../../victim')).rejects.toThrow('Invalid chat session id')
    expect(await readFile(outside, 'utf8')).toBe('{"keep":true}')
  })

  it('propagates a corrupt session read instead of treating it as absence', async () => {
    const session = await store.create('llama3.2')
    const file = join(root, 'ollama', 'chats', `${session.id}.json`)
    await writeFile(file, '{not valid json', 'utf8')

    await expect(store.get(session.id)).rejects.toBeInstanceOf(SyntaxError)
    await expect(store.rename(session.id, 'Must not replace corruption')).rejects.toBeInstanceOf(
      SyntaxError
    )
    expect(await readFile(file, 'utf8')).toBe('{not valid json')
  })

  it('propagates a failed unlink instead of reporting a chat directory as deleted', async () => {
    const session = await store.create('llama3.2')
    const file = join(root, 'ollama', 'chats', `${session.id}.json`)
    await rm(file)
    await mkdir(file)

    await expect(store.remove(session.id)).rejects.toMatchObject({
      code: expect.stringMatching(/^(EISDIR|EPERM)$/)
    })
  })

  it('rejects a second same-session generation before persisting or contacting Ollama', async () => {
    const session = await store.create('llama3.2')
    // If the synchronous generation lease is removed, make the forbidden second client call
    // settle promptly so this assertion turns red without a timeout.
    client.onCall = (call, index) => {
      if (index === 1) call.result.resolve('Forbidden second answer')
    }
    const firstSend = store.send(session.id, 'Question one')
    const secondSend = store.send(session.id, 'Question two')
    await expect(secondSend).rejects.toThrow('A reply is already being generated for this chat')

    const firstStream = await client.waitForCall(0)
    expect(client.calls).toHaveLength(1)
    expect((await store.get(session.id))?.messages.map(({ content }) => content)).toEqual(['Question one'])
    firstStream.onToken('Answer one')
    firstStream.result.resolve('Answer one')
    await firstSend

    const saved = await store.get(session.id)
    expect(saved?.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'Question one' },
      { role: 'assistant', content: 'Answer one' }
    ])
    expect(events.map(({ kind }) => kind)).toEqual(['token', 'done'])
  })

  it('aborts immediately but deletes after an in-flight final write, preventing resurrection', async () => {
    const session = await store.create('llama3.2')
    const internal = store as unknown as ChatStoreInternals
    const realWrite = internal.writeSession.bind(store)
    const finalWriteEntered = deferred<void>()
    const releaseFinalWrite = deferred<void>()
    let heldFinalWrite = false
    vi.spyOn(internal, 'writeSession').mockImplementation(async (next) => {
      if (!heldFinalWrite && next.messages.length === 2) {
        heldFinalWrite = true
        finalWriteEntered.resolve()
        await releaseFinalWrite.promise
      }
      await realWrite(next)
    })

    const sending = store.send(session.id, 'Delete this chat')
    const stream = await client.waitForCall(0)
    stream.result.resolve('A reply that finished at the same time')
    await finalWriteEntered.promise

    const removing = store.remove(session.id)
    expect(stream.signal?.aborted).toBe(true)
    releaseFinalWrite.resolve()
    await Promise.all([sending, removing])

    expect(await store.get(session.id)).toBeNull()
    expect(events.map(({ kind }) => kind)).toEqual(['stopped'])
  })

  it('Stop aborts its owned generation and emits exactly one stopped terminal event', async () => {
    const session = await store.create('llama3.2')
    const sending = store.send(session.id, 'Please stop')
    const stream = await client.waitForCall(0)
    stream.signal?.addEventListener('abort', () => stream.result.reject(new Error('aborted')), { once: true })

    store.stop(session.id)
    store.stop(session.id)
    await sending

    expect(stream.signal?.aborted).toBe(true)
    expect(events).toEqual([{ sessionId: session.id, kind: 'stopped' }])
    expect((await store.get(session.id))?.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'Please stop' }
    ])
  })

  it('continues the FIFO after a rejected mutation instead of poisoning later work', async () => {
    const session = await store.create('llama3.2')
    const internal = store as unknown as ChatStoreInternals
    const realRead = internal.readSession.bind(store)
    const failedReadEntered = deferred<void>()
    const releaseFailedRead = deferred<void>()
    let failOnce = true
    vi.spyOn(internal, 'readSession').mockImplementation(async (id) => {
      if (failOnce) {
        failOnce = false
        failedReadEntered.resolve()
        await releaseFailedRead.promise
        throw new Error('injected read failure')
      }
      return realRead(id)
    })

    const rejected = store.rename(session.id, 'This write fails')
    const rejectedAssertion = expect(rejected).rejects.toThrow('injected read failure')
    await failedReadEntered.promise
    const recovered = store.rename(session.id, 'Recovered title')
    releaseFailedRead.resolve()

    await rejectedAssertion
    await expect(recovered).resolves.toBe(true)
    expect((await store.get(session.id))?.title).toBe('Recovered title')
  })

  it('lets different sessions stream concurrently', async () => {
    const first = await store.create('llama3.2')
    const second = await store.create('llama3.2')
    const firstSend = store.send(first.id, 'First chat')
    const secondSend = store.send(second.id, 'Second chat')
    const streams = await Promise.all([client.waitForCall(0), client.waitForCall(1)])

    expect(client.calls.map((call) => call.body.messages[0]?.content).sort()).toEqual(['First chat', 'Second chat'])
    for (const stream of streams) {
      stream.result.resolve(stream.body.messages[0]?.content === 'First chat' ? 'First answer' : 'Second answer')
    }
    await Promise.all([firstSend, secondSend])

    expect((await store.get(first.id))?.messages.map(({ content }) => content)).toEqual(['First chat', 'First answer'])
    expect((await store.get(second.id))?.messages.map(({ content }) => content)).toEqual(['Second chat', 'Second answer'])
  })
})
