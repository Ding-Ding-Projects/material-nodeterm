// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdatePrepInspection, UpdatePrepShutdown } from '@shared/update-prep'
import { PrepareUpdateDialog } from './PrepareUpdateDialog'
import type { PrepNode } from '../lib/updatePrep'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const nodes: PrepNode[] = [
  { nodeId: 'a', projectId: 'p', projectName: 'Alpha', projectClosed: false, title: 'Shell A' }
]

function install(inspection: UpdatePrepInspection, shutdown: UpdatePrepShutdown = { kind: 'shut-down', ended: [] }) {
  const updates = {
    prepareInspect: vi.fn(async () => inspection),
    prepareShutdownHost: vi.fn(async () => shutdown),
    prepareQuit: vi.fn()
  }
  ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = { updates }
  return updates
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

const button = (label: string): HTMLButtonElement => {
  const found = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === label)
  if (!found) throw new Error(`no button ${label}`)
  return found as HTMLButtonElement
}

describe('PrepareUpdateDialog', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('refuses while a session is working and offers to go to it', async () => {
    install({ kind: 'host', sessions: ['nt-a'], shutdownSupported: true, mirror: { 'nt-a': { state: 'working', attention: false } } })
    const onTravel = vi.fn()
    const onClose = vi.fn()
    act(() => root.render(<PrepareUpdateDialog collectNodes={() => nodes} onTravel={onTravel} onClose={onClose} />))
    await flush()
    expect(document.body.textContent).toContain('Shell A · Alpha · working')
    act(() => button('Go').click())
    expect(onTravel).toHaveBeenCalledWith('a')
  })

  it('confirms what stops, then shuts the host down and quits only after it is confirmed gone', async () => {
    const updates = install({ kind: 'host', sessions: ['nt-a'], shutdownSupported: true, mirror: {} })
    act(() => root.render(<PrepareUpdateDialog collectNodes={() => nodes} onTravel={vi.fn()} onClose={vi.fn()} />))
    await flush()
    act(() => button('Continue').click())
    await flush()
    expect(document.body.textContent).toContain('Canvas nodes are kept')
    expect(updates.prepareShutdownHost).not.toHaveBeenCalled()
    act(() => button('Stop sessions and quit').click())
    await flush()
    expect(updates.prepareShutdownHost).toHaveBeenCalledOnce()
    expect(updates.prepareQuit).toHaveBeenCalledOnce()
  })

  it('never quits when the host could not confirm its shutdown', async () => {
    const updates = install(
      { kind: 'host', sessions: ['nt-a'], shutdownSupported: true, mirror: {} },
      { kind: 'unconfirmed', error: 'timeout' }
    )
    act(() => root.render(<PrepareUpdateDialog collectNodes={() => nodes} onTravel={vi.fn()} onClose={vi.fn()} />))
    await flush()
    act(() => button('Continue').click())
    await flush()
    act(() => button('Stop sessions and quit').click())
    await flush()
    expect(updates.prepareQuit).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('did not confirm it shut down (timeout)')
  })

  it('shows the manual steps for an older host that cannot shut itself down', async () => {
    install({ kind: 'host', sessions: ['nt-a'], shutdownSupported: false, mirror: {} })
    act(() => root.render(<PrepareUpdateDialog collectNodes={() => nodes} onTravel={vi.fn()} onClose={vi.fn()} />))
    await flush()
    expect(document.body.textContent).toContain('started by an older nodeterm')
    expect(document.body.textContent).toContain('session-host-runtime.exe')
  })
})
