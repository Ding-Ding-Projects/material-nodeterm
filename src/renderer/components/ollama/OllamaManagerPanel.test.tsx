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
