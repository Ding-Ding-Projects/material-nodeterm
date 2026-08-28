import { NodeResizer, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import { GITHUB_WORK_ITEM_NODE_SIZE, type GitHubWorkItem } from '@shared/github-work-items'
import { renderMarkdown } from '../lib/markdown'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { copy, fact, mapOwnedSentence } from '../lib/personalVocabulary/ownedCopy'
export default function GitHubWorkItemNode({ data, selected }: NodeProps<CanvasNode>) {
  const vocab = useVocabularyMapper()
  const item = data.githubWorkItem as GitHubWorkItem
  // A legacy detail node is retained in project data during explicit conversion, but once the
  // exact attachment identity is recorded it must not remain as a second indicator elsewhere.
  if (item.attachedNodeId) return null
  const kind = item.kind === 'pull-request' ? 'Pull request' : 'Issue'
  const html = item.bodyMarkdown ? renderMarkdown(item.bodyMarkdown) : ''
  const ariaLabel = mapOwnedSentence(vocab, [
    copy(kind),
    copy(' '),
    item.repository ? fact(item.repository) : copy('repository'),
    copy(' #'),
    fact(String(item.number))
  ])
  return <div className={`github-work-item-node${selected ? ' selected' : ''}`} role="article" aria-label={ariaLabel}>
    <NodeResizer isVisible={selected} minWidth={GITHUB_WORK_ITEM_NODE_SIZE.width} minHeight={300} />
    <header className="github-work-item-node__header">
      <span>{vocab(kind)}</span>
      <strong>{item.repository ? item.repository : vocab('Choose a repository')}</strong>
      <span>#{item.number}</span>
      <span>{item.state}</span>
    </header>
    <main className="github-work-item-node__body">
      <h3>{item.title || vocab('Choose an issue or pull request')}</h3>
      {item.author && <p>{mapOwnedSentence(vocab, [copy('Author: '), fact(item.author.login)])}</p>}
      <p>{item.labels.length
        ? mapOwnedSentence(vocab, [copy('Labels: '), fact(item.labels.map((label) => label.name).join(', '))])
        : vocab('Labels: none reported')}</p>
      <p>{mapOwnedSentence(vocab, [
        copy('Reviews: '),
        item.reviewState ? fact(item.reviewState) : copy('not reported'),
        copy(' · Checks: '),
        item.checksState ? fact(item.checksState) : copy('not reported')
      ])}</p>
      {item.updatedAt && <p>{mapOwnedSentence(vocab, [copy('Updated: '), fact(item.updatedAt)])}</p>}
      {html
        ? <div aria-label={vocab('Work item description')} dangerouslySetInnerHTML={{ __html: html }} />
        : <p>{vocab('No description provided.')}</p>}
      {(item.refreshState === 'offline' || item.refreshState === 'forbidden') && (
        <p role="status">{mapOwnedSentence(vocab, [fact('GitHub'), copy(' is unavailable here. The last safe snapshot remains visible.')])}</p>
      )}
    </main>
    <footer>{item.refreshState}{item.lastRefreshAt ? mapOwnedSentence(vocab, [copy(' · refreshed '), fact(item.lastRefreshAt)]) : ''}</footer>
  </div>
}
