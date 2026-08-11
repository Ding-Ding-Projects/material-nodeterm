// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshServer } from '@shared/ssh'
import { useSshServers } from '../../../state/sshServers'
import { SshSection } from './SshSection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SERVER: SshServer = {
  id: 'ubuntu-1',
  label: 'Ubuntu WSL',
  host: 'devbox',
  user: 'corvin',
  port: 2222,
  remoteCwd: '/home/corvin/projects/nf-management'
}

describe('SshSection machine setup', () => {
  let root: Root | undefined
  let host: HTMLElement
  let connect: ReturnType<typeof vi.fn>
  let disconnect: ReturnType<typeof vi.fn>

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    connect = vi.fn(async () => ({ controlPath: '/tmp/control' }))
    disconnect = vi.fn(async () => {})
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      ssh: {
        list: vi.fn(async () => [SERVER]),
        save: vi.fn(async () => [SERVER]),
        remove: vi.fn(async () => []),
        importCandidates: vi.fn(async () => [])
      },
      sshProject: { connect, disconnect },
      dialog: { selectFile: vi.fn(async () => null) }
    }
    useSshServers.setState({ servers: [SERVER] })
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    host.remove()
  })

  const button = (label: string): HTMLButtonElement => {
    const match = [...host.querySelectorAll('button')].find((el) => el.textContent?.includes(label))
    if (!match) throw new Error(`button not found: ${label}`)
    return match
  }

  const click = (el: Element): void => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }

  it('routes a saved machine directly to account management', () => {
    const onNavigate = vi.fn()
    root = createRoot(host)
    act(() => root!.render(<SshSection isActive onNavigate={onNavigate} />))
    act(() => click(button('Accounts')))
    expect(onNavigate).toHaveBeenCalledWith('accounts')
  })

  it('tests the machine with its configured default working directory and disconnects', async () => {
    root = createRoot(host)
    act(() => root!.render(<SshSection isActive onNavigate={vi.fn()} />))
    act(() => click(button('Edit')))
    await act(async () => click(button('Test connection')))

    expect(connect).toHaveBeenCalledWith(
      'ssh-settings-test-ubuntu-1',
      SERVER,
      '/home/corvin/projects/nf-management'
    )
    expect(disconnect).toHaveBeenCalledWith('ssh-settings-test-ubuntu-1')
    expect(host.textContent).toContain('Connection successful')
  })
})
