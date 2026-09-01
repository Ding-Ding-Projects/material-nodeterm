// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeAssistantControlApi, HomeAssistantEntity, HomeAssistantServiceSchema } from '@shared/home-assistant-control'
import HomeAssistantControlNode from './HomeAssistantControlNode'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSchoolMode } from '../state/schoolMode'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const fixtures = vi.hoisted(() => {
  const connection = {
    id: 'connection-7',
    label: 'Kitchen hub',
    origin: 'https://ha.example',
    tokenStored: true
  }
  const entity: HomeAssistantEntity = {
    entityId: 'light.kitchen',
    domain: 'light',
    state: 'on',
    friendlyName: 'Kitchen Lamp',
    attributes: { brightness: 128 }
  }
  const service: HomeAssistantServiceSchema = {
    domain: 'light',
    service: 'turn_on',
    name: 'Turn on light',
    description: 'Provider-owned service description',
    fields: [{ name: 'transition', description: 'Provider-owned transition description', required: true, selector: { number: { min: 0, max: 10 } } }]
  }
  const api: HomeAssistantControlApi = {
    connections: vi.fn(async () => [connection]),
    configure: vi.fn(async () => connection),
    bind: vi.fn(async () => ({ state: 'ready' as const, connection, reason: null })),
    status: vi.fn(async () => ({ state: 'ready' as const, connection, reason: null })),
    entities: vi.fn(async () => [entity]),
    services: vi.fn(async () => [service]),
    call: vi.fn(async () => ({ ok: true, message: 'Provider result: light.kitchen on' })),
    cancel: vi.fn(async () => undefined)
  }
  return { api, connection, entity, service, notify: vi.fn(), updateNodeData: vi.fn() }
})

vi.mock('@xyflow/react', () => ({
  NodeResizer: () => null,
  useReactFlow: () => ({ updateNodeData: fixtures.updateNodeData })
}))

vi.mock('../session/session', () => ({
  useSession: () => ({ api: { homeAssistantControl: fixtures.api } })
}))

vi.mock('../components/regex/AnchoredRegexBuilder', () => ({
  AnchoredRegexBuilder: ({ label }: { label: string }) => <button type="button" aria-label={label}>{label}</button>
}))

vi.mock('../components/MaterialSymbol', () => ({ MaterialSymbol: () => null }))
vi.mock('../lib/adhdNotify', () => ({ notify: fixtures.notify }))

let host: HTMLDivElement
let root: Root

function render(): HTMLElement {
  act(() => {
    root.render(<HomeAssistantControlNode {...({
      id: 'ha-control-1',
      data: {
        title: '',
        color: '#0a84ff',
        homeAssistantControlConfig: {
          entityHint: fixtures.entity.entityId,
          domainHint: fixtures.entity.domain,
          serviceHint: 'light.turn_on',
          controlMode: 'schema'
        }
      },
      selected: false
    } as any)} />)
  })
  const node = host.querySelector('.home-assistant-control')
  if (!node) throw new Error('Home Assistant control node did not render')
  return node as HTMLElement
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  useSchoolMode.setState({ enabled: false, hydrated: true })
  usePersonalVocabulary.setState({
    entries: {
      'Home Assistant control': 'House controls',
      'Search connections': 'Find local links',
      'Turn on': 'Wake up'
    },
    status: 'loaded',
    entryCount: 3,
    loadedAt: Date.now(),
    lastError: null
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('HomeAssistantControlNode vocabulary boundary', () => {
  it('maps authored labels while preserving entity, connection, and schema facts exactly', async () => {
    const node = render()
    await settle()

    expect(node.querySelector('strong')?.textContent).toBe('House controls')
    expect(node.textContent).toContain('Find local links')
    expect(node.textContent).toContain('Kitchen hub')
    expect(node.textContent).toContain('https://ha.example')

    const discover = [...node.querySelectorAll('button')].find((button) => button.textContent === 'Discover or retry')
    expect(discover).toBeTruthy()
    await act(async () => {
      discover?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(node.textContent).toContain('Kitchen Lamp')
    expect(node.textContent).toContain('light.kitchen')
    expect(node.textContent).toContain('Provider-owned transition description')
    expect(node.textContent).not.toContain('SHOULD STAY')
  })

  it('keeps returned provider status text exact while mapping surrounding app copy', async () => {
    vi.mocked(fixtures.api.status).mockResolvedValueOnce({
      state: 'ready',
      connection: fixtures.connection,
      reason: 'Provider says Kitchen hub is offline'
    })
    const node = render()
    await settle()

    expect(node.textContent).toContain('Provider says Kitchen hub is offline')
    expect(node.textContent).toContain('Find local links')
  })

  it('restores shipped authored copy under School mode without rewriting provider facts', async () => {
    const node = render()
    await settle()
    expect(node.querySelector('strong')?.textContent).toBe('House controls')

    act(() => useSchoolMode.setState({ enabled: true, hydrated: true }))
    await settle()

    expect(node.querySelector('strong')?.textContent).toBe('Home Assistant control')
    expect(node.textContent).toContain('Kitchen hub')
    expect(node.textContent).toContain('https://ha.example')
    expect(node.textContent).not.toContain('House controls')
    expect(node.textContent).not.toContain('Find local links')
  })
})
