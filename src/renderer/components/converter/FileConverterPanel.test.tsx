// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConverterApi } from '@shared/converter'
import { E_UNSUPPORTED } from '@shared/rpc'
import type { NodeTerminalApi, Project } from '@shared/types'
import { UPLOAD_MAX_BYTES, UPLOAD_TOO_LARGE_MESSAGE } from '@shared/uploads'
import { bindProjectToSession, createSession, resetSessionsForTest } from '../../session/session'
import { useProjects } from '../../state/projects'
import { FileConverterPanel } from './FileConverterPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const emptyQueue = {
  items: [],
  total: 0,
  concurrency: 2,
  running: false,
  scanning: false
}

const queuedItem = {
  id: 'q1',
  sourcePath: 'C:\\input\\one.json',
  sourceName: 'one.json',
  sourceBytes: 3,
  destPath: 'C:\\output\\one.yaml',
  adapterId: 'json-yaml',
  status: 'queued' as const,
  progressBytes: 0,
  totalBytes: 3,
  createdAt: 1,
  updatedAt: 1
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function converterApi(over: Partial<ConverterApi> = {}): ConverterApi {
  return {
    catalog: vi.fn(async () => []),
    detect: vi.fn(async (path) => ({
      path,
      name: path,
      sizeBytes: 0,
      detectedKind: null,
      confidence: 'low' as const,
      note: 'unknown',
      compatibleAdapterIds: []
    })),
    preflight: vi.fn(async (destDir) => ({
      destDir,
      destDirExists: true,
      writable: true,
      freeBytes: null,
      estimatedNeededBytes: 0,
      sufficient: null
    })),
    state: vi.fn(async () => emptyQueue),
    addFiles: vi.fn(async () => ({ added: [], rejected: [] })),
    addFolder: vi.fn(async () => {}),
    cancelScan: vi.fn(async () => {}),
    resolvePending: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    cancelItem: vi.fn(async () => {}),
    cancelAll: vi.fn(async () => {}),
    retryItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
    clearFinished: vi.fn(async () => {}),
    setConcurrency: vi.fn(async (n) => n),
    onItem: vi.fn(() => () => {}),
    onSummary: vi.fn(() => () => {}),
    ...over
  }
}

function apiWith(
  converter: ConverterApi,
  saveUpload: NodeTerminalApi['files']['saveUpload'] = vi.fn(async () => '/upload'),
  saveUploadBlob?: NonNullable<NodeTerminalApi['files']['saveUploadBlob']>
): NodeTerminalApi {
  const files: Pick<NodeTerminalApi['files'], 'saveUpload'> &
    Partial<Pick<NodeTerminalApi['files'], 'saveUploadBlob'>> = { saveUpload }
  if (saveUploadBlob) files.saveUploadBlob = saveUploadBlob
  return {
    converter,
    files,
    shell: { reveal: vi.fn(async () => {}) }
  } as unknown as NodeTerminalApi
}

function project(id: string, remote = false): Project {
  return {
    id,
    name: id,
    color: '#fff',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    ...(remote ? { remote: true } : {})
  }
}

let root: Root
let host: HTMLDivElement

async function mount(): Promise<void> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<FileConverterPanel onClose={() => {}} />)
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  resetSessionsForTest()
})

afterEach(async () => {
  if (root) await act(async () => root.unmount())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('FileConverterPanel session routing', () => {
  it('runs a local queue action through the registered local api, not a window-global decoy', async () => {
    const localConverter = converterApi({
      state: vi.fn(async () => ({
        ...emptyQueue,
        items: [queuedItem],
        total: 1
      }))
    })
    const globalDecoy = converterApi()
    const localApi = apiWith(localConverter)
    Object.defineProperty(window, 'nodeTerminal', {
      configurable: true,
      value: apiWith(globalDecoy)
    })

    createSession('local', localApi, 'This machine')
    useProjects.setState({
      projects: [project('local-project')],
      activeProjectId: 'local-project'
    })
    await mount()

    const start = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'Start'
    )!
    expect(start.disabled).toBe(false)
    await act(async () => {
      start.click()
      await Promise.resolve()
    })

    expect(localConverter.start).toHaveBeenCalledTimes(1)
    expect(globalDecoy.start).not.toHaveBeenCalled()
    expect(globalDecoy.catalog).not.toHaveBeenCalled()
    expect(globalDecoy.state).not.toHaveBeenCalled()
  })

  it('uses the active relay api, never the window-global converter, and shows E_UNSUPPORTED', async () => {
    const localConverter = converterApi()
    const unsupported = Object.assign(new Error('converter.catalog is unavailable on relay tabs'), {
      code: E_UNSUPPORTED
    })
    const relayConverter = converterApi({
      catalog: vi.fn(async () => Promise.reject(unsupported)),
      state: vi.fn(async () => Promise.reject(unsupported))
    })
    const localApi = apiWith(localConverter)
    const relayApi = apiWith(relayConverter)
    Object.defineProperty(window, 'nodeTerminal', {
      configurable: true,
      value: localApi
    })

    createSession('local', localApi, 'This machine')
    const relay = createSession('relay', relayApi, 'Host machine')
    bindProjectToSession('relay-project', relay.id)
    useProjects.setState({
      projects: [project('relay-project', true)],
      activeProjectId: 'relay-project'
    })

    await mount()

    expect(relayConverter.catalog).toHaveBeenCalledTimes(1)
    expect(relayConverter.state).toHaveBeenCalledWith(0, 500)
    expect(localConverter.catalog).not.toHaveBeenCalled()
    expect(localConverter.state).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(E_UNSUPPORTED)
  })

  it('routes browser uploads through the active api and preserves the server refusal message', async () => {
    const globalSave = vi.fn(async () => 'C:\\wrong-machine\\big.bin')
    const refusal = 'File exceeds the 67,108,864-byte upload limit.'
    const activeSave = vi.fn(async () => 'C:\\server\\legacy-should-not-run.bin')
    const activeRawSave = vi.fn(async () => Promise.reject(new Error(refusal)))
    const globalApi = apiWith(converterApi(), globalSave)
    const activeConverter = converterApi()
    const activeApi = apiWith(activeConverter, activeSave, activeRawSave)
    Object.defineProperty(window, 'nodeTerminal', {
      configurable: true,
      value: globalApi
    })

    createSession('local', globalApi, 'This machine')
    const server = createSession('server', activeApi, 'Server host')
    bindProjectToSession('server-project', server.id)
    useProjects.setState({
      projects: [project('server-project')],
      activeProjectId: 'server-project'
    })

    const toasts: string[] = []
    window.addEventListener(
      'nodeterm:toast',
      ((event: CustomEvent) => {
        toasts.push(String(event.detail?.message ?? ''))
      }) as EventListener,
      { once: true }
    )
    await mount()

    const fakeFile = {
      name: 'big.bin',
      size: 3,
      arrayBuffer: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer)
    } as unknown as File
    const input = document.body.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [fakeFile]
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(activeRawSave).toHaveBeenCalledWith('big.bin', fakeFile)
    expect(activeSave).not.toHaveBeenCalled()
    expect(globalSave).not.toHaveBeenCalled()
    expect(toasts).toContain(refusal)
  })

  it('passes 7 MiB and exact-limit Files by identity through the raw carrier with no legacy read', async () => {
    const globalSave = vi.fn(async () => 'C:\\wrong-machine\\seven.bin')
    const activeLegacySave = vi.fn(async () => 'C:\\server\\legacy-seven.bin')
    const activeRawSave = vi.fn(async (name: string) => `C:\\server\\${name}`)
    const globalApi = apiWith(converterApi(), globalSave)
    const activeConverter = converterApi()
    const activeApi = apiWith(activeConverter, activeLegacySave, activeRawSave)
    Object.defineProperty(window, 'nodeTerminal', {
      configurable: true,
      value: globalApi
    })

    createSession('local', globalApi, 'This machine')
    const server = createSession('server', activeApi, 'Server host')
    bindProjectToSession('server-project', server.id)
    useProjects.setState({
      projects: [project('server-project')],
      activeProjectId: 'server-project'
    })
    await mount()

    const arrayBuffer = vi.fn(async () => {
      throw new Error('the raw carrier must not materialize this file')
    })
    const file = {
      name: 'seven.bin',
      size: 7 * 1024 * 1024,
      arrayBuffer
    } as unknown as File
    const input = document.body.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file]
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(activeRawSave).toHaveBeenCalledWith('seven.bin', file)
    expect(activeLegacySave).not.toHaveBeenCalled()
    expect(globalSave).not.toHaveBeenCalled()
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(activeConverter.detect).toHaveBeenCalledWith('C:\\server\\seven.bin')

    const boundaryRead = vi.fn(async () => {
      throw new Error('the exact-limit raw File must stay unread too')
    })
    const boundaryFile = {
      name: 'exactly-64-mib.bin',
      size: UPLOAD_MAX_BYTES,
      arrayBuffer: boundaryRead
    } as unknown as File
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [boundaryFile]
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(activeRawSave).toHaveBeenLastCalledWith('exactly-64-mib.bin', boundaryFile)
    expect(activeRawSave).toHaveBeenCalledTimes(2)
    expect(activeLegacySave).not.toHaveBeenCalled()
    expect(boundaryRead).not.toHaveBeenCalled()
    expect(activeConverter.detect).toHaveBeenCalledWith('C:\\server\\exactly-64-mib.bin')
  })

  it('makes a null upload refusal visible instead of silently selecting zero files', async () => {
    const globalSave = vi.fn(async () => 'C:\\wrong-machine\\lost.bin')
    const activeSave = vi.fn(async () => null)
    const globalApi = apiWith(converterApi(), globalSave)
    const activeApi = apiWith(converterApi(), activeSave)
    Object.defineProperty(window, 'nodeTerminal', {
      configurable: true,
      value: globalApi
    })

    createSession('local', globalApi, 'This machine')
    const server = createSession('server', activeApi, 'Server host')
    bindProjectToSession('server-project', server.id)
    useProjects.setState({
      projects: [project('server-project')],
      activeProjectId: 'server-project'
    })

    const toasts: string[] = []
    window.addEventListener(
      'nodeterm:toast',
      ((event: CustomEvent) => {
        toasts.push(String(event.detail?.message ?? ''))
      }) as EventListener,
      { once: true }
    )
    await mount()

    const fakeFile = {
      name: 'lost.bin',
      arrayBuffer: vi.fn(async () => new Uint8Array([4, 5, 6]).buffer)
    } as unknown as File
    const input = document.body.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [fakeFile]
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(activeSave).toHaveBeenCalledTimes(1)
    expect(globalSave).not.toHaveBeenCalled()
    expect(toasts).toContain('Could not upload "lost.bin" — the server did not save the file.')
    expect(document.body.textContent).toContain('No files selected yet')
  })

  it('refuses an oversized browser file before reading its bytes and shows the shared limit', async () => {
    const saveUpload = vi.fn(async () => 'C:\\server\\too-big.bin')
    const saveUploadBlob = vi.fn(async () => 'C:\\server\\too-big.bin')
    const activeApi = apiWith(converterApi(), saveUpload, saveUploadBlob)
    Object.defineProperty(window, 'nodeTerminal', {
      configurable: true,
      value: activeApi
    })
    createSession('local', activeApi, 'Server host')
    useProjects.setState({
      projects: [project('server-project')],
      activeProjectId: 'server-project'
    })

    const toasts: string[] = []
    window.addEventListener(
      'nodeterm:toast',
      ((event: CustomEvent) => {
        toasts.push(String(event.detail?.message ?? ''))
      }) as EventListener,
      { once: true }
    )
    await mount()

    const arrayBuffer = vi.fn(async () => new Uint8Array([1]).buffer)
    const fakeFile = {
      name: 'too-big.bin',
      size: UPLOAD_MAX_BYTES + 1,
      arrayBuffer
    } as unknown as File
    const input = document.body.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [fakeFile]
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(saveUpload).not.toHaveBeenCalled()
    expect(saveUploadBlob).not.toHaveBeenCalled()
    expect(toasts).toEqual([UPLOAD_TOO_LARGE_MESSAGE])
    expect(document.body.textContent).toContain('No files selected yet')
  })

  it('drops a late upload response when the active project changes before detection', async () => {
    const upload = deferred<string | null>()
    const aSave = vi.fn(() => upload.promise)
    const aConverter = converterApi()
    const bConverter = converterApi()
    const aApi = apiWith(aConverter, aSave)
    const bApi = apiWith(bConverter)
    Object.defineProperty(window, 'nodeTerminal', {
      configurable: true,
      value: aApi
    })

    createSession('local', aApi, 'Machine A')
    const bSession = createSession('server', bApi, 'Machine B')
    bindProjectToSession('project-b', bSession.id)
    useProjects.setState({
      projects: [project('project-a'), project('project-b')],
      activeProjectId: 'project-a'
    })

    const toasts: string[] = []
    const onToast = ((event: CustomEvent) => {
      toasts.push(String(event.detail?.message ?? ''))
    }) as EventListener
    window.addEventListener('nodeterm:toast', onToast)
    await mount()

    const fakeFile = {
      name: 'late.bin',
      arrayBuffer: vi.fn(async () => new Uint8Array([7, 8, 9]).buffer)
    } as unknown as File
    const input = document.body.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [fakeFile]
    })
    act(() => input.dispatchEvent(new Event('change', { bubbles: true })))
    await act(async () => {
      await Promise.resolve()
    })
    expect(aSave).toHaveBeenCalledTimes(1)

    await act(async () => {
      useProjects.setState({ activeProjectId: 'project-b' })
      await Promise.resolve()
    })
    // A project switch replaces the owner-scoped subtree during the switch commit. Keeping this
    // same input node would also keep API A rows and callbacks alive until a passive effect runs.
    expect(document.body.querySelector<HTMLInputElement>('input[type="file"]')).not.toBe(input)
    upload.resolve('C:\\machine-a\\late.bin')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(aConverter.detect).not.toHaveBeenCalled()
    expect(bConverter.detect).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('late.bin')
    expect(toasts).toEqual([])
    window.removeEventListener('nodeterm:toast', onToast)
  })
})
