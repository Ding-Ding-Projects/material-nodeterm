// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConverterNode from './ConverterNode'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSchoolMode } from '../state/schoolMode'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { sessionApi } = vi.hoisted(() => ({
  sessionApi: {
    converter: {
      catalog: vi.fn(async () => []),
      detect: vi.fn(async (path: string) => ({
        path,
        name: 'report.json',
        sizeBytes: 42,
        detectedKind: 'json',
        confidence: 'high' as const,
        note: 'JSON detected',
        compatibleAdapterIds: []
      })),
      preflight: vi.fn(async (destDir: string) => ({
        destDir,
        destDirExists: true,
        writable: true,
        freeBytes: 4096,
        estimatedNeededBytes: 42,
        sufficient: true
      })),
      state: vi.fn(async () => ({
        items: [{
          id: 'q1',
          sourcePath: 'C:\\input\\report.json',
          sourceName: 'report.json',
          sourceBytes: 42,
          destPath: 'C:\\output\\report.yaml',
          adapterId: 'json-yaml',
          status: 'running' as const,
          progressBytes: 21,
          totalBytes: 42,
          createdAt: 1,
          updatedAt: 1
        }],
        total: 1,
        concurrency: 2,
        running: true,
        scanning: false
      })),
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
      setConcurrency: vi.fn(async (value: number) => value),
      onItem: vi.fn(() => () => {}),
      onSummary: vi.fn(() => () => {})
    },
    vscode: { detect: vi.fn(async () => []) },
    dialog: {
      selectFiles: vi.fn(async () => null),
      selectFolder: vi.fn(async () => null)
    },
    files: {
      saveUpload: vi.fn(async () => '/upload/report.json')
    },
    shell: { reveal: vi.fn(async () => {}) }
  }
}))

vi.mock('@xyflow/react', () => ({
  NodeResizer: () => null,
  useReactFlow: () => ({ deleteElements: vi.fn(), updateNodeData: vi.fn() })
}))

vi.mock('../session/session', () => ({ useActiveSessionApi: () => sessionApi }))
vi.mock('../components/converter/AdapterCatalog', () => ({ AdapterCatalog: () => null }))

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  usePersonalVocabulary.setState({
    entries: {
      'File converter': 'Document transformer',
      'Converter views': 'Transformer views',
      Convert: 'Transform',
      Queue: 'Lineup',
      'Drop files here': 'Place files here',
      'or use a real file picker': 'or choose files',
      Preview: 'Inspection',
      'Target format': 'Destination format',
      'Output folder': 'Destination folder',
      Close: 'Dismiss'
    },
    status: 'loaded',
    entryCount: 10,
    loadedAt: Date.now(),
    lastError: null
  })
  useSchoolMode.setState({ enabled: false, hydrated: true, name: 'School mode' })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

function renderNode(): void {
  act(() => {
    root.render(<ConverterNode {...({
      id: 'converter-1',
      selected: false,
      data: { title: 'My converter', color: '#0a84ff' }
    } as unknown as Parameters<typeof ConverterNode>[0])} />)
  })
}

describe('converter node personal-vocabulary boundaries', () => {
  it('maps visible and accessible authored framing while preserving user and queue facts', async () => {
    renderNode()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(host.textContent).toContain('Transform')
    expect(host.textContent).toContain('Place files here')
    expect(host.querySelector('[aria-label="Transformer views"]')).not.toBeNull()
    expect(Array.from(host.querySelectorAll('button')).some((button) => button.textContent?.trim() === 'Transform')).toBe(true)
    expect(host.textContent).toContain('My converter')
    expect(host.textContent).not.toContain('report.json')

    const queueTab = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Lineup'))
    expect(queueTab).not.toBeUndefined()
    await act(async () => {
      queueTab?.click()
      await Promise.resolve()
    })

    expect(host.textContent).toContain('Lineup')
    expect(host.textContent).toContain('report.json')
    expect(host.textContent).toContain('report.yaml')
    expect(host.textContent).toContain('running')
    expect(Array.from(host.querySelectorAll('[aria-label]')).some((element) => element.getAttribute('aria-label') === 'Conversion report.json to C:\\output\\report.yaml, status running')).toBe(true)
    expect(host.querySelector('[aria-valuetext="50% complete"]')).not.toBeNull()
  })

  it('restores shipped authored framing in School mode without rewriting queue facts', async () => {
    renderNode()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => useSchoolMode.setState({ enabled: true, hydrated: true, name: 'School mode' }))

    expect(host.textContent).toContain('Convert')
    expect(host.textContent).not.toContain('Transform')
    expect(host.textContent).toContain('My converter')
  })
})
