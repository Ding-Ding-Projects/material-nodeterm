// @vitest-environment jsdom
// In a browser tab (Server Edition) the Ports chip lists what is listening but offers no open or
// forward action: a page the viewer opened would load on the viewer's machine, where the server's
// loopback port is not.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

class NoopResizeObserver {
  observe(): void {}
  disconnect(): void {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopResizeObserver

const forward = vi.fn()
vi.mock('../session/session', () => ({
  sessionForProject: () => ({
    source: 'local',
    api: { devPorts: { forward, scan: vi.fn(async () => ({ ok: true, nodes: {} })), unforward: vi.fn() } }
  })
}))

const { markBrowserRuntime } = await import('../bridge/runtime')
markBrowserRuntime()
const { PortsChip } = await import('./PortsChip')
const { useDevPorts, resetDevPortScans } = await import('../state/devPorts')

let host: HTMLElement
let root: Root
const opened: string[] = []

beforeEach(() => {
  resetDevPortScans()
  opened.length = 0
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
})

describe('PortsChip in a browser tab', () => {
  it('lists the port but its row is disabled and opens nothing', () => {
    act(() =>
      useDevPorts.getState().apply('p', {
        ok: true,
        nodes: { web: [{ port: 5173, addresses: ['127.0.0.1'], command: 'node', ephemeral: false }] }
      })
    )
    act(() => root.render(<PortsChip nodeId="web" projectId="p" remote={false} onOpenUrl={(u) => opened.push(u)} />))
    const chip = host.querySelector<HTMLButtonElement>('.ports-chip')
    expect(chip?.textContent).toBe(':5173')
    act(() => chip!.click())
    const row = [...document.body.querySelectorAll<HTMLElement>('.ctx-item')].find((e) => e.textContent?.includes(':5173'))
    expect(row).toBeTruthy()
    expect(row!.getAttribute('aria-disabled') === 'true' || (row as HTMLButtonElement).disabled).toBe(true)
    act(() => row!.click())
    expect(opened).toEqual([])
    expect(forward).not.toHaveBeenCalled()
  })
})
