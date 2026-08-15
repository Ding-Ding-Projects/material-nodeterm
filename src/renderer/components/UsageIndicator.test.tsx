// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeUsage, Project, ProviderUsage, RemoteAccountUsage, UsageLimit } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { useProjects } from '../state/projects'
import { useSettings } from '../state/settings'
import { useSshConn } from '../state/sshConn'
import { registerWorkspaceDirty } from '../state/workspaceDirty'
import { UsageIndicator } from './UsageIndicator'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const LIMIT: UsageLimit = {
  kind: 'session',
  group: 'session',
  usedPercent: 25,
  severity: null,
  resetsAt: null,
  windowMinutes: 300,
  scopeLabel: null,
  isActive: true
}

const usage = (email: string): ClaudeUsage => ({
  limits: [LIMIT],
  session: null,
  weekly: null,
  email,
  updatedAt: 1,
  status: 'ok'
})

const node = (accountId = 'old'): Project['nodes'][number] => ({
  id: 'n1',
  kind: 'terminal',
  position: { x: 0, y: 0 },
  size: { width: 640, height: 440 },
  title: 'Existing Claude',
  color: '#fff',
  group: null,
  accountId
})

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: 'p',
  color: '#fff',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [node()],
  ...over
})

let host: HTMLDivElement
let root: Root
let unregisterDirty: (() => void) | undefined

function accountButtons(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('button.usage-account__select')]
}

async function mount(): Promise<void> {
  host = document.createElement('div')
  root = createRoot(host)
  await act(async () => {
    root.render(<UsageIndicator />)
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function openPopover(): Promise<void> {
  await act(async () => {
    host.querySelector<HTMLButtonElement>('.usage-pill')!.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function tabFromFocusedButton(): void {
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  buttons[current + 1]?.focus()
}

function activateWithSpace(button: HTMLButtonElement): void {
  button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
  button.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }))
  // jsdom does not perform the browser's native Space-to-click default action.
  button.click()
}

beforeEach(() => {
  useProjects.setState({ projects: [], activeProjectId: '' })
  useSettings.setState({ settings: DEFAULT_SETTINGS, hydrated: false })
  useSshConn.setState({ byProject: {}, attachments: {}, autoPermByProject: {}, remoteClaudeVersionByProject: {} })
})

afterEach(() => {
  unregisterDirty?.()
  unregisterDirty = undefined
  if (root) act(() => root.unmount())
  host?.remove()
})

describe('UsageIndicator account defaults', () => {
  it('sets the local managed account as the active project default without changing existing nodes', async () => {
    const originalNodes = [node()]
    const markDirty = vi.fn()
    unregisterDirty = registerWorkspaceDirty(markDirty)
    useProjects.setState({ projects: [project({ nodes: originalNodes })], activeProjectId: 'p1' })
    useSettings.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        claudeAccounts: [{ id: 'a1', label: 'Work', email: 'work@example.test', createdAt: 1 }]
      }
    })
    const codex: ProviderUsage = {
      provider: 'codex',
      limits: [LIMIT],
      account: 'codex@example.test',
      updatedAt: 1,
      status: 'ok'
    }
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      usage: {
        fetch: (accountId?: string) => Promise.resolve(usage(accountId ? 'work@example.test' : 'system@example.test')),
        providers: () => Promise.resolve([codex]),
        remote: () => Promise.resolve([]),
        onUpdate: () => () => {}
      }
    }

    await mount()
    await openPopover()

    expect([...host.querySelectorAll('.usage-account')]).toHaveLength(3)
    expect(accountButtons()).toHaveLength(2)
    expect(accountButtons().some((row) => row.textContent?.includes('Codex'))).toBe(false)
    expect(host.querySelectorAll('button.usage-account')).toHaveLength(0)
    expect(accountButtons()[0].getAttribute('aria-checked')).toBe('true')
    expect(accountButtons()[0].textContent).toBe('Use for new sessions')

    await act(async () => {
      accountButtons()[1].closest<HTMLElement>('.usage-account')!.click()
      await Promise.resolve()
    })
    expect(useProjects.getState().getProject('p1')?.defaultAccountId).toBeUndefined()
    expect(markDirty).not.toHaveBeenCalled()

    await act(async () => {
      accountButtons()[1].click()
      await Promise.resolve()
    })

    expect(useProjects.getState().getProject('p1')?.defaultAccountId).toBe('a1')
    expect(useProjects.getState().getProject('p1')?.nodes).toEqual(originalNodes)
    expect(markDirty).toHaveBeenCalledTimes(1)
    expect(accountButtons()[1].getAttribute('aria-checked')).toBe('true')
    expect(accountButtons()[1].closest('.usage-account')?.querySelector('.usage-account__default')?.textContent).toBe('✓')
  })

  it('clears a local project account default from the System row', async () => {
    const markDirty = vi.fn()
    unregisterDirty = registerWorkspaceDirty(markDirty)
    useProjects.setState({ projects: [project({ defaultAccountId: 'a1' })], activeProjectId: 'p1' })
    useSettings.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        claudeAccounts: [{ id: 'a1', label: 'Work', email: 'work@example.test', createdAt: 1 }]
      }
    })
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      usage: {
        fetch: () => Promise.resolve(usage('system@example.test')),
        providers: () => Promise.resolve([]),
        remote: () => Promise.resolve([]),
        onUpdate: () => () => {}
      }
    }

    await mount()
    await openPopover()
    expect(accountButtons()[1].getAttribute('aria-checked')).toBe('true')

    await act(async () => {
      accountButtons()[0].click()
      await Promise.resolve()
    })

    expect(useProjects.getState().getProject('p1')?.defaultAccountId).toBeUndefined()
    expect(markDirty).toHaveBeenCalledTimes(1)
    expect(accountButtons()[0].getAttribute('aria-checked')).toBe('true')
  })

  it('moves from the focused pill to a local account selector and toggles the popover with Space', async () => {
    useProjects.setState({ projects: [project()], activeProjectId: 'p1' })
    useSettings.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        claudeAccounts: [{ id: 'a1', label: 'Work', email: 'work@example.test', createdAt: 1 }]
      }
    })
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      usage: {
        fetch: (accountId?: string) => Promise.resolve(usage(accountId ? 'work@example.test' : 'system@example.test')),
        providers: () => Promise.resolve([]),
        remote: () => Promise.resolve([]),
        onUpdate: () => () => {}
      }
    }

    await mount()
    document.body.appendChild(host)
    const pill = host.querySelector<HTMLButtonElement>('.usage-pill')!
    await act(async () => {
      pill.focus()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(accountButtons()).toHaveLength(2)

    await act(async () => {
      activateWithSpace(pill)
      await Promise.resolve()
    })
    expect(host.querySelector('.usage-popover')).toBeNull()

    await act(async () => {
      activateWithSpace(pill)
      await Promise.resolve()
    })
    expect(host.querySelector('.usage-popover')).not.toBeNull()

    act(() => tabFromFocusedButton())
    expect(document.activeElement).toBe(accountButtons()[0])
  })

  it('keeps a pointer click on the usage pill as the popover toggle', async () => {
    useProjects.setState({ projects: [project()], activeProjectId: 'p1' })
    useSettings.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        claudeAccounts: [{ id: 'a1', label: 'Work', email: 'work@example.test', createdAt: 1 }]
      }
    })
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      usage: {
        fetch: (accountId?: string) => Promise.resolve(usage(accountId ? 'work@example.test' : 'system@example.test')),
        providers: () => Promise.resolve([]),
        remote: () => Promise.resolve([]),
        onUpdate: () => () => {}
      }
    }

    await mount()
    await openPopover()
    const pill = host.querySelector<HTMLButtonElement>('.usage-pill')!
    expect(host.querySelector('.usage-popover')).not.toBeNull()

    act(() => pill.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
    expect(host.querySelector('.usage-popover')).toBeNull()
  })

  it('keeps a System-only local usage row read-only', async () => {
    const markDirty = vi.fn()
    unregisterDirty = registerWorkspaceDirty(markDirty)
    useProjects.setState({ projects: [project()], activeProjectId: 'p1' })
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      usage: {
        fetch: () => Promise.resolve(usage('system@example.test')),
        providers: () => Promise.resolve([]),
        remote: () => Promise.resolve([]),
        onUpdate: () => () => {}
      }
    }

    await mount()
    await openPopover()

    expect([...host.querySelectorAll('.usage-account')]).toHaveLength(1)
    expect(accountButtons()).toHaveLength(0)
    expect(markDirty).not.toHaveBeenCalled()
  })

  it('uses phrasing content inside selectable account buttons', async () => {
    useProjects.setState({ projects: [project()], activeProjectId: 'p1' })
    useSettings.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        claudeAccounts: [{ id: 'a1', label: 'Work', email: 'work@example.test', createdAt: 1 }]
      }
    })
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      usage: {
        fetch: (accountId?: string) => Promise.resolve(usage(accountId ? 'work@example.test' : 'system@example.test')),
        providers: () => Promise.resolve([]),
        remote: () => Promise.resolve([]),
        onUpdate: () => () => {}
      }
    }

    await mount()
    await openPopover()

    expect(accountButtons()).toHaveLength(2)
    expect(host.querySelector('[role="radiogroup"]')).not.toBeNull()
    expect(accountButtons().every((button) => button.getAttribute('role') === 'radio')).toBe(true)
  })

  it('selects and clears the SSH host account default from its remote Claude rows', async () => {
    const markDirty = vi.fn()
    unregisterDirty = registerWorkspaceDirty(markDirty)
    const ssh = { server: { host: 'box', user: 'enes', port: 22 } as never, remoteCwd: '/srv' }
    useProjects.setState({ projects: [project({ id: 'ssh1', ssh })], activeProjectId: 'ssh1' })
    useSshConn.setState({ byProject: { ssh1: { controlPath: '/tmp/cm' } } })
    const remote: RemoteAccountUsage[] = [
      { hostKey: 'enes@box', accountId: null, label: 'enes@box', usage: usage('system@box') },
      { hostKey: 'enes@box', accountId: 'remote1', label: 'Work', usage: usage('work@box') }
    ]
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      usage: {
        fetch: () => Promise.resolve(usage('local@example.test')),
        providers: () => Promise.resolve([]),
        remote: () => Promise.resolve(remote),
        onUpdate: () => () => {}
      }
    }

    await mount()
    await openPopover()
    expect(accountButtons()).toHaveLength(2)
    expect(accountButtons()[0].getAttribute('aria-checked')).toBe('true')

    await act(async () => {
      accountButtons()[1].click()
      await Promise.resolve()
    })
    expect(useProjects.getState().getProject('ssh1')?.defaultAccountId).toBe('remote1')
    expect(markDirty).toHaveBeenCalledTimes(1)
    expect(accountButtons()[1].getAttribute('aria-checked')).toBe('true')

    await act(async () => {
      accountButtons()[0].click()
      await Promise.resolve()
    })
    expect(useProjects.getState().getProject('ssh1')?.defaultAccountId).toBeUndefined()
    expect(markDirty).toHaveBeenCalledTimes(2)
    expect(accountButtons()[0].getAttribute('aria-checked')).toBe('true')
  })

  it('keeps an SSH System-only usage row read-only', async () => {
    const markDirty = vi.fn()
    unregisterDirty = registerWorkspaceDirty(markDirty)
    const ssh = { server: { host: 'box', user: 'enes', port: 22 } as never, remoteCwd: '/srv' }
    useProjects.setState({ projects: [project({ id: 'ssh1', ssh })], activeProjectId: 'ssh1' })
    useSshConn.setState({ byProject: { ssh1: { controlPath: '/tmp/cm' } } })
    const remote: RemoteAccountUsage[] = [
      { hostKey: 'enes@box', accountId: null, label: 'enes@box', usage: usage('system@box') }
    ]
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      usage: {
        fetch: () => Promise.resolve(usage('local@example.test')),
        providers: () => Promise.resolve([]),
        remote: () => Promise.resolve(remote),
        onUpdate: () => () => {}
      }
    }

    await mount()
    await openPopover()

    expect([...host.querySelectorAll('.usage-account')]).toHaveLength(1)
    expect(accountButtons()).toHaveLength(0)
    expect(markDirty).not.toHaveBeenCalled()
  })

  it('does not dirty the workspace when selecting the current account again', async () => {
    const markDirty = vi.fn()
    unregisterDirty = registerWorkspaceDirty(markDirty)
    useProjects.setState({ projects: [project({ defaultAccountId: 'a1' })], activeProjectId: 'p1' })
    useSettings.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        claudeAccounts: [{ id: 'a1', label: 'Work', email: 'work@example.test', createdAt: 1 }]
      }
    })
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      usage: {
        fetch: () => Promise.resolve(usage('work@example.test')),
        providers: () => Promise.resolve([]),
        remote: () => Promise.resolve([]),
        onUpdate: () => () => {}
      }
    }

    await mount()
    await openPopover()
    await act(async () => {
      accountButtons()[1].click()
      await Promise.resolve()
    })

    expect(useProjects.getState().getProject('p1')?.defaultAccountId).toBe('a1')
    expect(markDirty).not.toHaveBeenCalled()
  })

  it('selects the next account with an Arrow key inside the account radio group', async () => {
    const markDirty = vi.fn()
    unregisterDirty = registerWorkspaceDirty(markDirty)
    useProjects.setState({ projects: [project()], activeProjectId: 'p1' })
    useSettings.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        claudeAccounts: [{ id: 'a1', label: 'Work', email: 'work@example.test', createdAt: 1 }]
      }
    })
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      usage: {
        fetch: () => Promise.resolve(usage('system@example.test')),
        providers: () => Promise.resolve([]),
        remote: () => Promise.resolve([]),
        onUpdate: () => () => {}
      }
    }

    await mount()
    document.body.appendChild(host)
    await openPopover()
    accountButtons()[0].focus()
    await act(async () => {
      accountButtons()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      await Promise.resolve()
    })

    expect(document.activeElement).toBe(accountButtons()[1])
    expect(useProjects.getState().getProject('p1')?.defaultAccountId).toBe('a1')
    expect(markDirty).toHaveBeenCalledTimes(1)
  })

  it('shows System as selected when a stored default account is no longer available', async () => {
    useProjects.setState({ projects: [project({ defaultAccountId: 'gone' })], activeProjectId: 'p1' })
    useSettings.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        claudeAccounts: [{ id: 'a1', label: 'Work', email: 'work@example.test', createdAt: 1 }]
      }
    })
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      usage: {
        fetch: () => Promise.resolve(usage('system@example.test')),
        providers: () => Promise.resolve([]),
        remote: () => Promise.resolve([]),
        onUpdate: () => () => {}
      }
    }

    await mount()
    await openPopover()

    expect(accountButtons()[0].getAttribute('aria-checked')).toBe('true')
    expect(accountButtons()[1].getAttribute('aria-checked')).toBe('false')
  })

  it('dismisses the open popover with Escape and returns focus to the usage pill', async () => {
    useProjects.setState({ projects: [project()], activeProjectId: 'p1' })
    useSettings.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        claudeAccounts: [{ id: 'a1', label: 'Work', email: 'work@example.test', createdAt: 1 }]
      }
    })
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      usage: {
        fetch: () => Promise.resolve(usage('system@example.test')),
        providers: () => Promise.resolve([]),
        remote: () => Promise.resolve([]),
        onUpdate: () => () => {}
      }
    }

    await mount()
    document.body.appendChild(host)
    await openPopover()
    accountButtons()[0].focus()
    await act(async () => {
      accountButtons()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await Promise.resolve()
    })

    expect(host.querySelector('.usage-popover')).toBeNull()
    expect(document.activeElement).toBe(host.querySelector('.usage-pill'))
  })
})
