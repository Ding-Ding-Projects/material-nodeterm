import { describe, expect, it, vi } from 'vitest'
import type { Project } from '../../shared/types'
import type { GitHubControlState } from '../../shared/github-issues'
import { GitHubHostController, GitHubHostError } from './host'

const project: Project = {
  id: 'project-1',
  name: 'Test',
  color: '#8b5cf6',
  cwd: '/repo',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
  kanban: {
    columns: [
      { id: 'todo', title: 'Todo', color: '#2563eb' },
      { id: 'done', title: 'Done', color: '#16a34a' }
    ],
    assignments: [],
    github: {
      columnMappings: [
        { columnId: 'todo', label: 'status:todo' },
        { columnId: 'done', label: 'status:done' }
      ],
      completionColumnId: 'done'
    }
  }
}

function fixture() {
  let state: GitHubControlState = {
    version: 1,
    revision: 0,
    authProvider: 'auto',
    approvals: []
  }
  let token = 'secret'
  const secret = {
    availability: 'encrypted' as const,
    readForHost: vi.fn(async () => token || null),
    save: vi.fn(async (value: string) => { token = value }),
    clear: vi.fn(async () => { token = '' })
  }
  const controls = {
    load: vi.fn(async () => structuredClone(state)),
    isApproved: vi.fn((current: GitHubControlState, input: {
      localApprovalId: string
      projectId: string
      repository: string
    }) => current.approvals.some((item) => item.localApprovalId === input.localApprovalId &&
      item.projectId === input.projectId && item.repository === input.repository)),
    approve: vi.fn(async (input: {
      expectedRevision: number
      localApprovalId: string
      projectId: string
      repository: string
    }) => {
      state = {
        ...state,
        revision: state.revision + 1,
        approvals: [{ ...input, enabled: true as const, approvedAt: 1 }]
      }
      return structuredClone(state)
    }),
    revoke: vi.fn(async () => {
      state = { ...state, revision: state.revision + 1, approvals: [] }
      return structuredClone(state)
    }),
    selectProvider: vi.fn(async (input: { provider: 'auto' | 'gh' | 'token' }) => {
      state = { ...state, revision: state.revision + 1, authProvider: input.provider }
      return structuredClone(state)
    })
  }
  const resolver = {
    status: vi.fn(async (provider: 'auto' | 'gh' | 'token') => ({
      selectedProvider: provider,
      activeProvider: token ? 'token' as const : null,
      ghAuthenticated: false,
      tokenPresent: !!token,
      storage: secret.availability,
      ...(token ? { login: 'octocat' } : {})
    })),
    resolve: vi.fn(async () => token ? {
      provider: 'token' as const,
      token,
      userId: '1',
      login: 'octocat'
    } : null)
  }
  const client = {
    listIssues: vi.fn(),
    getIssue: vi.fn(),
    updateIssue: vi.fn(),
    listRepositoryLabels: vi.fn(),
    createLabel: vi.fn()
  }
  const validateToken = vi.fn(async (value: string) => value === 'valid-token'
    ? { userId: '1', login: 'octocat' }
    : null)
  const controller = new GitHubHostController({
    project: vi.fn(async (id: string) => id === project.id
      ? { project, localApprovalId: 'local-private-id' }
      : null),
    detectRepository: vi.fn(async () => 'owner/repo'),
    controls,
    resolver,
    secret,
    validateToken,
    client: vi.fn(() => client)
  })
  return { controller, controls, resolver, secret, validateToken, client }
}

describe('GitHubHostController', () => {
  it('returns a status view without tokens, approvals, or the local approval id', async () => {
    const { controller, resolver } = fixture()
    const view = await controller.status('project-1')
    expect(view).toMatchObject({
      control: { revision: 0, authProvider: 'auto' },
      project: { repository: 'owner/repo', detectedRepository: 'owner/repo', approved: false }
    })
    expect(JSON.stringify(view)).not.toMatch(/secret|local-private-id|approvals/i)
    expect(resolver.status).not.toHaveBeenCalled()
  })

  it('requires exact local approval before creating a service context', async () => {
    const { controller } = fixture()
    await expect(controller.contextForProject('project-1')).rejects.toMatchObject({ code: 'not-approved' })
    await controller.approve({ projectId: 'project-1', repository: 'owner/repo', expectedRevision: 0 })
    const context = await controller.contextForProject('project-1')
    expect(context).toMatchObject({
      projectId: 'project-1',
      repository: 'owner/repo',
      userId: '1',
      columnColors: { todo: '#2563eb', done: '#16a34a' }
    })
  })

  it('rejects approval for a repository other than the configured or detected repository', async () => {
    const { controller } = fixture()
    await expect(controller.approve({
      projectId: 'project-1', repository: 'other/repo', expectedRevision: 0
    })).rejects.toBeInstanceOf(GitHubHostError)
  })

  it('validates a token before saving and never returns it', async () => {
    const { controller, secret } = fixture()
    await expect(controller.saveToken('bad')).rejects.toMatchObject({ code: 'invalid-token' })
    expect(secret.save).not.toHaveBeenCalled()
    const view = await controller.saveToken('valid-token')
    expect(secret.save).toHaveBeenCalledWith('valid-token')
    expect(JSON.stringify(view)).not.toContain('valid-token')
  })

  it('queues Clear behind an earlier Save network validation so the token cannot resurrect', async () => {
    const { controller, secret, validateToken } = fixture()
    let releaseValidation!: (identity: { userId: string; login: string }) => void
    validateToken.mockImplementationOnce(() => new Promise((resolve) => {
      releaseValidation = resolve
    }))

    const saving = controller.saveToken('slow-valid-token')
    await vi.waitFor(() => expect(validateToken).toHaveBeenCalledWith('slow-valid-token'))
    const clearing = controller.clearToken()
    await Promise.resolve()
    expect(secret.clear).not.toHaveBeenCalled()

    releaseValidation({ userId: '1', login: 'octocat' })
    await expect(saving).resolves.toMatchObject({ auth: { tokenPresent: true } })
    await expect(clearing).resolves.toMatchObject({ auth: { tokenPresent: false } })
    expect(secret.save.mock.invocationCallOrder[0]).toBeLessThan(secret.clear.mock.invocationCallOrder[0])
  })

  it('recovers the credential queue after validation and store-save failures', async () => {
    const { controller, secret } = fixture()

    const invalid = controller.saveToken('bad')
    const clearAfterValidation = controller.clearToken()
    await expect(invalid).rejects.toMatchObject({ code: 'invalid-token' })
    await expect(clearAfterValidation).resolves.toMatchObject({ auth: { tokenPresent: false } })

    secret.save.mockRejectedValueOnce(Object.assign(new Error('EACCES: store unavailable'), {
      code: 'EACCES'
    }))
    const failedSave = controller.saveToken('valid-token')
    const clearAfterSave = controller.clearToken()
    await expect(failedSave).rejects.toMatchObject({ code: 'EACCES' })
    await expect(clearAfterSave).resolves.toMatchObject({ auth: { tokenPresent: false } })
  })
})
