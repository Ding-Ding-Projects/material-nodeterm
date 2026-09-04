// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TorrentApi, TorrentTaskState } from '@shared/torrent'
import TorrentNode from './TorrentNode'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSchoolMode } from '../state/schoolMode'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@xyflow/react', () => ({
  NodeResizer: () => null,
  useReactFlow: () => ({ updateNodeData: vi.fn() })
}))

vi.mock('../components/regex/AnchoredRegexBuilder', () => ({
  AnchoredRegexBuilder: ({ label }: { label?: string }) => <button type="button" aria-label={label}>.*</button>
}))

let activeApi: { torrent: TorrentApi; dialog: { selectFolder: () => Promise<string | null>; selectFile: () => Promise<string | null> } }
vi.mock('../session/session', () => ({ useActiveSessionApi: () => activeApi }))

const task = (overrides: Partial<TorrentTaskState> = {}): TorrentTaskState => ({
  id: 'task-1',
  nodeId: 'node-1',
  sourceKind: 'magnet',
  sourceRef: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
  name: 'Exact task 100%',
  destination: 'C:\\Downloads\\Exact',
  files: [{
    path: 'folder\\exact.bin',
    name: 'exact.bin',
    sizeBytes: 1536,
    selected: true,
    downloadedBytes: 512
  }],
  status: 'downloading',
  progress: 0.5,
  downloadedBytes: 512,
  totalBytes: 1024,
  speedBytesPerSecond: 2048,
  peers: 7,
  etaSeconds: 65,
  error: 'engine detail C:\\cache\\torrent.err #7',
  seedPolicy: { kind: 'never' },
  uploadedBytes: 0,
  ratio: 0,
  createdAt: 1,
  updatedAt: 2,
  ...overrides
})

function renderNode(host: HTMLElement, data: Record<string, unknown> = {}): void {
  const root = createRoot(host)
  ;(host as HTMLElement & { __root?: Root }).__root = root
  act(() => {
    root.render(<TorrentNode id="node-1" type="torrent" selected={false} dragging={false} draggable selectable deletable zIndex={0} isConnectable positionAbsoluteX={0} positionAbsoluteY={0} data={{
      title: '',
      color: '#6750a4',
      group: null,
      collapsed: false,
      torrentMagnet: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
      ...data
    } as never} />)
  })
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('TorrentNode personal-vocabulary boundary', () => {
  let host: HTMLElement

  beforeEach(() => {
    const current = task()
    activeApi = {
      torrent: {
        runtime: vi.fn(async () => ({ available: true, origin: 'bundled' as const, detail: null })),
        list: vi.fn(async () => [current]),
        inspect: vi.fn(),
        add: vi.fn(),
        chooseFiles: vi.fn(async () => current),
        setDestination: vi.fn(async () => current),
        preflight: vi.fn(),
        start: vi.fn(async () => current),
        pause: vi.fn(async () => current),
        resume: vi.fn(async () => current),
        cancel: vi.fn(async () => current),
        retry: vi.fn(async () => current),
        remove: vi.fn(async () => undefined),
        setSeedPolicy: vi.fn(async () => current),
        reconcile: vi.fn(async () => [current]),
        onTask: vi.fn(() => () => undefined)
      } as unknown as TorrentApi,
      dialog: { selectFolder: vi.fn(async () => null), selectFile: vi.fn(async () => null) }
    }
    usePersonalVocabulary.setState({ status: 'loaded', entries: {
      'Torrent downloader': 'Transfer desk',
      'Download folder': 'Destination drawer',
      'Search tasks': 'Find transfers',
      'Do not seed': 'Stop after download',
      'Remove task': 'Discard record'
    }, entryCount: 5, loadedAt: 1, lastError: null })
    useSchoolMode.setState({ enabled: false, hydrated: true })
    host = document.createElement('div')
    document.body.appendChild(host)
  })

  afterEach(() => {
    act(() => (host as HTMLElement & { __root?: Root }).__root?.unmount())
    host.remove()
    usePersonalVocabulary.setState({ status: 'no-file', entries: {}, entryCount: 0, loadedAt: null, lastError: null })
    useSchoolMode.setState({ enabled: false, hydrated: true })
  })

  it('maps authored labels and keeps task facts byte-identical', async () => {
    renderNode(host)
    await settle()

    expect(host.textContent).toContain('Transfer desk')
    expect(host.textContent).toContain('Destination drawer')
    expect(host.querySelector<HTMLInputElement>('#node-1-search')?.getAttribute('placeholder')).toBe('Find transfers')
    expect(host.textContent).toContain('Discard record')
    expect(host.textContent).toContain('Exact task 100%')
    expect(host.textContent).toContain('folder\\exact.bin')
    expect(host.textContent).toContain('512 B / 1.0 KiB')
    expect(host.textContent).toContain('7 peers')
    expect(host.textContent).toContain('engine detail C:\\cache\\torrent.err #7')
    expect(host.querySelector<HTMLInputElement>('#node-1-magnet')?.value).toBe('magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567')
  })

  it('maps accessible names and exposes the anchored builders for each search field', async () => {
    renderNode(host)
    await settle()

    expect(host.querySelector<HTMLLabelElement>('[for="node-1-magnet"]')?.textContent).toBe('Magnet URI')
    expect(host.querySelector<HTMLInputElement>('#node-1-destination')?.getAttribute('aria-label')).toBe('Destination drawer')
    expect(host.querySelector<HTMLButtonElement>('.term-node__close')?.getAttribute('aria-label')).toBe('Refresh torrent tasks')
    expect(host.querySelectorAll('button[aria-label*="Regex builder"]').length).toBe(3)
    expect(host.querySelector('progress')?.getAttribute('aria-label')).toBe('Downloaded 50%')
  })

  it('keeps selected file paths exact when the mapped selection control is used', async () => {
    renderNode(host)
    await settle()
    const select = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Select filtered')
    expect(select).toBeTruthy()
    await act(async () => { select?.click(); await Promise.resolve() })
    expect(activeApi.torrent.chooseFiles).toHaveBeenCalledWith('task-1', ['folder\\exact.bin'])
  })

  // School mode omits the downloader entirely (torrentNodeOptionalFeatureVisible), so there is no
  // surface left for a mapped label to reach. An unhydrated record is not evidence the mode is
  // off, so it omits the node too.
  it.each([
    ['enabled', { enabled: true, hydrated: true }],
    ['unhydrated', { enabled: false, hydrated: false }]
  ])('omits the downloader and its mapped copy while School mode is %s', async (_label, state) => {
    useSchoolMode.setState(state)
    renderNode(host)
    await settle()

    expect(host.textContent).toBe('')
    expect(host.textContent).not.toContain('Transfer desk')
  })

  // The other half of the same contract: with the mode off and no vocabulary file loaded, every
  // authored label renders as the shipped wording rather than a stale mapping.
  it('renders shipped copy when no personal vocabulary is loaded', async () => {
    usePersonalVocabulary.setState({ status: 'no-file', entries: {}, entryCount: 0, loadedAt: null, lastError: null })
    renderNode(host)
    await settle()

    expect(host.textContent).toContain('Torrent downloader')
    expect(host.textContent).toContain('Download folder')
    expect(host.textContent).not.toContain('Transfer desk')
    expect(host.textContent).toContain('Exact task 100%')
  })
})
