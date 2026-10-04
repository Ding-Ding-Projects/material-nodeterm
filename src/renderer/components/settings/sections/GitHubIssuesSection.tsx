import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  GitHubAuthProvider,
  GitHubAuthStatus,
  GitHubControlView,
  ProjectKanbanGitHub
} from '@shared/github-issues'
import { useProjects } from '../../../state/projects'
import { markWorkspaceDirty } from '../../../state/workspaceDirty'
import { SettingsSection } from '../SettingsSection'
import { SettingsText } from '../SettingsText'
import { SearchableRow } from '../SearchableRow'
import { useSettingsSearch } from '../context'
import { FieldRow } from '../FieldRow'
import { ConfirmDialog } from '../../ConfirmDialog'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'
import { Select } from '@renderer/ui/Select'
import { Switch } from '@renderer/ui/Switch'
import { describeGitHubAuth, tokenFieldIsPrimary } from '../../../lib/githubAuthView'
import { GitHubCliAccountsPanel } from './GitHubCliAccountsPanel'
import {
  githubRateCopy,
  githubThrottleCopy,
  githubUnreachableCopy,
  type GitHubSyncCopy
} from '../../../lib/githubSyncStatus'
import { useLocalizedVocabularyText } from '../../../lib/personalVocabulary/useLocalizedVocabularyText'

const ROWS = {
  enable: {
    title: 'GitHub Issues',
    description: 'Show repository issues on this project Kanban board.',
    keywords: ['github', 'issues', 'kanban', 'sync', 'repository']
  },
  repository: {
    title: 'Repository',
    keywords: ['github', 'origin', 'owner', 'repository', 'override']
  },
  authentication: {
    title: 'Authentication',
    keywords: ['github', 'token', 'personal access token', 'cli', 'authentication']
  },
  accounts: {
    title: 'GitHub CLI accounts',
    description: 'Discover, sign in, switch, refresh, and sign out GitHub CLI accounts.',
    keywords: ['github', 'cli', 'accounts', 'account', 'owner', 'organization', 'scope', 'login']
  },
  mapping: {
    title: 'Column labels',
    keywords: ['github', 'labels', 'columns', 'mapping', 'workflow', 'completion']
  },
  data: {
    title: 'Sync and local data',
    keywords: ['github', 'refresh', 'cache', 'revoke', 'labels']
  }
}
const ENTRIES = Object.values(ROWS)

/** Canvas's debounced workspace save (the `markWorkspaceDirty` seam rides it). */
export const WORKSPACE_SAVE_DEBOUNCE_MS = 800

/** The host reads the GitHub config from the project FILE, which a local edit reaches only through
 *  the debounced autosave — so a status read right after an edit would describe the old mapping
 *  (e.g. keep saying "Ready as …" for labels this machine has not approved). Re-read once, a margin
 *  after that save can have landed. */
export const STATUS_AFTER_EDIT_MS = WORKSPACE_SAVE_DEBOUNCE_MS + 700

type Confirmation = 'labels' | 'cache' | 'revoke' | null
type NoticeRow = 'repository' | 'authentication' | 'data'

function defaultGitHub(columns: Array<{ id: string; title: string }>): ProjectKanbanGitHub {
  return {
    columnMappings: columns.map((column) => ({
      columnId: column.id,
      label: `status:${column.title.trim().toLocaleLowerCase('en-US').replace(/\s+/g, '-')}`
    })),
    ...(columns.length ? { completionColumnId: columns[columns.length - 1].id } : {})
  }
}

function messageFor(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code: unknown }).code)
    : error instanceof Error ? error.message : ''
  if (code.includes('revision-conflict')) return 'Settings changed elsewhere. The latest state has been loaded.'
  // Checked before anything that could read as an auth problem: a limit or an outage is not the
  // user's credential, and naming it as one sends them to re-authenticate an account that is fine.
  if (code.includes('rate-limited')) return 'GitHub’s rate limit was reached. Try again later.'
  if (code.includes('github-unreachable')) {
    return 'GitHub could not be reached. Nothing was changed; try again in a moment.'
  }
  if (code.includes('revoked-cache-kept')) {
    return 'This machine is revoked, but its cached issues could not be deleted. Use “Clear cached data” to remove them.'
  }
  if (code.includes('invalid-token')) return 'GitHub could not validate that token.'
  if (code.includes('not-authenticated')) return 'Sign in with GitHub CLI or save a valid token first.'
  if (code.includes('not-approved')) return 'Approve this repository on this machine first.'
  // The settings edit is saved on a debounce, so a click within that window reaches a host that
  // has not seen it yet. Name the wait rather than the generic failure.
  if (code.includes('invalid-configuration') || code.includes('repository-not-found')) {
    return 'These settings have not finished saving. Try again in a moment.'
  }
  return 'The GitHub action could not be completed. Please try again.'
}

export function GitHubIssuesSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const projectId = useProjects((state) => state.activeProjectId)
  const project = useProjects((state) => state.projects.find((item) => item.id === state.activeProjectId))
  const setProjectKanban = useProjects((state) => state.setProjectKanban)
  const board = project?.kanban
  const githubConfig = board?.github
  const [view, setView] = useState<GitHubControlView | null>(null)
  // The auth block this screen DESCRIBES — see authBlockFor: it is not always `view.auth`.
  const [auth, setAuth] = useState<GitHubAuthStatus | null>(null)
  const [token, setToken] = useState('')
  const [repositoryDraft, setRepositoryDraft] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  // Which row the current notice belongs to. A result rendered away from the control that produced
  // it reads as no result at all — an Approve failure shown three rows down looks like a dead button.
  const [noticeRow, setNoticeRow] = useState<NoticeRow>('data')
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const searchQuery = useSettingsSearch()
  const text = useLocalizedVocabularyText()
  /** A sync sentence, localized and vocabulary-mapped before its facts (times, counts) go in. */
  const syncText = (copy: GitHubSyncCopy): string => text(copy.id, copy.template, copy.facts)

  /** `GitHubHostController.status(projectId)` MASKS the auth block for a project that is not
   *  approved on this machine (`ghAuthenticated: false, activeProvider: null, tokenPresent: false`)
   *  — a deliberate credential boundary, but it means "not approved yet" is indistinguishable from
   *  "signed out". Approval comes AFTER authentication in the visible flow, so reading the masked
   *  block put "GitHub CLI is not signed in. Run `gh auth login`" in front of every signed-in user
   *  during setup. Ask for the project-independent block in exactly that case; when the project IS
   *  approved the view already carries the real one, so the approved path spawns nothing extra. */
  const authBlockFor = async (next: GitHubControlView): Promise<GitHubAuthStatus | null> => {
    if (!next.project || next.project.approved) return next.auth
    try {
      return (await window.nodeTerminal.githubControl.status()).auth
    } catch {
      // Unknown beats a confident wrong answer: the copy falls back to its neutral branch.
      return null
    }
  }

  const refreshStatus = async (): Promise<void> => {
    if (!projectId) return
    const next = await window.nodeTerminal.githubControl.status(projectId)
    setView(next)
    setAuth(await authBlockFor(next))
  }

  useEffect(() => {
    if (!isActive || !projectId || project?.remote) return
    let live = true
    void (async () => {
      try {
        const next = await window.nodeTerminal.githubControl.status(projectId)
        if (!live) return
        setView(next)
        const block = await authBlockFor(next)
        if (live) setAuth(block)
      } catch (error) {
        if (live) setNotice(messageFor(error))
      }
    })()
    return () => { live = false }
  }, [isActive, projectId, project?.remote])

  useEffect(() => {
    setRepositoryDraft(githubConfig?.repository ?? '')
  }, [projectId, githubConfig?.repository])

  // A config edit changes what the host will answer, but only once it is on disk: re-read the status
  // after the save can have landed (see STATUS_AFTER_EDIT_MS). The first render is not an edit.
  const configKey = JSON.stringify(githubConfig ?? null)
  const statusConfigKey = useRef(configKey)
  useEffect(() => {
    if (!isActive || !projectId || project?.remote || statusConfigKey.current === configKey) return
    statusConfigKey.current = configKey
    let live = true
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const next = await window.nodeTerminal.githubControl.status(projectId)
          if (!live) return
          setView(next)
          const block = await authBlockFor(next)
          if (live) setAuth(block)
        } catch { /* the last status stays; the next action re-reads it */ }
      })()
    }, STATUS_AFTER_EDIT_MS)
    return () => { live = false; clearTimeout(timer) }
  }, [configKey, isActive, projectId, project?.remote])

  /** The host reads this project from DISK (`workspaceStore.githubProject`), so an edit that stays
   *  in the renderer store is invisible to approve/refresh — `resolveProject` sees no `github`
   *  block and throws `invalid-configuration`. `markWorkspaceDirty` is the seam every other
   *  `setProjectKanban` caller outside Canvas pairs with (NodeLabels): it rides Canvas's debounced
   *  save, so the write keeps the canvas commit and the external-change conflict gate. */
  const updateConfig = (next: ProjectKanbanGitHub | undefined): void => {
    if (!board || !projectId) return
    const updated = { ...board }
    if (next) updated.github = next
    else delete updated.github
    setProjectKanban(projectId, updated)
    markWorkspaceDirty()
    setNotice('')
  }

  const run = async (
    name: string,
    action: () => Promise<void>,
    success: string,
    row: NoticeRow = 'data'
  ): Promise<void> => {
    setBusy(name)
    setNotice('')
    setNoticeRow(row)
    try {
      await action()
      await refreshStatus()
      setNotice(success)
    } catch (error) {
      setNotice(messageFor(error))
      try { await refreshStatus() } catch { /* keep the actionable error */ }
    } finally {
      setBusy('')
    }
  }

  const mappings = useMemo(
    () => new Map(githubConfig?.columnMappings.map((item) => [item.columnId, item.label]) ?? []),
    [githubConfig?.columnMappings]
  )

  if (!projectId || !project) {
    return (
      <SettingsSection id="github-issues" title="GitHub Issues" isActive={isActive} searchEntries={ENTRIES}>
        <GitHubCliAccountsPanel />
        <p className="text-sm text-muted"><SettingsText>Open a project to configure GitHub Issues.</SettingsText></p>
      </SettingsSection>
    )
  }

  if (project.remote) {
    return (
      <SettingsSection id="github-issues" title="GitHub Issues" isActive={isActive} searchEntries={ENTRIES}>
        <GitHubCliAccountsPanel />
        <p className="text-sm text-muted"><SettingsText>Configure GitHub Issues on the computer hosting this project.</SettingsText></p>
      </SettingsSection>
    )
  }

  if (!board) {
    return (
      <SettingsSection id="github-issues" title="GitHub Issues" isActive={isActive} searchEntries={ENTRIES}>
        <GitHubCliAccountsPanel />
        <p className="text-sm text-muted"><SettingsText>Create this project’s Kanban board before enabling GitHub Issues.</SettingsText></p>
      </SettingsSection>
    )
  }

  const enabled = !!githubConfig
  const repository = githubConfig?.repository ?? view?.project?.detectedRepository
  const approved = enabled && !!view?.project?.approved
  // The repository approval lets the board READ; writes also need this machine to have approved the
  // column mapping now in the (git-shared) project file. Only an explicit false withholds it.
  const mappingApproved = approved && view?.project?.mappingApproved !== false
  const authenticated = !!view?.auth.activeProvider
  const completionReady = !!githubConfig?.completionColumnId &&
    mappings.has(githubConfig.completionColumnId)
  const ready = approved && mappingApproved && authenticated && completionReady
  const approveRepository = (): Promise<void> => run('approve', async () => {
    const status = await window.nodeTerminal.githubControl.status(projectId)
    await window.nodeTerminal.githubControl.approve({
      projectId,
      repository: repository!,
      expectedRevision: status.control.revision
    })
  }, 'Repository approved on this machine.', 'repository')
  // What actually authenticates a request is `activeProvider` — the RESULT of the selected provider
  // meeting the credentials that exist. `ghAuthenticated` alone lies in both directions: pinned to
  // token-only it can be true while nothing authenticates, and pinned to gh-only a saved token is
  // inert however present it is.
  const activeProvider = auth?.activeProvider ?? null
  const selectedProvider = auth?.selectedProvider ?? view?.control.authProvider ?? 'auto'
  const ghActive = activeProvider === 'gh'
  // `authBlockFor` resolves the project-independent auth block before repository approval, so an
  // available block is enough to let the pure decision helper classify the credential state. This
  // preserves the neutral UNKNOWN branch when that extra read fails without throwing away useful
  // pre-approval credential evidence when it succeeds.
  const authView = describeGitHubAuth({
    approved: !!auth,
    provider: selectedProvider,
    activeProvider,
    tokenPresent: !!auth?.tokenPresent,
    ...(auth?.login ? { login: auth.login } : {})
  })
  /** The token control is noise wherever a token cannot be what signs the user in: the CLI already
   *  does it, or the user pinned authentication to the CLI. It moves into Advanced, never away. */
  const tokenIsAside = !tokenFieldIsPrimary(authView)
  // A control the user searched for must not be hidden behind a collapsed disclosure.
  const searching = searchQuery.trim() !== ''

  // The personal access token control, defined once and placed either prominently (when the GitHub
  // CLI is NOT signed in — it's the only way in) or tucked inside "Advanced" (when gh already works,
  // where a token is a rarely-needed override).
  const tokenFieldRow = (
    <FieldRow
      label="Personal access token"
      description="Use a fine-grained token with repository metadata read access and issues read and write access. The token is write only in this screen."
      note={view?.auth.storage === 'restricted-file'
        ? 'Encrypted key storage is unavailable. The token is protected in a mode 0600 local file.'
        : undefined}
      htmlFor="github-personal-access-token"
      control={
        <div className="flex items-center gap-2">
          <Input
            id="github-personal-access-token"
            type="password"
            autoComplete="off"
            className="w-56"
            value={token}
            placeholder={view?.auth.tokenPresent ? 'Token saved' : 'github_pat_…'}
            vocabularyMode="factual"
            onChange={(event) => setToken(event.target.value)}
          />
          <Button
            disabled={!token || busy !== ''}
            onClick={() => void run('token', async () => {
              await window.nodeTerminal.githubControl.saveToken(token)
              setToken('')
            }, 'Token saved securely.', 'authentication')}
          >
            Save token
          </Button>
          {view?.auth.tokenPresent && (
            <Button
              disabled={busy !== ''}
              onClick={() => void run('clear-token', async () => {
                await window.nodeTerminal.githubControl.clearToken()
                setToken('')
              }, 'Saved token cleared.', 'authentication')}
            >
              Clear
            </Button>
          )}
        </div>
      }
    />
  )

  const providerFieldRow = (
    <FieldRow
      label="Authentication"
      description="Auto prefers an authenticated GitHub CLI and otherwise uses the saved token."
      control={
        <Select
          id="github-auth-provider"
          value={view?.control.authProvider ?? 'auto'}
          disabled={!view || busy !== ''}
          onChange={(event) => void run('provider', async () => {
            const current = await window.nodeTerminal.githubControl.status(projectId)
            await window.nodeTerminal.githubControl.selectProvider({
              provider: event.target.value as GitHubAuthProvider,
              expectedRevision: current.control.revision
            })
          }, 'Authentication preference updated.', 'authentication')}
        >
          <option value="auto">Auto</option>
          <option value="gh">GitHub CLI only</option>
          <option value="token">Personal access token only</option>
        </Select>
      }
    />
  )

  return (
    <SettingsSection
      id="github-issues"
      title="GitHub Issues"
      description="Show this project’s GitHub issues alongside sessions and keep column movement in sync with exact issue labels."
      isActive={isActive}
      searchEntries={ENTRIES}
    >
      <GitHubCliAccountsPanel />
      <SearchableRow {...ROWS.enable}>
        <FieldRow
          label="Include GitHub issues"
          description="GitHub remains the source of truth. Issues are cached privately on this computer and are not copied into the project file."
          control={
            <Switch
              checked={enabled}
              ariaLabel="Include GitHub issues"
              onChange={(on) => updateConfig(on ? defaultGitHub(board.columns) : undefined)}
            />
          }
        />
      </SearchableRow>

      {enabled && (
        <>
          <SearchableRow {...ROWS.repository}>
            <div className="space-y-3">
              <FieldRow
                label="Repository"
                description={view?.project?.detectedRepository
                  ? `Detected from origin as ${view.project.detectedRepository}. Leave the override empty to use it.`
                  : 'Enter the GitHub repository as owner/repository.'}
                control={
                  <div className="flex items-center gap-2">
                    <Input
                      id="github-repository"
                      className="w-56"
                      value={repositoryDraft}
                      placeholder={view?.project?.detectedRepository ?? 'owner/repository'}
                      vocabularyMode="factual"
                      onChange={(event) => setRepositoryDraft(event.target.value)}
                    />
                    <Button
                      disabled={busy !== ''}
                      onClick={() => {
                        updateConfig({
                          ...githubConfig,
                          ...(repositoryDraft.trim() ? { repository: repositoryDraft.trim() } : {})
                        })
                        if (!repositoryDraft.trim()) {
                          const next = { ...githubConfig }
                          delete next.repository
                          updateConfig(next)
                        }
                        void refreshStatus()
                      }}
                    >
                      Apply
                    </Button>
                  </div>
                }
              />
              <div className="flex items-center gap-2 text-[13px]">
                <span className={`size-2 rounded-full ${ready ? 'bg-green-500' : 'bg-amber-500'}`} />
                <span className="text-muted">
                  {ready
                    ? `Ready as ${view?.auth.login ?? 'GitHub user'}`
                    : approved && !mappingApproved
                      ? text('github.settings.mappingChanged', 'The column labels changed since this machine approved them. Approve them to let the board change issues on GitHub.')
                      : view?.project?.approved
                        ? view.auth.unreachable && !authenticated
                          ? text('github.settings.approvedUnreachable', 'Repository approved. GitHub could not be reached to check the sign-in.')
                          : 'Repository approved. Authentication is still needed.'
                        : 'Approval is required before nodeterm reads the repository.'}
                </span>
                {!view?.project?.approved && repository && (
                  <Button variant="primary" disabled={busy !== ''} onClick={() => void approveRepository()}>
                    Approve this machine
                  </Button>
                )}
                {approved && !mappingApproved && repository && (
                  <Button variant="primary" disabled={busy !== ''} onClick={() => void approveRepository()}>
                    {text('github.settings.approveLabels', 'Approve column labels')}
                  </Button>
                )}
              </div>
              {notice && noticeRow === 'repository' &&
                <p role="status" className="text-[13px] text-muted">{notice}</p>}
            </div>
          </SearchableRow>

          <SearchableRow {...ROWS.authentication}>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {!auth ? (
                  // Unknown, not signed out — the status read has not landed (or could not run).
                  <p className="text-[13px] text-muted">
                    <SettingsText>GitHub authentication has not been checked yet.</SettingsText>
                  </p>
                ) : auth.unreachable && !activeProvider ? (
                  // GitHub never answered for this credential. Not signed out — every branch below
                  // would say it was.
                  <p className="text-[13px] text-muted">{syncText(githubUnreachableCopy(auth.unreachable))}</p>
                ) : ghActive ? (
                  // Happy path: the CLI already authenticates every request — no token, no dropdown.
                  <p className="text-[13px] text-text">
                    ✓ <SettingsText>Signed in via GitHub CLI</SettingsText>{auth.login ? ` as @${auth.login}` : ''}. <SettingsText>No token needed.</SettingsText>
                    {auth.tokenPresent ? <> <SettingsText>A saved token is kept as a fallback.</SettingsText></> : ''}
                  </p>
                ) : activeProvider === 'token' ? (
                  <p className="text-[13px] text-text">
                    ✓ <SettingsText>Signed in with the saved personal access token</SettingsText>{auth.login ? ` as @${auth.login}` : ''}.
                  </p>
                ) : selectedProvider === 'gh' ? (
                  <p className="text-[13px] text-muted">
                    <SettingsText>GitHub CLI is not signed in. Run</SettingsText>{' '}<code>gh auth login</code>{' '}<SettingsText>in a terminal.</SettingsText>
                  </p>
                ) : selectedProvider === 'token' ? (
                  <p className="text-[13px] text-muted">
                    <SettingsText>No valid personal access token is saved. Paste one below.</SettingsText>
                  </p>
                ) : (
                  <p className="text-[13px] text-muted">
                    <SettingsText>GitHub CLI is not signed in. Run</SettingsText>{' '}<code>gh auth login</code>{' '}<SettingsText>in a terminal, or paste a personal access token below.</SettingsText>
                  </p>
                )}
                {/* The hint above tells the user to run a command in a terminal, so it needs a way
                    back. The resolver's status read bypasses the credential cache, so this is
                    accurate the moment `gh auth login` finishes. */}
                <Button disabled={busy !== ''} onClick={() => void run(
                  'recheck',
                  async () => { /* the refresh inside run() is the whole action */ },
                  'Authentication re-checked.',
                  'authentication'
                )}>
                  Check again
                </Button>
              </div>

              {auth?.unreachable && activeProvider && (
                <p className="text-[13px] text-muted">
                  {syncText(githubUnreachableCopy(auth.unreachable))}{' '}
                  {text('github.settings.lastConfirmed', 'The sign-in above is the last one GitHub confirmed.')}
                </p>
              )}

              {/* A pinned provider decides which credential is even consulted, and the dropdown that
                  changes it now lives inside Advanced — so the pinning has to be said out loud. */}
              {selectedProvider !== 'auto' && (
                <p className="text-[13px] text-muted">
                  {selectedProvider === 'gh'
                    ? 'Authentication is pinned to the GitHub CLI, so a saved token is never used.'
                    : 'Authentication is pinned to a personal access token, so the GitHub CLI is never used'}
                  {selectedProvider === 'token' && auth?.ghAuthenticated
                    ? ' — it is signed in, but ignored.'
                    : selectedProvider === 'token' ? '.' : ''}
                  {' '}Change this under Advanced.
                </p>
              )}

              {/* Token is a way in only where it can authenticate; otherwise it is tucked away. */}
              {!tokenIsAside && tokenFieldRow}

              <details className="github-auth-advanced" open={searching || undefined}>
                <summary>
                  {tokenIsAside
                    ? 'Advanced — authentication provider and personal access token'
                    : 'Advanced — authentication provider'}
                </summary>
                <div className="mt-3 space-y-4">
                  {providerFieldRow}
                  {tokenIsAside && tokenFieldRow}
                </div>
              </details>

              {notice && noticeRow === 'authentication' &&
                <p role="status" className="text-[13px] text-muted">{notice}</p>}
            </div>
          </SearchableRow>

          <SearchableRow {...ROWS.mapping}>
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-text"><SettingsText>Column labels</SettingsText></h3>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">
                  Each issue must have exactly one of these labels. Matching is case insensitive and labels are written with the exact spelling below.
                </p>
              </div>
              {board.columns.map((column) => (
                <FieldRow
                  key={column.id}
                  label={column.title}
                  htmlFor={`github-label-${column.id}`}
                  control={
                    <Input
                      id={`github-label-${column.id}`}
                      className="w-56"
                      value={mappings.get(column.id) ?? ''}
                      maxLength={50}
                      placeholder={`status:${column.title.toLocaleLowerCase('en-US')}`}
                      vocabularyMode="factual"
                      onChange={(event) => {
                        const label = event.target.value
                        const next = githubConfig.columnMappings
                          .filter((item) => item.columnId !== column.id)
                        if (label) next.push({ columnId: column.id, label })
                        updateConfig({
                          ...githubConfig,
                          columnMappings: board.columns.flatMap((item) =>
                            next.filter((mapping) => mapping.columnId === item.id)),
                          ...(label || githubConfig.completionColumnId !== column.id
                            ? {}
                            : { completionColumnId: undefined })
                        })
                      }}
                    />
                  }
                />
              ))}
              <FieldRow
                label="Completion column"
                description="Moving an issue here closes it. Moving a closed issue elsewhere reopens it."
                control={
                  <Select
                    id="github-completion-column"
                    value={githubConfig.completionColumnId ?? ''}
                    onChange={(event) => updateConfig({
                      ...githubConfig,
                      completionColumnId: event.target.value || undefined
                    })}
                  >
                    <option value="" disabled>Choose a mapped column</option>
                    {board.columns.filter((column) => mappings.has(column.id)).map((column) => (
                      <option key={column.id} value={column.id}>{column.title}</option>
                    ))}
                  </Select>
                }
              />
            </div>
          </SearchableRow>

          <SearchableRow {...ROWS.data}>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button disabled={!ready || busy !== ''} onClick={() => setConfirmation('labels')}>
                  Create missing labels
                </Button>
                <Button disabled={!approved || !authenticated || busy !== ''} onClick={() => void run('refresh',
                  () => window.nodeTerminal.githubIssues.refresh(projectId, true),
                  'GitHub issues refreshed.')}>
                  Refresh now
                </Button>
                <Button disabled={!enabled || !repository || busy !== ''} onClick={() => setConfirmation('cache')}>
                  Clear cached data
                </Button>
                {view?.project?.approved && (
                  <Button disabled={busy !== ''} onClick={() => setConfirmation('revoke')}>
                    Revoke this machine
                  </Button>
                )}
              </div>
              {approved && !completionReady && (
                <p className="text-[13px] text-warn" role="status">
                  Choose a mapped completion column before GitHub issue changes are enabled.
                </p>
              )}
              {view?.throttle && (
                <p className="text-[13px] text-warn" role="status">
                  {syncText(githubThrottleCopy(view.throttle)!)}
                </p>
              )}
              {view?.rate && (
                <p className="text-[13px] text-muted">{syncText(githubRateCopy(view.rate))}</p>
              )}
              {notice && noticeRow === 'data' &&
                <p role="status" className="text-[13px] text-muted">{notice}</p>}
            </div>
          </SearchableRow>
        </>
      )}

      {confirmation === 'labels' && (
        <ConfirmDialog
          message="Create any mapped labels that do not yet exist in this repository?"
          confirmLabel="Create labels"
          danger={false}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            setConfirmation(null)
            void run('labels', async () => {
              const result = await window.nodeTerminal.githubIssues.createMissingLabels(projectId)
              if (result.status !== 'confirmed') throw new Error('configuration-changed')
            }, 'Mapped labels are ready.')
          }}
        />
      )}
      {confirmation === 'cache' && (
        <ConfirmDialog
          message="Clear the private GitHub issue cache for this repository? It will be rebuilt on the next refresh."
          confirmLabel="Clear cache"
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            setConfirmation(null)
            void run('cache', () => window.nodeTerminal.githubIssues.clearCache(projectId), 'Cached data cleared.')
          }}
        />
      )}
      {confirmation === 'revoke' && (
        <ConfirmDialog
          message="Stop this computer from reading or changing issues for this project? Its cached copy of the issues is deleted too."
          confirmLabel="Revoke"
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            setConfirmation(null)
            void run('revoke', async () => {
              const current = await window.nodeTerminal.githubControl.status(projectId)
              await window.nodeTerminal.githubControl.revoke({
                projectId,
                expectedRevision: current.control.revision
              })
            }, 'This machine has been revoked.')
          }}
        />
      )}
    </SettingsSection>
  )
}
