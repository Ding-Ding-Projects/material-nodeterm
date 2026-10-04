// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { GitHubIssueCardView } from '@shared/github-issues'
import { GitHubIssueSummaryModal } from './GitHubIssueSummaryModal'
import { popDialog, pushDialog } from '../dialog-stack'

// One stable api object, as the real session provides: the checks read is keyed on its identity.
const { pullChecks, session } = vi.hoisted(() => {
  const pullChecks = vi.fn(async () => ({ status: 'no-checks' as const }))
  return {
    pullChecks,
    session: { api: { shell: { openExternal: async () => {} }, githubIssues: { pullChecks } } }
  }
})
vi.mock('../../session/session', () => ({ useSession: () => session }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const issue: GitHubIssueCardView = {
  id: 1, number: 1, title: 'Keyboard access', body: '', state: 'open', stateReason: null,
  htmlUrl: 'https://github.com/o/r/issues/1', apiUrl: 'https://api.github.com/repos/o/r/issues/1',
  labels: [], assignees: [], createdAt: '2026-08-09T00:00:00Z',
  updatedAt: '2026-08-09T00:00:00Z', locked: false, columnId: null, conflict: null
}

describe('GitHubIssueSummaryModal', () => {
  it('contains keyboard focus and restores it when closed', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(
      <GitHubIssueSummaryModal issue={issue} columns={[]} moving={false} readOnly={false}
        onMove={vi.fn()} onClose={vi.fn()} />
    ))
    const close = host.querySelector<HTMLButtonElement>('[aria-label="Close"]')!
    const buttons = host.querySelectorAll<HTMLButtonElement>('button')
    const last = buttons[buttons.length - 1]
    expect(document.activeElement).toBe(close)
    last.focus()
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' })))
    expect(document.activeElement).toBe(close)
    act(() => root.unmount())
    expect(document.activeElement).toBe(opener)
    host.remove()
    opener.remove()
  })

  it('Escape closes the modal, but not while a dialog stacked over it owns the key', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const onClose = vi.fn()
    act(() => root.render(
      <GitHubIssueSummaryModal issue={issue} columns={[]} moving={false} readOnly={false}
        onMove={vi.fn()} onClose={onClose} />
    ))
    pushDialog('stacked-confirm')
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(onClose).not.toHaveBeenCalled()
    popDialog('stacked-confirm')
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => root.unmount())
    host.remove()
  })

  it('a pull request is read-only: no Move control, its own eyebrow, the issues it closes and its checks', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const pull = { ...issue, number: 7, title: 'Pull cards', pull: { draft: false, mergedAt: null } }
    await act(async () => root.render(
      <GitHubIssueSummaryModal issue={pull} kind="pull" projectId="p1" columns={[]} moving={false}
        readOnly={false} onMove={vi.fn()} onClose={vi.fn()}
        pullStatus={{ number: 7, lifecycle: 'open', headRefName: 'feat/x', headRefOid: 'a'.repeat(40), closes: [4, 9] }} />
    ))
    expect(host.textContent).toContain('GitHub pull request #7')
    expect(host.querySelector('select')).toBeNull()
    expect(host.textContent).toContain('Closes #4, #9')
    expect(pullChecks).toHaveBeenCalledWith('p1', 7)
    expect(host.textContent).toContain('No checks on the head commit.')
    act(() => root.unmount())
    host.remove()
  })
})
