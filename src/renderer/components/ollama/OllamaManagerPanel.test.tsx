// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeTerminalApi } from '@shared/types'
import type { OllamaApi, OllamaChatSession, OllamaModelInfo } from '@shared/ollama'
import { E_UNSUPPORTED } from '@shared/rpc'

let activeApi: NodeTerminalApi

vi.mock('../../session/session', () => ({
  useActiveSessionApi: () => activeApi
}))

vi.mock('../promptDialog', () => ({
  promptDialog: () => Promise.resolve('Renamed after switch')
}))

import { OllamaManagerPanel } from './OllamaManagerPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const model = (name: string): OllamaModelInfo => ({
  name,
  sizeBytes: 1024,
  digest: `digest-${name}`,
  modifiedAt: '2026-08-15T00:00:00.000Z',
  details: {},
  contextLength: null,
  capabilities: null
})

const chat = (id: string, modelName: string): OllamaChatSession => ({
  id,
  title: `Chat ${id}`,
  model: modelName,
  systemPrompt: '',
  params: { temperature: 0.8, topP: 0.9, numCtx: 4096 },
  messages: [],
  createdAt: 1,
  updatedAt: 1
})

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function ollamaHarness(label: string, statusError?: Error & { code?: string }) {
  const status = statusError
    ? vi.fn().mockRejectedValue(statusError)
    : vi.fn().mockResolvedValue({
        health: 'ok' as const,
        endpoint: `http://${label}.example:11434`,
        version: label,
        detail: null,
        checkedAt: 1
      })
  const ollama = {
    status,
    models: vi.fn().mockResolvedValue([model(`${label}-model`)]),
    running: vi.fn().mockResolvedValue([]),
    show: vi.fn().mockResolvedValue({
      contextLength: null,
      capabilities: null,
      parameterSize: null,
      quantization: null
    }),
    deleteModel: vi.fn().mockResolvedValue(undefined),
    copyModel: vi.fn().mockResolvedValue(undefined),
    hardware: vi.fn().mockResolvedValue({
      totalRamBytes: 8 * 1024 ** 3,
      freeRamBytes: 4 * 1024 ** 3,
      gpuName: null,
      vramBytes: null,
      freeDiskBytes: 20 * 1024 ** 3,
      arch: 'x64',
      platform: 'linux',
      computedAt: 1
    }),
    fit: vi.fn().mockResolvedValue({}),
    popularModels: vi.fn().mockResolvedValue([]),
    pullState: vi.fn().mockResolvedValue({ items: [], concurrency: 1, running: false }),
    pullEnqueue: vi.fn().mockResolvedValue({ added: [], rejected: [] }),
    pullStart: vi.fn().mockResolvedValue(undefined),
    pullPause: vi.fn().mockResolvedValue(undefined),
    pullCancelItem: vi.fn().mockResolvedValue(undefined),
    pullRetryItem: vi.fn().mockResolvedValue(undefined),
    pullRemoveItem: vi.fn().mockResolvedValue(undefined),
    pullSetConcurrency: vi.fn().mockResolvedValue(1),
    onPullItem: vi.fn(() => () => {}),
    onPullSummary: vi.fn(() => () => {}),
    chatSessions: vi.fn().mockResolvedValue([]),
    chatGet: vi.fn().mockResolvedValue(null),
    chatCreate: vi.fn().mockImplementation((modelName: string) =>
      Promise.resolve(chat(`${label}-chat`, modelName))
    ),
    chatRename: vi.fn().mockResolvedValue(true),
    chatDelete: vi.fn().mockResolvedValue(undefined),
    chatExport: vi.fn().mockResolvedValue(null),
    chatSend: vi.fn().mockResolvedValue(undefined),
    chatStop: vi.fn().mockResolvedValue(undefined),
    onChatStream: vi.fn(() => () => {})
  }
  return {
    api: { ollama: ollama as unknown as OllamaApi } as unknown as NodeTerminalApi,
    ollama
  }
}

let host: HTMLDivElement
let root: Root

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

function button(label: string, within: ParentNode = document.body): HTMLButtonElement {
  const found = [...within.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === label
  )
  if (!found) throw new Error(`No button named ${label}`)
  return found
}

function maybeButton(label: string, within: ParentNode = document.body): HTMLButtonElement | undefined {
  return [...within.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === label
  )
}

function changeTextarea(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (!setter) throw new Error('No native textarea value setter')
  setter.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

function changeInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('No native input value setter')
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn()
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
})

describe('OllamaManagerPanel project-session routing', () => {
  it('uses the active project api for reads and installed-model deletion, never the global preload', async () => {
    const global = ollamaHarness('wrong-global')
    const local = ollamaHarness('active-local')
    ;(window as unknown as { nodeTerminal: NodeTerminalApi }).nodeTerminal = global.api
    activeApi = local.api

    act(() => root.render(<OllamaManagerPanel onClose={() => {}} />))
    await settle()

    expect(local.ollama.status).toHaveBeenCalledTimes(1)
    expect(global.ollama.status).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('active-local')
    expect(document.body.textContent).not.toContain('wrong-global')

    act(() => button('Installed').click())
    expect(document.body.textContent).toContain('active-local-model')
    act(() => button('Delete').click())
    const confirm = document.body.querySelector('.confirm')!
    act(() => button('Delete', confirm).click())
    await settle()

    expect(local.ollama.deleteModel).toHaveBeenCalledWith('active-local-model')
    expect(global.ollama.deleteModel).not.toHaveBeenCalled()
  })

  it('shows the relay api E_UNSUPPORTED refusal instead of falling back to the local preload', async () => {
    const local = ollamaHarness('local-preload')
    const unsupported = Object.assign(new Error('ollama.status is not supported for relay projects'), {
      code: E_UNSUPPORTED
    })
    const relay = ollamaHarness('relay', unsupported)
    ;(window as unknown as { nodeTerminal: NodeTerminalApi }).nodeTerminal = local.api
    activeApi = relay.api

    act(() => root.render(<OllamaManagerPanel onClose={() => {}} />))
    await settle()

    expect(relay.ollama.status).toHaveBeenCalledTimes(1)
    expect(local.ollama.status).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(E_UNSUPPORTED)
    expect(document.body.textContent).toMatch(/relay|remote project/i)
  })

  it('invalidates an installed-model confirmation when the active project api changes', async () => {
    const first = ollamaHarness('first')
    const second = ollamaHarness('second')
    ;(window as unknown as { nodeTerminal: NodeTerminalApi }).nodeTerminal = first.api
    activeApi = first.api

    act(() => root.render(<OllamaManagerPanel onClose={() => {}} />))
    await settle()
    act(() => button('Installed').click())
    act(() => button('Delete').click())
    expect(document.body.querySelector('.confirm')).not.toBeNull()

    activeApi = second.api
    act(() => root.render(<OllamaManagerPanel onClose={() => {}} />))
    await settle()

    // If stale confirmation survived, exercising it would delete first-model through SECOND's api.
    const staleConfirm = document.body.querySelector('.confirm')
    if (staleConfirm) {
      act(() => button('Delete', staleConfirm).click())
      await settle()
    }
    expect(document.body.querySelector('.confirm')).toBeNull()
    expect(first.ollama.deleteModel).not.toHaveBeenCalled()
    expect(second.ollama.deleteModel).not.toHaveBeenCalled()
  })

  it('drops an API A model draft before API B store controls become interactive', async () => {
    const first = ollamaHarness('first')
    const second = ollamaHarness('second')
    activeApi = first.api
    act(() => root.render(<OllamaManagerPanel onClose={() => {}} />))
    await settle()
    act(() => button('Model store').click())
    const firstDraft = document.body.querySelector<HTMLInputElement>(
      'input[placeholder^="Exact model reference"]'
    )!
    act(() => changeInput(firstDraft, 'first-machine-only:latest'))
    expect(firstDraft.value).toBe('first-machine-only:latest')

    activeApi = second.api
    act(() => root.render(<OllamaManagerPanel onClose={() => {}} />))
    await settle()
    act(() => button('Model store').click())
    const secondDraft = document.body.querySelector<HTMLInputElement>(
      'input[placeholder^="Exact model reference"]'
    )!

    expect(secondDraft).not.toBe(firstDraft)
    expect(secondDraft.value).toBe('')
    expect(second.ollama.pullEnqueue).not.toHaveBeenCalled()
  })

  it('does not let a stale API A delete completion erase API B E_UNSUPPORTED state', async () => {
    const deletion = deferred<void>()
    const first = ollamaHarness('first')
    first.ollama.deleteModel.mockReturnValue(deletion.promise)
    const unsupported = Object.assign(new Error('ollama.status is not supported for relay projects'), {
      code: E_UNSUPPORTED
    })
    const second = ollamaHarness('relay', unsupported)
    const onToast = vi.fn()
    window.addEventListener('nodeterm:toast', onToast)
    try {
      ;(window as unknown as { nodeTerminal: NodeTerminalApi }).nodeTerminal = first.api
      activeApi = first.api

      act(() => root.render(<OllamaManagerPanel onClose={() => {}} />))
      await settle()
      act(() => button('Installed').click())
      act(() => button('Delete').click())
      act(() => button('Delete', document.body.querySelector('.confirm')!).click())

      activeApi = second.api
      act(() => root.render(<OllamaManagerPanel onClose={() => {}} />))
      await settle()
      expect(document.body.textContent).toContain(E_UNSUPPORTED)
      expect(document.body.textContent).not.toContain('Checking…')

      await act(async () => {
        deletion.resolve()
        for (let i = 0; i < 5; i++) await Promise.resolve()
      })

      expect(document.body.textContent).toContain(E_UNSUPPORTED)
      expect(document.body.textContent).not.toContain('Checking…')
      expect(first.ollama.status).toHaveBeenCalledTimes(1)
      expect(second.ollama.status).toHaveBeenCalledTimes(1)
      expect(onToast).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('nodeterm:toast', onToast)
    }
  })

  it('does not let a stale API A delete completion clear API B fresh confirmation', async () => {
    const deletion = deferred<void>()
    const first = ollamaHarness('first')
    const second = ollamaHarness('second')
    first.ollama.deleteModel.mockReturnValue(deletion.promise)
    ;(window as unknown as { nodeTerminal: NodeTerminalApi }).nodeTerminal = first.api
    activeApi = first.api

    act(() => root.render(<OllamaManagerPanel onClose={() => {}} />))
    await settle()
    act(() => button('Installed').click())
    act(() => button('Delete').click())
    act(() => button('Delete', document.body.querySelector('.confirm')!).click())

    activeApi = second.api
    act(() => root.render(<OllamaManagerPanel onClose={() => {}} />))
    await settle()
    act(() => button('Installed').click())
    act(() => button('Delete').click())
    expect(document.body.querySelector('.confirm')?.textContent).toContain('second-model')

    await act(async () => {
      deletion.resolve()
      for (let i = 0; i < 5; i++) await Promise.resolve()
    })

    expect(document.body.querySelector('.confirm')?.textContent).toContain('second-model')
    expect(second.ollama.deleteModel).not.toHaveBeenCalled()
  })

  it('drops API A chat state before API B can receive A session ids', async () => {
    const first = ollamaHarness('first')
    const second = ollamaHarness('second')
    ;(window as unknown as { nodeTerminal: NodeTerminalApi }).nodeTerminal = first.api
    activeApi = first.api

    act(() => root.render(<OllamaManagerPanel onClose={() => {}} />))
    await settle()
    act(() => button('Chat').click())
    await settle()
    act(() => button('New chat').click())
    await settle()
    expect(first.ollama.chatCreate).toHaveBeenCalledWith('first-model', '')
    expect(maybeButton('Rename')).toBeDefined()
    const composer = document.body.querySelector<HTMLTextAreaElement>('.om-chat__composer textarea')!
    act(() => changeTextarea(composer, 'message owned by first'))

    activeApi = second.api
    act(() => root.render(<OllamaManagerPanel onClose={() => {}} />))
    await settle()

    act(() => button('Chat').click())
    await settle()

    // Exercise every stale control if one survived the switch; each would otherwise call API B
    // with first-chat, an id minted by API A.
    const rename = maybeButton('Rename')
    if (rename) {
      act(() => rename.click())
      await settle()
    }
    const send = maybeButton('Send')
    if (send) {
      act(() => send.click())
      await settle()
    }
    const remove = maybeButton('Delete', document.body.querySelector('.om-chat') ?? document.body)
    if (remove) {
      act(() => remove.click())
      const confirm = document.body.querySelector('.confirm')
      if (confirm) act(() => button('Delete', confirm).click())
      await settle()
    }

    expect(document.body.textContent).toContain('No chat open')
    expect(second.ollama.chatRename).not.toHaveBeenCalled()
    expect(second.ollama.chatSend).not.toHaveBeenCalled()
    expect(second.ollama.chatDelete).not.toHaveBeenCalled()
  })
})

/** A catalog payload shaped exactly like the core's snapshot, so these tests exercise the real
 *  parse → page → render path rather than a convenient stand-in. */
function catalogPayload(over: Record<string, unknown> = {}): unknown {
  return {
    kind: 'ollama-catalog',
    version: 1,
    models: [
      {
        name: 'llama3.2',
        origin: 'registry',
        tagsState: 'resolved',
        tagsError: null,
        tagsFetchedAt: 10,
        tags: [
          {
            tag: 'latest',
            sizeBytes: 2_000_000_000,
            sizeExact: false,
            revision: 'a80c4f17acd5',
            revisionExact: false,
            publishedAt: null,
            installed: false,
            facts: 'unresolved',
            factsError: null,
            fetchedAt: 10
          }
        ]
      },
      { name: 'qwen2.5', origin: 'registry', tagsState: 'unresolved', tagsError: null, tagsFetchedAt: null, tags: [] }
    ],
    index: { state: 'resolved', fetchedAt: 1000, error: null, count: 2 },
    installed: { state: 'resolved', error: null, fetchedAt: 1000 },
    registry: { enabled: true, disabledReason: null, indexUrl: 'https://ollama.com/library', manifestHost: 'registry.ollama.ai' },
    refresh: { state: 'idle', startedAt: 1, finishedAt: 2, lastError: null, pendingTagFetches: 1, pendingFactFetches: 1 },
    cache: { state: 'loaded', error: null },
    completeness: {
      state: 'partial',
      modelsKnown: 2,
      tagsKnown: 1,
      reasons: ['1 of 2 models have not had their tag list fetched yet.']
    },
    staleness: 'fresh',
    ttlMs: 43_200_000,
    computedAt: 2000,
    ...over
  }
}

describe('OllamaManagerPanel model store', () => {
  it('lists real catalog references and states that a partial catalog is partial', async () => {
    const harness = ollamaHarness('catalog')
    harness.ollama.popularModels.mockResolvedValue(catalogPayload() as never)
    activeApi = harness.api
    act(() => root.render(<OllamaManagerPanel onClose={() => {}} />))
    await settle()
    act(() => button('Model store').click())
    await settle()

    expect(document.body.textContent).toContain('llama3.2:latest')
    expect(document.body.textContent).toContain('qwen2.5')
    expect(document.body.textContent).toContain('not yet the whole catalog')
    expect(document.body.textContent).not.toContain('Complete first-party library')
    // The pull path still works from a catalog row.
    act(() => button('Add to cart').click())
    await settle()
    expect(harness.ollama.pullEnqueue).toHaveBeenCalledWith(['llama3.2:latest'])
  })

  it('shows a catalog load failure as a failure, never as an empty catalog, and keeps the exact-reference fallback usable', async () => {
    const harness = ollamaHarness('catalog-down')
    harness.ollama.popularModels.mockRejectedValue(new Error('ECONNRESET'))
    activeApi = harness.api
    act(() => root.render(<OllamaManagerPanel onClose={() => {}} />))
    await settle()
    act(() => button('Model store').click())
    await settle()

    expect(document.body.textContent).toContain('ECONNRESET')
    expect(document.body.textContent).toContain('not an empty catalog')
    const draft = document.body.querySelector<HTMLInputElement>('input[placeholder^="Exact model reference"]')!
    act(() => changeInput(draft, 'llama3.2:1b'))
    act(() => button('Add').click())
    await settle()
    expect(harness.ollama.pullEnqueue).toHaveBeenCalledWith(['llama3.2:1b'])
  })

  it('claims a complete catalog only when the core says it is complete', async () => {
    const harness = ollamaHarness('catalog-complete')
    harness.ollama.popularModels.mockResolvedValue(
      catalogPayload({
        completeness: { state: 'complete', modelsKnown: 234, tagsKnown: 9412, reasons: [] }
      }) as never
    )
    activeApi = harness.api
    act(() => root.render(<OllamaManagerPanel onClose={() => {}} />))
    await settle()
    act(() => button('Model store').click())
    await settle()
    expect(document.body.textContent).toContain('Complete first-party library')
    expect(document.body.textContent).toContain('9412')
  })

  it('shows an installed row\'s date honestly as "installed <date>", never as an unlabeled publish date', async () => {
    const harness = ollamaHarness('installed-date')
    harness.ollama.popularModels.mockResolvedValue(
      catalogPayload({
        models: [
          {
            name: 'llama3.2',
            origin: 'registry',
            tagsState: 'resolved',
            tagsError: null,
            tagsFetchedAt: 10,
            tags: [
              {
                tag: '1b',
                sizeBytes: 1_000_000,
                sizeExact: true,
                revision: 'sha256:aa',
                revisionExact: true,
                publishedAt: '2026-08-15T00:00:00.000Z',
                installed: true,
                facts: 'resolved',
                factsError: null,
                fetchedAt: 10
              }
            ]
          }
        ]
      }) as never
    )
    activeApi = harness.api
    act(() => root.render(<OllamaManagerPanel onClose={() => {}} />))
    await settle()
    act(() => button('Model store').click())
    await settle()

    // publishedAt on this codepath is never a real publish date — it is only ever an installed
    // model's local /api/tags modified_at (catalog-types.ts). Labeling it "installed" says what it
    // actually is.
    expect(document.body.textContent).toContain(`installed ${new Date('2026-08-15T00:00:00.000Z').toLocaleDateString()}`)
    expect(document.body.textContent).not.toContain('no published date')
  })

  it('puts the ellipsis on the truncated full digest, not on the already-complete short digest', async () => {
    const harness = ollamaHarness('revision-precision')
    harness.ollama.popularModels.mockResolvedValue(
      catalogPayload({
        models: [
          {
            name: 'llama3.2',
            origin: 'registry',
            tagsState: 'resolved',
            tagsError: null,
            tagsFetchedAt: 10,
            tags: [
              {
                // A full 64-hex manifest digest: sliced to 12 chars for display, which IS a
                // truncation and must carry the "…".
                tag: 'exact-digest',
                sizeBytes: 1_000_000,
                sizeExact: true,
                revision: `sha256:${'a'.repeat(64)}`,
                revisionExact: true,
                publishedAt: null,
                installed: false,
                facts: 'resolved',
                factsError: null,
                fetchedAt: 10
              },
              {
                // The library page's own 12-hex short digest, printed complete — appending "…"
                // here would claim more digits exist than were ever fetched.
                tag: 'short-digest',
                sizeBytes: 2_000_000,
                sizeExact: false,
                revision: 'baf6a787fdff',
                revisionExact: false,
                publishedAt: null,
                installed: false,
                facts: 'unresolved',
                factsError: null,
                fetchedAt: 10
              }
            ]
          }
        ],
        completeness: { state: 'complete', modelsKnown: 1, tagsKnown: 2, reasons: [] }
      }) as never
    )
    activeApi = harness.api
    act(() => root.render(<OllamaManagerPanel onClose={() => {}} />))
    await settle()
    act(() => button('Model store').click())
    await settle()

    expect(document.body.textContent).toContain(`rev ${'a'.repeat(12)}…`)
    expect(document.body.textContent).toContain('rev baf6a787fdff')
    expect(document.body.textContent).not.toContain('rev baf6a787fdff…')
  })
})

describe('OllamaManagerPanel model store — hardware-fit and progress-poll timing', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not re-ask ollama.fit on every 3s catalog poll when the visible refs have not changed', async () => {
    vi.useFakeTimers()
    const harness = ollamaHarness('fit-storm')
    // Every call returns a FRESH object — exactly what the real argument-less IPC channel returns
    // on every poll — but the same model/tag content, so the set of refs actually on screen never
    // changes across polls.
    harness.ollama.popularModels.mockImplementation(() =>
      Promise.resolve(
        catalogPayload({
          refresh: {
            state: 'running',
            startedAt: 1,
            finishedAt: null,
            lastError: null,
            pendingTagFetches: 1,
            pendingFactFetches: 1
          }
        }) as never
      )
    )
    activeApi = harness.api
    act(() => root.render(<OllamaManagerPanel onClose={() => {}} />))
    await settle()
    act(() => button('Model store').click())
    await settle()

    const fitCallsAfterInitialLoad = harness.ollama.fit.mock.calls.length
    expect(fitCallsAfterInitialLoad).toBeGreaterThan(0)

    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
    }

    // The poll really did keep running (this is what defect 3 also pins) …
    expect(harness.ollama.popularModels.mock.calls.length).toBeGreaterThan(1)
    // … but with the same refs on screen every time, ollama.fit must not have been re-asked.
    expect(harness.ollama.fit.mock.calls.length).toBe(fitCallsAfterInitialLoad)
  })

  it('keeps polling for catalog progress after one transient load failure, and stops once the core reports the refresh idle', async () => {
    vi.useFakeTimers()
    const harness = ollamaHarness('poll-resilience')
    let call = 0
    harness.ollama.popularModels.mockImplementation(() => {
      call++
      if (call === 1) {
        return Promise.resolve(
          catalogPayload({
            refresh: {
              state: 'running',
              startedAt: 1,
              finishedAt: null,
              lastError: null,
              pendingTagFetches: 3,
              pendingFactFetches: 3
            }
          }) as never
        )
      }
      if (call === 2) return Promise.reject(new Error('ECONNRESET'))
      return Promise.resolve(
        catalogPayload({
          refresh: { state: 'idle', startedAt: 1, finishedAt: 5, lastError: null, pendingTagFetches: 0, pendingFactFetches: 0 }
        }) as never
      )
    })
    activeApi = harness.api
    act(() => root.render(<OllamaManagerPanel onClose={() => {}} />))
    await settle()
    act(() => button('Model store').click())
    await settle()
    expect(harness.ollama.popularModels).toHaveBeenCalledTimes(1)

    // Poll #2 fails. The bug this test pins: a version keyed on `catalog` object identity never
    // re-arms after this, because a failed load leaves `catalog` untouched.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(harness.ollama.popularModels).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain('ECONNRESET')

    // Poll #3 only fires if the loop survived the failure.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(harness.ollama.popularModels).toHaveBeenCalledTimes(3)

    // The refresh is now idle — no further polling.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(harness.ollama.popularModels).toHaveBeenCalledTimes(3)
  })
})
