import { NodeResizer, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import { GITHUB_WORK_ITEM_NODE_SIZE, type GitHubWorkItem } from '@shared/github-work-items'
import { renderMarkdown } from '../lib/markdown'
export default function GitHubWorkItemNode({ data, selected }: NodeProps<CanvasNode>) {
  const item = data.githubWorkItem as GitHubWorkItem
  const kind = item.kind === 'pull-request' ? 'Pull request' : 'Issue'
  const html = item.bodyMarkdown ? renderMarkdown(item.bodyMarkdown) : ''
  return <div className={`github-work-item-node${selected ? ' selected' : ''}`} role="article" aria-label={`${kind} ${item.repository || 'repository'} #${item.number}`}>
    <NodeResizer isVisible={selected} minWidth={GITHUB_WORK_ITEM_NODE_SIZE.width} minHeight={300} />
    <header className="github-work-item-node__header"><span>{kind}</span><strong>{item.repository || 'Choose a repository'}</strong><span>#{item.number}</span><span>{item.state}</span></header>
    <main className="github-work-item-node__body"><h3>{item.title || 'Choose an issue or pull request'}</h3>
      {item.author && <p>Author: {item.author.login}</p>}<p>Labels: {item.labels.length ? item.labels.map((label) => label.name).join(', ') : 'none reported'}</p>
      <p>Reviews: {item.reviewState ?? 'not reported'} · Checks: {item.checksState ?? 'not reported'}</p>{item.updatedAt && <p>Updated: {item.updatedAt}</p>}
      {html ? <div aria-label="Work item description" dangerouslySetInnerHTML={{ __html: html }} /> : <p>No description provided.</p>}
      {(item.refreshState === 'offline' || item.refreshState === 'forbidden') && <p role="status">GitHub is unavailable here. The last safe snapshot remains visible.</p>}
    </main><footer>{item.refreshState}{item.lastRefreshAt ? ` · refreshed ${item.lastRefreshAt}` : ''}</footer>
  </div>
}
