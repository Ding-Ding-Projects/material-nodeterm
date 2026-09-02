import type { GitHubWorkItem } from '@shared/github-work-items'
import { githubWorkItemDisplayState } from '@shared/github-work-items'
import { Dialog } from '../ui/md3/Dialog'
import { renderMarkdown } from '../lib/markdown'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { copy, fact, mapOwnedSentence } from '../lib/personalVocabulary/ownedCopy'
import { Button } from '../ui/md3/Button'
export interface GitHubWorkItemDetailDialogProps {
  item: GitHubWorkItem
  nodeId?: string
  frameId?: string
  onClose: () => void
}

/** In-app provider-authored detail and review surface for a compact work-item attachment. */
export function GitHubWorkItemDetailDialog({ item, nodeId, frameId, onClose }: GitHubWorkItemDetailDialogProps): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const kind = item.kind === 'pull-request' ? 'Pull request' : 'Issue'
  const displayState = githubWorkItemDisplayState(item)
  const html = item.bodyMarkdown ? renderMarkdown(item.bodyMarkdown) : ''
  const title = mapOwnedSentence(vocab, [copy(kind), copy(' '), fact(item.repository), copy(' #'), fact(String(item.number))])
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      vocabularyMode="factual"
      className="github-work-item-detail-dialog"
      actions={(
        <>
          <Button variant="text" onClick={onClose}>Close</Button>
          {item.htmlUrl && <a className="github-work-item-detail-dialog__external" href={item.htmlUrl} target="_blank" rel="noreferrer">{vocab('Open on GitHub')}</a>}
        </>
      )}
    >
      <div className={`github-work-item-detail-dialog__state github-work-item-detail-dialog__state--${displayState}`} role="status">
        <strong>{vocab(displayState === 'needs-you' ? 'NEEDS YOU' : displayState.toUpperCase())}</strong>
        <span>{mapOwnedSentence(vocab, [
          item.reviewState ? fact(item.reviewState) : copy('Review state not reported'),
          copy(' · '),
          item.checksState ? fact(item.checksState) : copy('Checks not reported')
        ])}</span>
      </div>
      <h3>{item.title}</h3>
      <p className="github-work-item-detail-dialog__context">
        {mapOwnedSentence(vocab, [copy('Attached session node: '), fact(nodeId ?? 'not recorded'), copy(' · Owning frame: '), fact(frameId ?? 'not recorded')])}
      </p>
      {item.headRef && <p className="github-work-item-detail-dialog__context">{mapOwnedSentence(vocab, [copy('Provider head ref: '), fact(item.headRef)])}</p>}
      {item.labels.length > 0 && <p className="github-work-item-detail-dialog__labels">{mapOwnedSentence(vocab, [copy('Labels: '), fact(item.labels.map((label) => label.name).join(', '))])}</p>}
      {html
        ? <div className="github-work-item-detail-dialog__body" aria-label={vocab('Provider-authored work-item description')} dangerouslySetInnerHTML={{ __html: html }} />
        : <p>{vocab('No provider-authored description was supplied.')}</p>}
    </Dialog>
  )
}
