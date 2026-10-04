// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { GitHubIssueCardView } from '@shared/github-issues'
import type { GitHubPullStatus } from '@shared/github-pull-status'
import { KanbanColumn } from './KanbanColumn'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const base = {
  body: '', state: 'open' as const, stateReason: null, labels: [], assignees: [],
  createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z', locked: false,
  columnId: null, conflict: null
}
const issue: GitHubIssueCardView = {
  ...base, id: 4, number: 4, title: 'Fix polling',
  htmlUrl: 'https://github.com/o/r/issues/4', apiUrl: 'https://api.github.com/repos/o/r/issues/4'
}
const pull: GitHubIssueCardView = {
  ...base, id: 12, number: 12, title: 'Poll less', pull: { draft: false, mergedAt: null },
  htmlUrl: 'https://github.com/o/r/pull/12', apiUrl: 'https://api.github.com/repos/o/r/issues/12'
}
const status: GitHubPullStatus = {
  number: 12, lifecycle: 'open', headRefName: 'fix/poll', headRefOid: 'a'.repeat(40),
  ci: 'failed', merge: 'conflict', closes: [4]
}

function render(onOpenPull = vi.fn()): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  act(() => createRoot(host).render(
    <KanbanColumn
      column={null}
      cards={[]}
      githubCards={[issue]}
      githubPulls={[pull]}
      pullStatusOf={(n) => (n === 12 ? status : undefined)}
      pullsForIssue={(n) => (n === 4 ? [status] : undefined)}
      onOpenPull={onOpenPull}
      onOpenCard={() => {}}
      metaOf={() => undefined}
      labelsOf={() => []}
      terminalProfileOf={() => undefined}
      createOptions={[]}
      onCreate={() => {}}
      onCardDragStart={() => {}}
      onDragEnd={() => {}}
      onDropOnColumn={() => {}}
      onDropAtCard={() => {}}
      onCardContext={() => {}}
    />
  ))
  return host
}

describe('KanbanColumn pull request lane', () => {
  it('stacks a read-only PR card under the issues, with its CI, merge state and closed issues', () => {
    const host = render()
    const cards = [...host.querySelectorAll('article')]
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual([
      'Open GitHub issue #4: Fix polling',
      'Open pull request #12: Poll less'
    ])
    const pr = cards[1]
    expect(pr.getAttribute('draggable')).toBeNull()
    expect(pr.querySelector('select')).toBeNull()
    expect(pr.textContent).toContain('Checks failing')
    expect(pr.textContent).toContain('Conflicts')
    expect(pr.textContent).toContain('Closes #4')
    // The issue the PR closes carries the compact chip.
    expect(cards[0].querySelector('.pull-ref')?.textContent).toContain('PR #12')
    expect(host.querySelector('.kanban-col__count')?.textContent).toBe('2')
  })

  it('opens the PR from the keyboard', () => {
    const open = vi.fn()
    const host = render(open)
    const pr = host.querySelectorAll<HTMLElement>('article')[1]
    act(() => pr.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(open).toHaveBeenCalledWith(pull)
  })
})
