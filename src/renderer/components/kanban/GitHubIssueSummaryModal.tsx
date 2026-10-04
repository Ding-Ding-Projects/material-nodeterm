import { useEffect, useRef, useState } from 'react'
import { IconButton, Button as Md3Button } from '@renderer/ui/md3'
import type { GitHubIssueCardView } from '@shared/github-issues'
import type {
  GitHubPullChecksResult,
  GitHubPullStatus,
  PullStatusFreshness
} from '@shared/github-pull-status'
import type { KanbanColumn } from '@shared/types'
import { useSession } from '../../session/session'
import { Button } from '@renderer/ui/Button'
import { Select } from '@renderer/ui/Select'
import { openDialogCount } from '../dialog-stack'
import { useLocalizedVocabularyText } from '../../lib/personalVocabulary/useLocalizedVocabularyText'
import { PullRefChip, PullStatusLine } from './PullStatusBadges'

export function GitHubIssueSummaryModal({
  issue,
  columns,
  moving,
  readOnly,
  status,
  kind = 'issue',
  onMove,
  onClose,
  projectId,
  pullStatus,
  closingPulls = [],
  pullFreshness = 'fresh',
  pullObservedAt
}: {
  issue: GitHubIssueCardView
  columns: KanbanColumn[]
  moving: boolean
  readOnly: boolean
  status?: string
  /** A pull request is read-only on the board, so its variant drops the Move control and the
   *  conflict hint — both name a write only an issue has. */
  kind?: 'issue' | 'pull'
  onMove: (columnId: string | null) => void
  onClose: () => void
  /** Needed to fetch a PR's check detail; absent = no detail section. */
  projectId?: string
  /** Pull kind: the PR's CI/merge state. Issue kind: unused. */
  pullStatus?: GitHubPullStatus
  /** Issue kind: open PRs that close this issue on merge. */
  closingPulls?: GitHubPullStatus[]
  pullFreshness?: PullStatusFreshness
  pullObservedAt?: number
}): React.JSX.Element {
  const isPull = kind === 'pull'
  const { api } = useSession()
  const text = useLocalizedVocabularyText()
  const pullOpen = isPull && issue.state === 'open'
  const checks = usePullChecks(api.githubIssues, pullOpen ? projectId : undefined, issue.number,
    pullStatus?.headRefOid)
  const close = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  useEffect(() => {
    close.current?.focus()
    return () => opener.current?.focus()
  }, [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      // A dialog stacked over this modal (the close/reopen confirm) owns its own Escape: closing the
      // modal underneath it too took two answers for one key.
      if (event.key === 'Escape' && openDialogCount() === 0) onClose()
      if (event.key === 'Tab' && dialog.current) {
        const focusable = [...dialog.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )]
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  const closes = pullStatus?.closes.map((number) => `#${number}`).join(', ') ?? ''
  return (
    <div className="kanban-modal-scrim" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialog}
        className="github-issue-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="github-issue-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="github-issue-modal__header">
          <div>
            <div className="github-issue-modal__eyebrow">
              {isPull
                ? text('github.modal.pullEyebrow', 'GitHub pull request #{number}', { number: String(issue.number) })
                : `GitHub issue #${issue.number}`}
            </div>
            <h2 id="github-issue-modal-title">{issue.title}</h2>
          </div>
          <IconButton size="dense" ref={close} className="github-issue-modal__close" onClick={onClose} aria-label="Close">×</IconButton>
        </header>
        <div className="github-issue-modal__actions">
          {!isPull && (
            <label>
              <span>Move to</span>
              <Select
                aria-label={`Move issue #${issue.number}`}
                value={issue.columnId ?? ''}
                disabled={moving || readOnly}
                onChange={(event) => onMove(event.target.value || null)}
              >
                <option value="">Ungrouped</option>
                {columns.map((column) => <option key={column.id} value={column.id}>{column.title}</option>)}
              </Select>
            </label>
          )}
          <Button onClick={() => void api.shell.openExternal(issue.htmlUrl)}>Open on GitHub</Button>
        </div>
        {!isPull && issue.conflict && (
          <p className="github-issue-modal__warning">
            This issue has conflicting mapped labels. Choose a column to replace them with one exact label.
          </p>
        )}
        {status && <p className="github-issue-modal__warning" role="status">{status}</p>}
        {isPull && pullOpen && (
          <PullStatusLine status={pullStatus} freshness={pullFreshness} observedAt={pullObservedAt} />
        )}
        {isPull && closes && (
          <p className="pull-closes">{text('github.pull.closes', 'Closes {issues}', { issues: closes })}</p>
        )}
        {!isPull && closingPulls.length > 0 && (
          <div className="pull-refs">
            {closingPulls.map((pull) => <PullRefChip key={pull.number} status={pull} freshness={pullFreshness} />)}
          </div>
        )}
        {isPull && pullOpen && (
          <PullChecks
            result={checks}
            expectedHead={pullStatus?.headRefOid}
            onOpen={(url) => void api.shell.openExternal(url)}
          />
        )}
        <div className="github-issue-modal__body">
          {issue.body.trim() || 'No description provided.'}
        </div>
      </section>
    </div>
  )
}

/** Per-check detail for an open PR, read once when its modal opens (and again if its head moves). */
function usePullChecks(
  api: { pullChecks: (projectId: string, pullNumber: number) => Promise<GitHubPullChecksResult> },
  projectId: string | undefined,
  pullNumber: number,
  headRefOid: string | undefined
): GitHubPullChecksResult | 'loading' | null {
  const [result, setResult] = useState<GitHubPullChecksResult | 'loading' | null>(null)
  useEffect(() => {
    if (!projectId) {
      setResult(null)
      return
    }
    let live = true
    setResult('loading')
    api.pullChecks(projectId, pullNumber)
      .then((value) => { if (live) setResult(value) })
      .catch(() => { if (live) setResult({ status: 'unavailable' }) })
    return () => { live = false }
  }, [api, projectId, pullNumber, headRefOid])
  return result
}

const CHECK_GLYPH = { passed: '✓', failed: '✗', pending: '●', skipped: '–', neutral: '○' } as const

const CHECK_STATE_TEXT = {
  passed: ['github.checks.state.passed', 'passed'],
  failed: ['github.checks.state.failed', 'failed'],
  pending: ['github.checks.state.pending', 'pending'],
  skipped: ['github.checks.state.skipped', 'skipped'],
  neutral: ['github.checks.state.neutral', 'neutral']
} as const

/** The checks list. A token that may not read checks (`hidden`) shows NOTHING, and a commit with no
 *  checks says so in words — never a green tick for checks that do not exist. Check names are
 *  GitHub's facts and render verbatim; only the surrounding prose is localized. */
export function PullChecks({
  result,
  expectedHead,
  onOpen
}: {
  result: GitHubPullChecksResult | 'loading' | null
  /** The head the status line above describes. Checks read at another commit are not shown under
   *  it (the host may answer from a read taken a few seconds before a push). */
  expectedHead?: string
  onOpen: (url: string) => void
}): React.JSX.Element | null {
  const text = useLocalizedVocabularyText()
  if (result === null || (result !== 'loading' && result.status === 'hidden')) return null
  if (result === 'loading') {
    return <p className="pull-checks__note">{text('github.checks.loading', 'Loading checks…')}</p>
  }
  if (result.status === 'no-checks') {
    return <p className="pull-checks__note">{text('github.checks.none', 'No checks on the head commit.')}</p>
  }
  if (result.status === 'moved' || (result.status === 'ok' && expectedHead && result.headRefOid !== expectedHead)) {
    return (
      <p className="pull-checks__note">
        {text('github.checks.moved', 'The branch moved while reading its checks. Reopen to see the new commit\'s.')}
      </p>
    )
  }
  if (result.status === 'unavailable') {
    return <p className="pull-checks__note">{text('github.checks.unavailable', 'Checks could not be read from GitHub.')}</p>
  }
  return (
    <ul className="pull-checks" aria-label={text('github.checks.label', 'Checks')}>
      {result.checks.map((check, index) => {
        const [id, fallback] = CHECK_STATE_TEXT[check.state]
        return (
          <li key={`${check.name}:${index}`} className={`pull-checks__row pull-checks__row--${check.state}`}>
            <span className={`pull-status__ci--${check.state}`} aria-hidden="true">{CHECK_GLYPH[check.state]}</span>
            {check.url
              ? (
                <Md3Button
                  variant="text"
                  size="small"
                  vocabularyMode="factual"
                  className="pull-checks__name"
                  onClick={() => onOpen(check.url!)}
                >
                  {check.name}
                </Md3Button>
              )
              : <span className="pull-checks__name">{check.name}</span>}
            <span className="pull-checks__state">{text(id, fallback)}</span>
          </li>
        )
      })}
      {result.truncated && <li className="pull-checks__note">{text('github.checks.more', 'More checks on GitHub.')}</li>}
    </ul>
  )
}
