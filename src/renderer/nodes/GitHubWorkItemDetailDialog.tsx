import type { GitHubWorkItem } from '@shared/github-work-items'
import { githubWorkItemDisplayState } from '@shared/github-work-items'
import { Dialog } from '../ui/md3/Dialog'
import { renderMarkdown } from '../lib/markdown'
export interface GitHubWorkItemDetailDialogProps {
  item: GitHubWorkItem
  nodeId?: string
  frameId?: string
  onClose: () => void
}

/** In-app provider-authored detail and review surface for a compact work-item attachment. */
export function GitHubWorkItemDetailDialog({ item, nodeId, frameId, onClose }: GitHubWorkItemDetailDialogProps): React.JSX.Element {
  const kind = item.kind === 'pull-request' ? 'Pull request' : 'Issue'
  const displayState = githubWorkItemDisplayState(item)
  const html = item.bodyMarkdown ? renderMarkdown(item.bodyMarkdown) : ''
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${kind} ${item.repository} #${item.number}`}
      className="github-work-item-detail-dialog"
      actions={(
        <>
          <button type="button" onClick={onClose}>Close</button>
          {item.htmlUrl && <a className="github-work-item-detail-dialog__external" href={item.htmlUrl} target="_blank" rel="noreferrer">Open on GitHub</a>}
        </>
      )}
    >
      <div className={`github-work-item-detail-dialog__state github-work-item-detail-dialog__state--${displayState}`} role="status">
        <strong>{displayState === 'needs-you' ? 'NEEDS YOU' : displayState.toUpperCase()}</strong>
        <span>{item.reviewState ?? 'Review state not reported'} · {item.checksState ?? 'Checks not reported'}</span>
      </div>
      <h3>{item.title}</h3>
      <p className="github-work-item-detail-dialog__context">
        Attached session node: {nodeId ?? 'not recorded'} · Owning frame: {frameId ?? 'not recorded'}
      </p>
      {item.headRef && <p className="github-work-item-detail-dialog__context">Provider head ref: {item.headRef}</p>}
      {item.labels.length > 0 && <p className="github-work-item-detail-dialog__labels">Labels: {item.labels.map((label) => label.name).join(', ')}</p>}
      {html ? <div className="github-work-item-detail-dialog__body" aria-label="Provider-authored work-item description" dangerouslySetInnerHTML={{ __html: html }} /> : <p>No provider-authored description was supplied.</p>}
    </Dialog>
  )
}
