// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import VirtualMachineNode from './VirtualMachineNode'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const updateNodeData = vi.fn()
const deleteElements = vi.fn()
const mapText = (value: string | undefined): string | undefined => value?.replace('Bundled QEMU is unavailable.', 'Packaged QEMU is unavailable.')
  .replace('Choose a Linux ISO to continue.', 'Pick a Linux ISO to continue.')

const status = {
  id: 'vm-1',
  phase: 'unconfigured' as const,
  mode: 'disposable-live' as const,
  configured: false,
  isoPath: null,
  diskPath: null,
  diskFormat: 'unknown' as const,
  diskFreeBytes: null,
  isoSha256Expected: null,
  isoSha256Actual: null,
  accelerator: 'unknown' as const,
  networkEnabled: false,
  displayUrl: null,
  qmpEndpoint: null,
  snapshotNames: [],
  memoryMiB: 2048,
  cpus: 2,
  progress: 0,
  message: 'Choose a Linux ISO to continue.'
}

const api = {
  virtualMachine: {
    status: vi.fn(async () => status),
    tools: vi.fn(async () => ({ available: false, qemuPath: null, qemuImgPath: null, source: 'missing' as const, resourceRoot: null, packageProof: 'absent' as const, sizeDisclosure: '0 B', reason: 'Bundled QEMU is unavailable.', whpxAvailable: null })),
    configure: vi.fn(),
    createDisk: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    snapshot: vi.fn(),
    restore: vi.fn(),
    openDisplay: vi.fn(),
    reset: vi.fn(),
    onEvent: vi.fn(() => () => undefined)
  }
}

vi.mock('@xyflow/react', () => ({
  NodeResizer: () => null,
  useReactFlow: () => ({ updateNodeData, deleteElements })
}))
vi.mock('../session/session', () => ({ useSession: () => ({ api }) }))
vi.mock('../components/MaterialSymbol', () => ({ MaterialSymbol: () => null }))
vi.mock('../components/regex/AnchoredRegexBuilder', () => ({ AnchoredRegexBuilder: () => null }))
vi.mock('../lib/personalVocabulary/useVocabularyText', () => ({ useVocabularyMapper: () => mapText, useVocabularyTemplate: (text: string | undefined) => text }))
vi.mock('../lib/i18n', () => ({ useI18n: () => ({ ts: (_id: string, fallback: string) => fallback }) }))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root.render(<VirtualMachineNode {...({ id: 'vm-1', data: { title: '', color: '#6750a4', virtualMachineConfig: undefined, virtualMachineLocalPaths: undefined }, selected: false } as any)} />)
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('VirtualMachineNode personal vocabulary boundary', () => {
  it('maps app-owned tool and status messages while retaining the rendered state', async () => {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(host.textContent).toContain('Packaged QEMU is unavailable.')
    expect(host.textContent).toContain('Pick a Linux ISO to continue.')
    expect(host.textContent).not.toContain('Bundled QEMU is unavailable.')
    expect(host.textContent).not.toContain('Choose a Linux ISO to continue.')
  })
})
