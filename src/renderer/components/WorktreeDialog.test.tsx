// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorktreeDialog } from './WorktreeDialog'
import { resetDialogStack } from './dialog-stack'
import { resetDialogStack } from './dialog-stack'
import { WorktreeDialog } from './WorktreeDialog'
import type { WorktreeEntry } from '@shared/worktree'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const EXISTING: WorktreeEntry[] = [
  {
    path: 'C:/w/api-checkout',
    branch: 'feature/api',
    head: '1111111',
    isBare: false
  },
  {
    path: 'C:/w/ui-checkout',
    branch: 'feature/ui',
    head: '2222222',
    isBare: false
  },
  {
    path: 'C:/w/detached-checkout',
    branch: null,
    head: '3333333',
    isBare: false
  }
]

describe('WorktreeDialog existing-worktree picker', () => {
  let root: Root | undefined
  let host: HTMLElement
  let opener: HTMLButtonElement

  beforeEach(() => {
    resetDialogStack()
    host = document.createElement('div')
    opener = document.createElement('button')
    opener.textContent = 'Open picker'
    host.appendChild(opener)
    document.body.appendChild(host)
    opener.focus()
const existing: WorktreeEntry[] = [
  { path: '/repo.wt/feature-login', branch: 'feature/login', head: 'a', isBare: false },
  { path: '/repo.wt/fix-api', branch: 'fix/api', head: 'b', isBare: false }
]

describe('WorktreeDialog existing-worktree search', () => {
  let root: Root | undefined
  let host: HTMLElement

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    host.remove()
  })

  function render(existing = EXISTING): { onBindExisting: ReturnType<typeof vi.fn>; onCancel: ReturnType<typeof vi.fn> } {
    const onBindExisting = vi.fn()
    const onCancel = vi.fn()
    resetDialogStack()
  })

  it('filters the scrollable picker by branch or path', () => {
    root = createRoot(host)
    act(() => {
      root!.render(
        <WorktreeDialog
          intent="bind"
          repoPath="C:/w/material-nodeterm"
          existing={existing}
          defaultBaseRef="main"
          branches={['main', 'feature/api', 'feature/ui']}
          defaultPath={() => 'C:/w/new-worktree'}
          busy={false}
          error={null}
          onCreate={vi.fn()}
          onBindExisting={onBindExisting}
          onCancel={onCancel}
        />
      )
    })
    return { onBindExisting, onCancel }
  }

  function setInputValue(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('keeps the counted collection in a dedicated list with reachable actions', () => {
    render()
    const list = document.querySelector<HTMLElement>('#bind-existing-list')
    expect(list?.getAttribute('role')).toBe('list')
    expect(list?.getAttribute('aria-label')).toContain('3')
    expect(document.querySelectorAll('.bind-existing__row')).toHaveLength(3)
    expect(document.querySelector('.confirm__actions')).not.toBeNull()
  })

  it('focuses its own search field and returns focus to the opener on close', () => {
    render()
    const input = document.querySelector<HTMLInputElement>('[aria-label="Filter existing worktrees"]')
    expect(document.activeElement).toBe(input)
    act(() => root!.unmount())
    root = undefined
    expect(document.activeElement).toBe(opener)
  })

  it('filters the visible branch and path text in plain-text mode', () => {
    render()
    const input = document.querySelector<HTMLInputElement>('[aria-label="Filter existing worktrees"]')!
    setInputValue(input, 'UI-CHECKOUT')
    expect(document.querySelectorAll('.bind-existing__row')).toHaveLength(1)
    expect(document.querySelector('.bind-existing__row')?.textContent).toContain('feature/ui')

    setInputValue(input, 'detached-checkout')
    expect(document.querySelectorAll('.bind-existing__row')).toHaveLength(1)
    expect(document.querySelector('.bind-existing__row')?.textContent).toContain('detached HEAD')
  })

  it('shows a no-match state and updates the accessible result count', () => {
    render()
    const input = document.querySelector<HTMLInputElement>('[aria-label="Filter existing worktrees"]')!
    setInputValue(input, 'not-present')
    expect(document.querySelectorAll('.bind-existing__row')).toHaveLength(0)
    expect(document.querySelector('.bind-existing__empty')?.textContent).toMatch(/no existing worktrees match/i)
    expect(document.querySelector('#bind-existing-list')?.getAttribute('aria-label')).toContain('0 of 3')
  })

  it('supports an explicit regex mode through its adjacent builder', () => {
    render()
    const trigger = document.querySelector<HTMLButtonElement>('[aria-label="Regex — existing worktrees"]')!
    act(() => trigger.click())
    const input = document.querySelector<HTMLInputElement>('[aria-label="Filter existing worktrees"]')!
    setInputValue(input, 'feature/(api|ui)$')
    expect(document.querySelectorAll('.bind-existing__row')).toHaveLength(2)
          intent="create"
          repoPath="/repo"
          existing={existing}
          defaultBaseRef="main"
          branches={[]}
          defaultPath={() => '/repo.wt/feature'}
          busy={false}
          error={null}
          onCreate={vi.fn()}
          onBindExisting={vi.fn()}
          onCancel={vi.fn()}
        />
      )
    })

    const search = document.querySelector<HTMLInputElement>(
      '[aria-label="Search existing worktrees"]'
    )!
    expect(document.querySelectorAll('.bind-existing__row')).toHaveLength(2)
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'LOGIN')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const rows = [...document.querySelectorAll('.bind-existing__row')]
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('feature/login')
  })
})
