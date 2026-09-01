// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CloudflareCoreManagersNode from './CloudflareCoreManagersNode'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSchoolMode } from '../state/schoolMode'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@xyflow/react', () => ({
  NodeResizer: () => null,
  useReactFlow: () => ({ updateNodeData: vi.fn() })
}))

vi.mock('../components/tunnel/TunnelStatePanel', () => ({ TunnelStatePanel: () => null }))
vi.mock('../components/regex/AnchoredRegexBuilder', () => ({
  AnchoredRegexBuilder: ({ label }: { label: string }) => <span aria-label={label} />
}))

const credential = {
  id: 'credential-1',
  label: 'Cloudflare Production',
  accountId: 'account-123',
  createdAt: 1,
  updatedAt: 1
}

let onProgress: ((progress: { nodeId: string; message: string }) => void) | undefined
let api: Record<string, unknown>
let host: HTMLDivElement
let root: Root

function renderNode(): void {
  act(() => {
    root.render(
      <CloudflareCoreManagersNode {...({
          id: 'cloudflare-1',
          selected: false,
          data: { cloudflareCoreIntent: { schemaVersion: 1, manager: 'account', operation: 'account-list', input: {} } }
        } as Parameters<typeof CloudflareCoreManagersNode>[0])} />
    )
  })
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  onProgress = undefined
  api = {
    runtime: vi.fn().mockResolvedValue({ available: true, origin: 'built-in', version: 'v9', disabledReason: null }),
    credentials: vi.fn().mockResolvedValue([credential]),
    binding: vi.fn().mockResolvedValue(null),
    saveCredential: vi.fn(),
    bind: vi.fn(),
    unbind: vi.fn(),
    preview: vi.fn().mockResolvedValue({ destructive: false }),
    execute: vi.fn().mockResolvedValue({
      operationId: 'op-1',
      manager: 'account',
      operation: 'account-list',
      rows: [{ id: 'provider-row-1', name: 'Cloudflare Production' }],
      nextPage: null,
      total: 1,
      summary: 'Cloudflare provider raw summary',
      completedAt: 1
    }),
    cancel: vi.fn().mockResolvedValue(true),
    onProgress: vi.fn((listener: typeof onProgress) => { onProgress = listener; return () => undefined }),
    tunnelState: vi.fn().mockResolvedValue(null),
    probeTunnelFacet: vi.fn(),
    cancelTunnelProbe: vi.fn(),
    onTunnelState: vi.fn(() => () => undefined)
  }
  ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = { cloudflareCoreManagers: api }
  useSchoolMode.setState({ enabled: false, hydrated: true })
  usePersonalVocabulary.setState({
    entries: {
      'Cloudflare managers': 'Edge managers',
      'Cloudflare core managers': 'Edge core managers',
      'Local credential': 'Saved key',
      'Search credentials': 'Find keys',
      'Checking Cloudflare API client…': 'Checking local edge…',
      'No Cloudflare results yet. Choose a manager, bind a local credential, and run a guided operation.': 'No edge rows yet.',
      'Cloudflare Production': 'MUTATED PROVIDER LABEL',
      'Cloudflare provider raw summary': 'MUTATED PROVIDER SUMMARY'
    },
    status: 'loaded',
    entryCount: 8,
    loadedAt: 1,
    lastError: null
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

describe('Cloudflare core manager personal vocabulary boundary', () => {
  it('maps manager chrome while preserving manager labels, credential facts, and runtime facts', async () => {
    renderNode()
    await settle()

    expect(host.querySelector('[aria-label="Edge core managers"]')).not.toBeNull()
    expect(host.textContent).toContain('Edge managers')
    expect(host.textContent).toContain('Saved key')
    expect(host.textContent).toContain('account')
    expect(host.textContent).toContain('Cloudflare Production')
    expect(host.textContent).not.toContain('MUTATED PROVIDER LABEL')
    expect(host.textContent).toContain('built-in: v9')
    expect(host.querySelector('input[aria-label="Search Cloudflare credentials"]')?.getAttribute('placeholder')).toBe('Find keys')
  })

  it('keeps provider progress and result summaries byte-identical', async () => {
    renderNode()
    await settle()
    act(() => onProgress?.({ nodeId: 'cloudflare-1', message: 'Cloudflare provider progress: 3/4' }))
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Cloudflare provider progress: 3/4')

    const runButton = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Preview and run')
    expect(runButton).toBeDefined()
    act(() => runButton?.click())
    await settle()
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Cloudflare provider raw summary')
    expect(host.textContent).not.toContain('MUTATED PROVIDER SUMMARY')
    expect((api.execute as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('cloudflare-1', expect.objectContaining({ manager: 'account', operation: 'account-list' }))
  })

  it('restores original chrome while School mode is enabled', async () => {
    act(() => useSchoolMode.setState({ enabled: true, hydrated: true }))
    renderNode()
    await settle()
    expect(host.textContent).toContain('Cloudflare managers')
    expect(host.textContent).toContain('Local credential')
    expect(host.textContent).not.toContain('Edge managers')
    expect(host.textContent).not.toContain('MUTATED PROVIDER LABEL')
  })
})
