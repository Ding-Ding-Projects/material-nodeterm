// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CanvasNodeState, ClaudeAccount, Project } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import {
  ACCOUNT_REMOVAL_COMMITTED_EVENT,
  ACCOUNT_REMOVAL_SCOPE_EVENT,
  ACCOUNT_REMOVAL_TEARDOWN_EVENT,
  type AccountRemovalCommittedDetail,
  type AccountRemovalScopeDetail,
  type AccountRemovalTeardownDetail
} from '../../../lib/accountRemoval'
import { useDestructiveGate } from '../../../state/destructiveGate'
import { useKidsMode } from '../../../state/kidsMode'
import { useProjects } from '../../../state/projects'
import { useSettings } from '../../../state/settings'
import { useSshConn } from '../../../state/sshConn'
import { useSystemAccount } from '../../../state/systemAccount'
import { AccountsSection } from './AccountsSection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ACCOUNT: ClaudeAccount = {
  id: 'account-1',
  label: 'Family',
  email: 'family@example.test',
  pending: true,
  createdAt: 1
}

function node(
  id: string,
  title: string,
  extra: Partial<CanvasNodeState> = {}
): CanvasNodeState {
  return {
    id,
    kind: 'terminal',
    position: { x: 0, y: 0 },
    size: { width: 640, height: 440 },
    title,
    color: '#0a84ff',
    group: null,
    ...extra
  }
}

function projects(): Project[] {
  return [
    {
      id: 'active',
      name: 'Active',
      color: '#0a84ff',
      viewport: { x: 0, y: 0, zoom: 1 },
      defaultAccountId: ACCOUNT.id,
      nodes: [
        node('active-login', 'Renamed sign-in', {
          accountId: ACCOUNT.id,
          accountLogin: true
        }),
        node('active-ordinary', 'Work', {
          accountId: ACCOUNT.id,
          accountLogin: false
        }),
        node('unrelated', 'Other', { accountId: 'account-2', accountLogin: false })
      ]
    },
    {
      id: 'inactive',
      name: 'Inactive',
      color: '#32d74b',
      viewport: { x: 1, y: 2, zoom: 1 },
      defaultAccountId: ACCOUNT.id,
      nodes: [
        node('inactive-login', 'Another renamed sign-in', {
          accountId: ACCOUNT.id,
          accountLogin: true
        }),
        node('inactive-ordinary', 'Background work', {
          accountId: ACCOUNT.id,
          accountLogin: false
        })
      ]
    }
  ]
}

describe('AccountsSection account-removal transaction', () => {
  let host: HTMLDivElement
  let root: Root | undefined
  let cancelWaitLogin: ReturnType<typeof vi.fn>
  let remove: ReturnType<typeof vi.fn>
  let save: ReturnType<typeof vi.fn>
  let order: string[]
  let activeLoginOpen: boolean
  let authorizedEvents: number
  let committedEvents: number
  let onAuthorized: EventListener
  let onCommitted: EventListener
  let onScope: EventListener
  let liveScopeIdentity: string

  beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement('div')
    document.body.appendChild(host)
    order = []
    activeLoginOpen = true
    authorizedEvents = 0
    committedEvents = 0
    liveScopeIdentity = 'active-generation-1'
    cancelWaitLogin = vi.fn(async () => {
      order.push('cancel-wait')
    })
    remove = vi.fn(async () => {
      order.push('remove')
    })
    save = vi.fn(async () => undefined)
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      claudeAccounts: { cancelWaitLogin, remove },
      settings: { save },
      usage: { fetch: vi.fn(async () => null) }
    }

    const settings = { ...DEFAULT_SETTINGS, claudeAccounts: [ACCOUNT] }
    useSettings.setState({ settings, base: settings, hydrated: true })
    useProjects.setState({ projects: projects(), activeProjectId: 'active', reloadNonce: 0 })
    useKidsMode.setState({
      enabled: true,
      hydrated: true,
      policyStatus: 'ready',
      hasCredential: true
    })
    useSystemAccount.setState({ email: null, loaded: true })
    useSshConn.setState({ byProject: {} })
    useDestructiveGate.setState({ request: null })

    onAuthorized = ((event: CustomEvent<AccountRemovalTeardownDetail>) => {
      authorizedEvents += 1
      order.push('close-login')
      activeLoginOpen = false
      event.detail.handled = true
      event.detail.continueRemoval()
    }) as EventListener
    onCommitted = ((event: CustomEvent<AccountRemovalCommittedDetail>) => {
      expect(event.detail.accountId).toBe(ACCOUNT.id)
      committedEvents += 1
      order.push('committed')
    }) as EventListener
    onScope = ((event: CustomEvent<AccountRemovalScopeDetail>) => {
      event.detail.handled = true
      event.detail.identities = [liveScopeIdentity]
    }) as EventListener
    window.addEventListener(ACCOUNT_REMOVAL_TEARDOWN_EVENT, onAuthorized)
    window.addEventListener(ACCOUNT_REMOVAL_COMMITTED_EVENT, onCommitted)
    window.addEventListener(ACCOUNT_REMOVAL_SCOPE_EVENT, onScope)
  })

  afterEach(async () => {
    act(() => root?.unmount())
    root = undefined
    window.removeEventListener(ACCOUNT_REMOVAL_TEARDOWN_EVENT, onAuthorized)
    window.removeEventListener(ACCOUNT_REMOVAL_COMMITTED_EVENT, onCommitted)
    window.removeEventListener(ACCOUNT_REMOVAL_SCOPE_EVENT, onScope)
    useDestructiveGate.setState({ request: null })
    await vi.runOnlyPendingTimersAsync()
    vi.useRealTimers()
    host.remove()
  })

  function mount(): void {
    root = createRoot(host)
    act(() => root!.render(<AccountsSection isActive />))
  }

  function removeButton(): HTMLButtonElement {
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Remove account"]')
    expect(button).toBeTruthy()
    return button!
  }

  function click(element: HTMLElement): void {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }

  function gateRequest() {
    const request = useDestructiveGate.getState().request
    expect(request).toBeTruthy()
    return request!
  }

  it('leaves the real account, stores, API, and login session untouched on cancel', () => {
    mount()
    const settingsBefore = structuredClone(useSettings.getState().settings)
    const projectsBefore = structuredClone(useProjects.getState().projects)

    act(() => click(removeButton()))
    const request = gateRequest()

    expect(cancelWaitLogin).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(authorizedEvents).toBe(0)
    expect(committedEvents).toBe(0)
    expect(activeLoginOpen).toBe(true)
    expect(useSettings.getState().settings).toEqual(settingsBefore)
    expect(useProjects.getState().projects).toEqual(projectsBefore)

    act(() => {
      useDestructiveGate.getState().close()
      request.onCancel?.()
    })
    expect(activeLoginOpen).toBe(true)
    expect(useSettings.getState().settings).toEqual(settingsBefore)
    expect(useProjects.getState().projects).toEqual(projectsBefore)
  })

  it('cancels the pending poll, closes login, then commits every store only after success', async () => {
    let resolveRemove!: () => void
    remove.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          order.push('remove')
          resolveRemove = resolve
        })
    )
    mount()
    const projectsBefore = structuredClone(useProjects.getState().projects)

    act(() => click(removeButton()))
    const request = gateRequest()
    await act(async () => {
      useDestructiveGate.getState().close()
      request.onConfirm()
      await Promise.resolve()
    })

    expect(order).toEqual(['cancel-wait', 'close-login', 'remove'])
    expect(activeLoginOpen).toBe(false)
    expect(cancelWaitLogin).toHaveBeenCalledWith(ACCOUNT.id)
    expect(remove).toHaveBeenCalledWith(ACCOUNT.id, undefined)
    expect(useSettings.getState().settings.claudeAccounts).toEqual([ACCOUNT])
    expect(useProjects.getState().projects).toEqual(projectsBefore)
    expect(removeButton().disabled).toBe(true)
    expect(committedEvents).toBe(0)

    await act(async () => {
      resolveRemove()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(useSettings.getState().settings.claudeAccounts).toEqual([])
    expect(useSettings.getState().base.claudeAccounts).toEqual([])
    for (const project of useProjects.getState().projects) {
      expect(project.defaultAccountId).toBeUndefined()
      expect(project.nodes.some((candidate) => candidate.accountLogin === true)).toBe(false)
      expect(project.nodes.every((candidate) => candidate.accountId !== ACCOUNT.id)).toBe(true)
    }
    expect(
      useProjects
        .getState()
        .projects[0].nodes.find((candidate) => candidate.id === 'unrelated')?.accountId
    ).toBe('account-2')
    expect(committedEvents).toBe(1)
    expect(order).toEqual(['cancel-wait', 'close-login', 'remove', 'committed'])

    await vi.advanceTimersByTimeAsync(300)
    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ claudeAccounts: [] })
    )
  })

  it('keeps account metadata and bindings retryable when credential removal rejects', async () => {
    remove.mockImplementationOnce(async () => {
      order.push('remove')
      throw new Error('disk unavailable')
    })
    mount()
    const settingsBefore = structuredClone(useSettings.getState().settings)
    const projectsBefore = structuredClone(useProjects.getState().projects)

    act(() => click(removeButton()))
    const request = gateRequest()
    await act(async () => {
      useDestructiveGate.getState().close()
      request.onConfirm()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(order).toEqual(['cancel-wait', 'close-login', 'remove'])
    expect(activeLoginOpen).toBe(false)
    expect(useSettings.getState().settings).toEqual(settingsBefore)
    expect(useProjects.getState().projects).toEqual(projectsBefore)
    expect(committedEvents).toBe(0)
    expect(host.textContent).toMatch(/account and stored credentials were kept/i)
    expect(removeButton().disabled).toBe(false)
  })

  it('rechecks Kids mode before an already-open ordinary confirmation can commit', () => {
    useKidsMode.setState({ enabled: false, policyStatus: 'ready' })
    mount()

    act(() => click(removeButton()))
    expect(useDestructiveGate.getState().request).toBeNull()
    const ordinaryRemove = document.querySelector<HTMLButtonElement>('.confirm__btn.danger')
    expect(ordinaryRemove).toBeTruthy()

    act(() => useKidsMode.setState({ enabled: true }))
    act(() => click(ordinaryRemove!))

    expect(gateRequest().title).toMatch(/Remove account/)
    expect(cancelWaitLogin).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(authorizedEvents).toBe(0)
    expect(activeLoginOpen).toBe(true)
  })

  it('upgrades an ordinary confirmation when the Kids record becomes unavailable', () => {
    useKidsMode.setState({ enabled: false, policyStatus: 'ready' })
    mount()

    act(() => click(removeButton()))
    const ordinaryRemove = document.querySelector<HTMLButtonElement>('.confirm__btn.danger')
    expect(ordinaryRemove).toBeTruthy()

    act(() => useKidsMode.setState({ policyStatus: 'unavailable' }))
    act(() => click(ordinaryRemove!))

    expect(gateRequest().title).toMatch(/Remove account/)
    expect(remove).not.toHaveBeenCalled()
    expect(authorizedEvents).toBe(0)
  })

  it('performs zero teardown when the disclosed account changes under the dialog', () => {
    useKidsMode.setState({ enabled: false, policyStatus: 'ready' })
    mount()

    act(() => click(removeButton()))
    const ordinaryRemove = document.querySelector<HTMLButtonElement>('.confirm__btn.danger')
    expect(ordinaryRemove).toBeTruthy()
    act(() => {
      const state = useSettings.getState()
      state.update({
        claudeAccounts: state.settings.claudeAccounts.map((account) =>
          account.id === ACCOUNT.id ? { ...account, label: 'Replacement identity' } : account
        )
      })
    })
    act(() => click(ordinaryRemove!))

    expect(remove).not.toHaveBeenCalled()
    expect(cancelWaitLogin).not.toHaveBeenCalled()
    expect(authorizedEvents).toBe(0)
    expect(host.textContent).toMatch(/changed while the confirmation was open/i)
  })

  it('performs zero teardown when the live active-node scope changes under the dialog', () => {
    useKidsMode.setState({ enabled: false, policyStatus: 'ready' })
    mount()

    act(() => click(removeButton()))
    const ordinaryRemove = document.querySelector<HTMLButtonElement>('.confirm__btn.danger')
    expect(ordinaryRemove).toBeTruthy()
    liveScopeIdentity = 'active-generation-2'
    act(() => click(ordinaryRemove!))

    expect(remove).not.toHaveBeenCalled()
    expect(cancelWaitLogin).not.toHaveBeenCalled()
    expect(authorizedEvents).toBe(0)
    expect(host.textContent).toMatch(/changed while the confirmation was open/i)
  })

  it('performs zero teardown when the account changes during the pending-login await', async () => {
    let resolveCancel!: () => void
    cancelWaitLogin.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveCancel = resolve
        })
    )
    mount()
    act(() => click(removeButton()))
    const request = gateRequest()
    act(() => {
      useDestructiveGate.getState().close()
      request.onConfirm()
    })

    act(() => {
      const state = useSettings.getState()
      state.update({
        claudeAccounts: state.settings.claudeAccounts.map((account) =>
          account.id === ACCOUNT.id ? { ...account, label: 'Replacement during await' } : account
        )
      })
    })
    await act(async () => {
      resolveCancel()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(authorizedEvents).toBe(0)
    expect(activeLoginOpen).toBe(true)
    expect(remove).not.toHaveBeenCalled()
    expect(host.textContent).toMatch(/changed before removal could commit/i)
  })

  it('opens a fresh gate when policy becomes unavailable during the pending-login await', async () => {
    let resolveCancel!: () => void
    cancelWaitLogin.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveCancel = resolve
        })
    )
    useKidsMode.setState({ enabled: false, policyStatus: 'ready' })
    mount()
    act(() => click(removeButton()))
    const ordinaryRemove = document.querySelector<HTMLButtonElement>('.confirm__btn.danger')
    expect(ordinaryRemove).toBeTruthy()
    act(() => click(ordinaryRemove!))

    act(() => useKidsMode.setState({ policyStatus: 'unavailable' }))
    await act(async () => {
      resolveCancel()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(gateRequest().title).toMatch(/Remove account/)
    expect(authorizedEvents).toBe(0)
    expect(activeLoginOpen).toBe(true)
    expect(remove).not.toHaveBeenCalled()
  })
})
