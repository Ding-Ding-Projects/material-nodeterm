// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VeraCryptNode from './VeraCryptNode'

const availability = vi.fn()
const refresh = vi.fn()
const favorites = vi.fn()
const preflight = vi.fn()
const onOperation = vi.fn()
const mount = vi.fn()
const unmount = vi.fn()
const explore = vi.fn()
const wipeCache = vi.fn()
const cancel = vi.fn()

const activeApi = {
  veracrypt: { availability, refresh, favorites, preflight, onOperation, mount, unmount, explore, wipeCache, cancel },
  dialog: { selectFile: vi.fn() }
}

vi.mock('@xyflow/react', () => ({
  NodeResizer: () => null,
  useReactFlow: () => ({ updateNodeData: vi.fn() })
}))
vi.mock('../session/session', () => ({ useActiveSessionApi: () => activeApi }))
vi.mock('../components/EditableNodeTitle', () => ({
  EditableNodeTitle: ({ emptyLabel }: { emptyLabel: string }) => <span>{emptyLabel}</span>
}))
vi.mock('../components/DestructiveConfirmGate', () => ({
  DestructiveConfirmGate: ({ title, onConfirm }: { title: string; onConfirm: () => void }) => <button type="button" data-testid="gate" onClick={onConfirm}>{title}</button>
}))
vi.mock('../lib/nodeColor', () => ({ nodeHeaderFillStyle: () => ({ className: '', filled: false, style: undefined }) }))
vi.mock('../lib/personalVocabulary/useVocabularyText', () => ({ useVocabularyMapper: () => (text: string) => text }))

describe('VeraCryptNode session routing and drive truth', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    availability.mockReset().mockResolvedValue({ platform: 'win32', state: 'available', executablePath: 'C:\\Program Files\\VeraCrypt\\VeraCrypt.exe', version: '1.26.7', reason: null, checkedAt: 1 })
    refresh.mockReset().mockResolvedValue({ state: 'verified', volumes: [{ driveLetter: 'X', containerPath: 'C:\\vault.hc', observedAt: 1, managerCreated: true }], reason: null, checkedAt: 1 })
    favorites.mockReset().mockResolvedValue([])
    preflight.mockReset().mockResolvedValue({ ok: false, containerPath: '', driveLetter: 'V', availableDriveLetters: ['A', 'B', 'C'], reason: 'Choose an existing VeraCrypt container file.' })
    onOperation.mockReset().mockReturnValue(() => {})
    mount.mockReset().mockResolvedValue({ id: 'm1', kind: 'mount', state: 'succeeded', progress: 100, driveLetter: 'X', message: 'mounted', startedAt: 1, finishedAt: 2 })
    unmount.mockReset().mockResolvedValue({ id: 'u1', kind: 'unmount', state: 'succeeded', progress: 100, driveLetter: 'X', message: 'unmounted', startedAt: 1, finishedAt: 2 })
    explore.mockReset().mockResolvedValue({})
    wipeCache.mockReset().mockResolvedValue({})
    cancel.mockReset().mockResolvedValue(true)
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = { veracrypt: new Proxy({}, { get: () => { throw new Error('viewer-local VeraCrypt route used') } }) }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  function props(): ComponentProps<typeof VeraCryptNode> {
    return { id: 'v1', data: { title: 'VeraCrypt', color: '#0a84ff' }, selected: false } as unknown as ComponentProps<typeof VeraCryptNode>
  }

  it('resolves every VeraCrypt call through the active session API', async () => {
    await act(async () => {
      root.render(<VeraCryptNode {...props()} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(availability).toHaveBeenCalled()
    expect(refresh).toHaveBeenCalled()
    expect(favorites).toHaveBeenCalled()
    expect(preflight).toHaveBeenCalled()
  })

  it('labels drive letters from the preflight availability result', async () => {
    await act(async () => {
      root.render(<VeraCryptNode {...props()} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    const select = host.querySelector('select')
    expect(select?.textContent).toContain('A: available')
    expect(select?.textContent).toContain('X: occupied')
  })
})
