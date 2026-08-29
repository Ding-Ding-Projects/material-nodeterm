// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSchoolMode } from '../state/schoolMode'
import { FilesNode } from './FilesNode'
import GitHubWorkItemNode from './GitHubWorkItemNode'
import { GitHubWorkItemAttachment } from './GitHubWorkItemAttachment'
import { GitHubWorkItemDetailDialog } from './GitHubWorkItemDetailDialog'
import type { GitHubWorkItem } from '@shared/github-work-items'

vi.mock('@xyflow/react', () => ({
  NodeResizer: () => null,
  useReactFlow: () => ({
    updateNodeData: vi.fn(),
    deleteElements: vi.fn(),
    setNodes: vi.fn()
  })
}))

const fs = {
  list: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
  write: vi.fn()
}

vi.mock('../session/session', () => ({
  useSession: () => ({ api: { fs, shell: { openPath: vi.fn(), reveal: vi.fn() }, clipboard: { writeText: vi.fn() } }, source: 'local' })
}))
vi.mock('../state/projects', () => ({ useProjects: (selector: (value: { activeProjectId: string }) => unknown) => selector({ activeProjectId: 'project-1' }) }))
vi.mock('../terminal/ssh-fs', () => ({ sshFs: () => fs }))
vi.mock('../components/promptDialog', () => ({ promptDialog: vi.fn() }))
vi.mock('../components/ContextMenu', () => ({ ContextMenu: () => null }))
vi.mock('../components/regex/AnchoredRegexBuilder', () => ({ AnchoredRegexBuilder: () => null }))
vi.mock('../bridge/runtime', () => ({ isBrowserRuntime: () => false }))

const item: GitHubWorkItem = {
  schemaVersion: 1,
  kind: 'issue',
  repository: 'owner/repo',
  number: 42,
  title: 'Issue title from provider',
  bodyMarkdown: '**Issue body from provider**',
  state: 'open',
  author: { login: 'provider-author' },
  labels: [{ name: 'Issue' }],
  reviewState: 'changes requested',
  checksState: 'failure',
  updatedAt: '2026-08-28T20:00:00Z',
  htmlUrl: 'https://github.com/owner/repo/issues/42',
  sessionIds: ['session-1'],
  attachedNodeId: 'session-1',
  refreshState: 'fresh',
  lastRefreshAt: '2026-08-28T20:01:00Z'
}

function nodeProps(data: Record<string, unknown>): never {
  return { id: 'node-1', data, selected: false } as never
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  fs.list.mockReset()
  usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
  useSchoolMode.setState({ enabled: false, hydrated: false, name: 'School mode' })
})

function loadVocabulary(entries: Record<string, string>): void {
  usePersonalVocabulary.setState({ entries, status: 'loaded', entryCount: Object.keys(entries).length, loadedAt: Date.now(), lastError: null })
  useSchoolMode.setState({ enabled: false, hydrated: true })
}

describe('Files and GitHub work-item personal-vocabulary boundaries', () => {
  it('maps file-node chrome while keeping filenames and paths exact and keyboard reachable', async () => {
    loadVocabulary({
      'Filter files…': 'List files…',
      'Open file ': 'Read file ',
      'README.md': 'DO NOT REWRITE',
      'Refresh': 'Reload list'
    })
    fs.list.mockResolvedValue([{ name: 'README.md', dir: false }])

    render(<FilesNode {...nodeProps({ cwd: '/repo', color: '#6750A4', title: 'Files' })} />)

    await waitFor(() => expect(screen.getByText('README.md')).toBeTruthy())
    expect(screen.getByPlaceholderText('List files…')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Read file README.md' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload list' })).toBeTruthy()
  })

  it('restores shipped file wording in School mode without changing the path fact', async () => {
    loadVocabulary({ 'Filter files…': 'List files…', 'Open file ': 'Read file ' })
    fs.list.mockResolvedValue([{ name: 'notes.txt', dir: false }])
    const view = render(<FilesNode {...nodeProps({ cwd: '/repo', color: '#6750A4' })} />)
    await waitFor(() => expect(screen.getByText('notes.txt')).toBeTruthy())
    expect(screen.getByPlaceholderText('List files…')).toBeTruthy()

    useSchoolMode.setState({ enabled: true, hydrated: true, name: 'School mode' })
    await waitFor(() => expect(screen.getByPlaceholderText('Filter files…')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Open file notes.txt' })).toBeTruthy()
    view.unmount()
  })

  it('maps work-item chrome but leaves provider title, labels, body, URL, and state facts byte-identical', () => {
    loadVocabulary({
      Issue: 'Ticket',
      'Labels: ': 'Tags: ',
      'Open on GitHub': 'View upstream'
    })
    render(<GitHubWorkItemNode {...nodeProps({ githubWorkItem: { ...item, attachedNodeId: undefined } })} />)
    const node = screen.getByRole('article')
    expect(node.getAttribute('aria-label')).toBe('Ticket owner/repo #42')
    expect(screen.getByText('Ticket')).toBeTruthy()
    expect(screen.getByText('Issue title from provider')).toBeTruthy()
    expect(screen.getByText('Tags: Issue')).toBeTruthy()
    expect(screen.getByText('Issue body from provider')).toBeTruthy()
    expect(screen.getByText('Reviews: changes requested · Checks: failure')).toBeTruthy()
  })

  it('keeps detail-dialog provider facts exact while mapping only authored actions and headings', () => {
    loadVocabulary({
      Issue: 'Ticket',
      Close: 'Dismiss',
      'Open on GitHub': 'View upstream'
    })
    render(<GitHubWorkItemDetailDialog item={item} nodeId="node-1" frameId="frame-1" onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Ticket owner/repo #42' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View upstream' }).getAttribute('href')).toBe(item.htmlUrl)
    expect(screen.getByText('Issue title from provider')).toBeTruthy()
    expect(screen.getByText('Labels: Issue')).toBeTruthy()
    expect(screen.getByText('Issue body from provider')).toBeTruthy()
  })

  it('maps attachment state copy while preserving provider title and repository facts', () => {
    loadVocabulary({ Issue: 'Ticket', FAILED: 'In motion' })
    render(<GitHubWorkItemAttachment items={[item]} nodeId="session-1" />)
    expect(screen.getByRole('list', { name: 'Pull requests and issues attached to this session' })).toBeTruthy()
    const chip = screen.getByRole('listitem')
    expect(chip.getAttribute('title')).toContain('owner/repo #42: Issue title from provider')
    expect(chip.getAttribute('aria-label')).toContain('Ticket owner/repo #42')
    expect(screen.getByText('Ticket')).toBeTruthy()
    expect(screen.getByText('In motion')).toBeTruthy()
  })
})
