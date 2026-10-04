import type {
  GitHubPullStatus,
  PullCiState,
  PullMergeState,
  PullStatusFreshness
} from '@shared/github-pull-status'
import { githubClock } from '../../lib/githubSyncStatus'
import { useLocalizedVocabularyText } from '../../lib/personalVocabulary/useLocalizedVocabularyText'

// ONE vocabulary for a pull request's state on every surface that shows it — the PR card, an issue
// card's "PR #M" chip, and the summary modal. Two rules live here and nowhere else:
//  - CI renders only for a real result. `none` (GitHub reports no checks) and an ABSENT ci (the
//    token may not read checks, or the only result is for another commit) both render NOTHING:
//    no tick is ever drawn for checks that do not exist or cannot be seen.
//  - "Ready to merge" renders only for `ready`, which only `mergeStateStatus === CLEAN` produces.
// Every visible word goes through the localized catalogue (`github.pull.*`); the English below is
// the fallback and what the pure helpers return for non-React callers.

const CI_LABEL: Record<Exclude<PullCiState, 'none'>, { text: string; glyph: string; id: string }> = {
  passed: { text: 'Checks passed', glyph: '✓', id: 'github.pull.ci.passed' },
  failed: { text: 'Checks failing', glyph: '✗', id: 'github.pull.ci.failed' },
  pending: { text: 'Checks running', glyph: '●', id: 'github.pull.ci.pending' }
}

/** Merge states worth a word. `unstable` is said by the CI badge already, and `hooks` is neither a
 *  problem nor "ready" — both render nothing rather than a label that means little. */
const MERGE_LABEL: Partial<Record<PullMergeState, { text: string; id: string }>> = {
  ready: { text: 'Ready to merge', id: 'github.pull.merge.ready' },
  conflict: { text: 'Conflicts', id: 'github.pull.merge.conflict' },
  blocked: { text: 'Blocked', id: 'github.pull.merge.blocked' },
  behind: { text: 'Behind base', id: 'github.pull.merge.behind' },
  undecided: { text: 'Checking mergeability…', id: 'github.pull.merge.undecided' }
}

const LIFECYCLE_WORD = {
  draft: { text: 'draft', id: 'github.pull.word.draft' },
  merged: { text: 'merged', id: 'github.pull.word.merged' },
  closed: { text: 'closed', id: 'github.pull.word.closed' }
} as const

type Text = (id: string, fallback: string, params?: Record<string, string>) => string

export function ciLabel(ci: PullCiState | undefined): { text: string; glyph: string } | null {
  return ci && ci !== 'none' ? CI_LABEL[ci] : null
}

export function mergeLabel(merge: PullMergeState | undefined): string | null {
  return merge ? MERGE_LABEL[merge]?.text ?? null : null
}

function staleTitle(text: Text, freshness: PullStatusFreshness, observedAt: number | undefined): string | undefined {
  if (freshness === 'fresh') return undefined
  return observedAt === undefined
    ? text('github.pull.staleUnreached', 'GitHub could not be reached to check this pull request.')
    : text('github.pull.staleSince', 'Last checked at {time}. GitHub could not be reached since.', {
      time: githubClock(observedAt)
    })
}

/** The CI + merge line of an open PR, for the PR card and the PR modal. */
export function PullStatusLine({
  status,
  freshness,
  observedAt
}: {
  status: GitHubPullStatus | undefined
  freshness: PullStatusFreshness
  observedAt?: number
}): React.JSX.Element | null {
  const text = useLocalizedVocabularyText()
  if (!status) return null
  const ci = status.ci && status.ci !== 'none' ? CI_LABEL[status.ci] : null
  const merge = status.merge ? MERGE_LABEL[status.merge] : undefined
  if (!ci && !merge) return null
  return (
    <div
      className={`pull-status pull-status--${freshness}`}
      title={staleTitle(text, freshness, observedAt)}
      data-testid="pull-status"
    >
      {ci && (
        <span className={`pull-status__ci pull-status__ci--${status.ci}`}>
          <span aria-hidden="true">{ci.glyph}</span> {text(ci.id, ci.text)}
        </span>
      )}
      {merge && (
        <span className={`pull-status__merge pull-status__merge--${status.merge}`}>{text(merge.id, merge.text)}</span>
      )}
      {freshness !== 'fresh' && <span className="pull-status__stale">{text('github.pull.stale', 'stale')}</span>}
    </div>
  )
}

/** "PR #12 ✓ Ready" — the compact form an issue card carries. */
export function PullRefChip({
  status,
  freshness
}: {
  status: GitHubPullStatus
  freshness: PullStatusFreshness
}): React.JSX.Element {
  const text = useLocalizedVocabularyText()
  const open = status.lifecycle === 'open' || status.lifecycle === 'draft'
  const ci = open && status.ci && status.ci !== 'none' ? CI_LABEL[status.ci] : null
  const merge = open && status.lifecycle === 'open' && status.merge ? MERGE_LABEL[status.merge] : undefined
  const word = status.lifecycle === 'open' ? null : LIFECYCLE_WORD[status.lifecycle]
  const ref = `PR #${status.number}`
  const parts = [
    ref,
    word && text(word.id, word.text),
    ci && text(ci.id, ci.text),
    merge && text(merge.id, merge.text)
  ].filter(Boolean)
  return (
    <span
      className={`pull-ref pull-ref--${status.lifecycle}${open ? ` pull-status--${freshness}` : ''}`}
      title={[parts.join(' · '), open ? staleTitle(text, freshness, undefined) : undefined].filter(Boolean).join('\n')}
    >
      {ref}
      {word && <span className="pull-ref__word"> {text(word.id, word.text)}</span>}
      {ci && <span className={`pull-ref__ci pull-status__ci--${status.ci}`} aria-label={text(ci.id, ci.text)}> {ci.glyph}</span>}
      {merge && status.merge === 'ready' && <span className="pull-ref__ready"> {text('github.pull.ref.ready', 'ready')}</span>}
      {merge && status.merge === 'conflict' && <span className="pull-ref__conflict"> {text('github.pull.ref.conflicts', 'conflicts')}</span>}
    </span>
  )
}
