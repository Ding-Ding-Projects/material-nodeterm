import { useState } from 'react'
import type { GitHubWorkItem } from '@shared/github-work-items'
import {
  GITHUB_WORK_ITEM_CHIP_MAX,
  githubWorkItemDisplayState,
  workItemAttachedToNode,
  workItemVisibleOnFrame
} from '@shared/github-work-items'
import { GitHubWorkItemDetailDialog } from './GitHubWorkItemDetailDialog'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { copy, fact, mapOwnedSentence } from '../lib/personalVocabulary/ownedCopy'
import { Chip } from '../ui/md3/Chip'
export interface GitHubWorkItemAttachmentProps {
  items?: readonly GitHubWorkItem[]
  nodeId?: string
  frameId?: string
  frameBranch?: string
}

const STATE_LABELS: Record<ReturnType<typeof githubWorkItemDisplayState>, string> = {
  running: 'RUNNING',
  'needs-you': 'NEEDS YOU',
  passed: 'PASSED',
  failed: 'FAILED',
  unknown: 'UNKNOWN'
}

function visibleItems({ items = [], nodeId, frameId, frameBranch }: GitHubWorkItemAttachmentProps): GitHubWorkItem[] {
  return items
    .filter((item) => {
      if (nodeId) return workItemAttachedToNode(item, nodeId)
      if (frameId) return workItemVisibleOnFrame(item, frameId, frameBranch)
      return false
    })
    .slice(0, GITHUB_WORK_ITEM_CHIP_MAX)
}

/** Compact, shared rendering for the node chip and its owning frame pill. */
export function GitHubWorkItemAttachment(props: GitHubWorkItemAttachmentProps) {
  const vocab = useVocabularyMapper()
  const [detail, setDetail] = useState<GitHubWorkItem | null>(null)
  const items = visibleItems(props)
  if (items.length === 0) return null
  const frame = !!props.frameId && !props.nodeId
  return (
    <>
      <div
        className={frame ? 'github-work-item-pill' : 'github-work-item-chip'}
        role="list"
        aria-label={vocab(frame ? 'Pull requests and issues attached to this frame' : 'Pull requests and issues attached to this session')}
      >
        {items.map((item) => {
        const displayState = githubWorkItemDisplayState(item)
        const kind = item.kind === 'pull-request' ? 'PR' : 'Issue'
        const title = item.title.trim() || `${kind} #${item.number}`
        const shortTitle = title.length > 96 ? `${title.slice(0, 93)}…` : title
        return (
          <Chip
            key={`${item.repository}#${item.number}`}
            className={`github-work-item-chip__item github-work-item-chip__item--${displayState}`}
            vocabularyMode="factual"
            role="listitem"
            title={mapOwnedSentence(vocab, [fact(item.repository), copy(' #'), fact(String(item.number)), copy(': '), fact(title)])}
            aria-label={mapOwnedSentence(vocab, [
              copy(kind),
              copy(' '),
              fact(item.repository),
              copy(' #'),
              fact(String(item.number)),
              copy(', '),
              fact(shortTitle),
              copy(', '),
              copy(STATE_LABELS[displayState]),
              copy('. Open in-app review details.')
            ])}
            onClick={() => setDetail(item)}
          >
            <span className="github-work-item-chip__kind" aria-hidden="true">{vocab(kind)}</span>
            <span className="github-work-item-chip__number">#{item.number}</span>
            <span className="github-work-item-chip__title">{shortTitle}</span>
            <span className="github-work-item-chip__state">{vocab(STATE_LABELS[displayState])}</span>
          </Chip>
        )
        })}
      </div>
      {detail && <GitHubWorkItemDetailDialog item={detail} nodeId={props.nodeId} frameId={props.frameId} onClose={() => setDetail(null)} />}
    </>
  )
}
