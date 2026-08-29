// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import HomeAssistantSensorNode from './HomeAssistantSensorNode'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const values = {
    mapText: (text: string) => text,
    binding: vi.fn(),
    configure: vi.fn(),
    leaveUnbound: vi.fn(),
    discover: vi.fn(),
    refresh: vi.fn(),
    updateNodeData: vi.fn(),
    notify: vi.fn(),
    openDestructiveGate: vi.fn(),
    api: {} as { homeAssistantSensor: Record<string, ReturnType<typeof vi.fn>>; export: { saveText: ReturnType<typeof vi.fn> } }
  }
  values.api = { homeAssistantSensor: { binding: values.binding, configure: values.configure, leaveUnbound: values.leaveUnbound, discover: values.discover, refresh: values.refresh }, export: { saveText: vi.fn() } }
  return values
})

const { binding, configure, leaveUnbound, discover, refresh, updateNodeData, notify, openDestructiveGate, api } = mocks

vi.mock('@xyflow/react', () => ({
  NodeResizer: () => null,
  useReactFlow: () => ({ updateNodeData: mocks.updateNodeData })
}))

vi.mock('../session/session', () => ({
  useSession: () => ({ api: mocks.api })
}))

vi.mock('../lib/personalVocabulary/useVocabularyText', () => ({
  useVocabularyMapper: () => mocks.mapText
}))

vi.mock('../components/regex/AnchoredRegexBuilder', () => ({
  AnchoredRegexBuilder: ({ label }: { label?: string }) => <button type="button" aria-label={label}>.*</button>
}))

vi.mock('../state/notifications', () => ({ notify: mocks.notify }))
vi.mock('../state/destructiveGate', () => ({ openDestructiveGate: mocks.openDestructiveGate }))

const entity = {
  entityId: 'sensor.lounge_temp',
  domain: 'sensor',
  friendlyName: 'Home Assistant device',
  state: 'on',
  unit: '%',
  deviceClass: null,
  stateClass: 'measurement',
  options: [],
  attributes: { temperature: 21, source: 'Home Assistant' },
  lastChanged: '2026-08-28T23:40:01.000Z',
  lastUpdated: '2026-08-28T23:40:02.000Z'
}

const snapshot = {
  nodeId: 'sensor-node-1',
  fetchedAt: 1764373200000,
  complete: true,
  partial: false,
  stale: false,
  entities: [entity],
  history: [],
  missingEntityIds: [],
  reason: null
}

function render(): void {
  root.render(
    <HomeAssistantSensorNode
      {...({
        id: 'sensor-node-1',
        data: {
          title: '',
          color: '#0a84ff',
          homeAssistantSensorConfig: {
            entities: [{ entityId: entity.entityId, mode: 'binary', label: null, min: null, max: null, attributeKeys: [] }],
            refreshSeconds: 30,
            historyLimit: 60,
            showLastChanged: true
          }
        },
        selected: false
      } as unknown as Parameters<typeof HomeAssistantSensorNode>[0])}
    />
  )
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  mocks.mapText = (text) => text.replaceAll('Home Assistant', 'Mapped HA').replaceAll('Entities', 'Things').replaceAll('On or active', 'Mapped active')
  binding.mockReset().mockResolvedValue({ nodeId: 'sensor-node-1', state: 'ready', instanceLabel: 'Kitchen', credentialStored: true, lastSuccessfulAt: null, reason: null })
  configure.mockReset()
  leaveUnbound.mockReset()
  discover.mockReset()
  refresh.mockReset().mockResolvedValue(snapshot)
  updateNodeData.mockReset()
  notify.mockReset()
  openDestructiveGate.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => render())
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

describe('HomeAssistantSensorNode personal vocabulary boundary', () => {
  it('maps owned copy while preserving provider facts and accessible labels', async () => {
    await settle()
    discover.mockResolvedValue([entity])
    const load = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Load entities')
    await act(async () => {
      load?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(host.querySelector('h3')?.textContent).toBe('Instance binding')
    expect(host.querySelectorAll('h3')[1]?.textContent).toBe('Things')
    expect(host.querySelector('strong')?.textContent).toBe('Mapped HA sensors')
    expect(host.querySelector('.ha-sensor-node__binary')?.textContent).toContain('Mapped active')
    expect(host.textContent).toContain('Home Assistant device')
    expect(host.textContent).toContain('2026-08-28T23:40:01.000Z')
    expect(host.textContent).toContain('%')
    expect(host.querySelector('input[aria-label="Search Mapped HA entities"]')).not.toBeNull()
    expect(host.querySelector('input[placeholder="Search entities with plain text"]')).not.toBeNull()
    expect(host.querySelector('button[aria-label="Regex for Mapped HA entities"]')).not.toBeNull()
  })

  it('keeps provider errors byte-identical inside a mapped notification', async () => {
    discover.mockRejectedValue(new Error('Home Assistant provider error: HTTP 502 /sensor.lounge_temp'))
    await settle()
    const load = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Load entities')
    expect(load).toBeTruthy()
    await act(async () => {
      load?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Entity discovery failed',
      body: 'Home Assistant provider error: HTTP 502 /sensor.lounge_temp'
    }))
  })

  it('passes mapped destructive copy and exact binding facts to the gate', async () => {
    await settle()
    const leave = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Leave Unbound…')
    expect(leave).toBeTruthy()
    act(() => leave?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(openDestructiveGate).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Leave this Mapped HA node unbound',
      affected: ['Kitchen'],
      confirmLabel: 'Leave unbound'
    }))
  })

  it('restores shipped copy when the fail-closed mapper is in School mode', async () => {
    mocks.mapText = (text) => text
    act(() => render())
    await settle()
    expect(host.querySelector('strong')?.textContent).toBe('Home Assistant sensors')
    expect(host.querySelector('.ha-sensor-node__binary')?.textContent).toContain('On or active')
    expect(host.textContent).toContain('Home Assistant device')
  })
})
