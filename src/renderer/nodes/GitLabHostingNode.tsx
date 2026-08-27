import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import { DEFAULT_GITLAB_HOSTING_CONFIG, type GitLabHostingConfig } from '@shared/gitlab-hosting'
import type { CanvasNode } from '../state/workspace'
import { COLLAPSED_HEIGHT } from '../state/workspace'
import { GitLabHostingPanel } from '../components/gitlab/GitLabHostingPanel'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import { nodeBorderStyle, nodeColorStyle } from '../lib/nodeColor'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'

/** Canvas node for a private-first, guided GitLab Server deployment. */
export default function GitLabHostingNode({ id, data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const { updateNodeData, setNodes } = useReactFlow()
  const vocab = useVocabularyMapper()
  const collapsed = !!data.collapsed
  const config: GitLabHostingConfig = data.gitlabHostingConfig && data.gitlabHostingConfig.schemaVersion === 1
    ? data.gitlabHostingConfig
    : { ...DEFAULT_GITLAB_HOSTING_CONFIG }
  const border = nodeBorderStyle(data.color)
  const header = nodeColorStyle(data.color, 0.2)

  const toggleCollapse = (): void => {
    setNodes((nodes) => nodes.map((node) => {
      if (node.id !== id) return node
      const expandedHeight = (node.data.expandedHeight as number | undefined) ?? node.measured?.height ?? node.height ?? 620
      const height = collapsed ? expandedHeight : COLLAPSED_HEIGHT
      return { ...node, height, style: { ...node.style, height }, data: { ...node.data, collapsed: !collapsed, expandedHeight } }
    }))
  }

  return (
    <div className={`gitlab-hosting-node${selected ? ' selected' : ''}${collapsed ? ' collapsed' : ''} ${border.className}`} style={border.style} role="group" aria-label={data.serviceLabel ? `GitLab hosting: ${data.serviceLabel}` : 'GitLab hosting'}>
      <NodeResizer minWidth={560} minHeight={360} isVisible={selected && !collapsed} color={data.color} />
      <div className={`gitlab-hosting-node__header ${header.className}`} style={header.style}>
        <button type="button" className="term-node__collapse" title={vocab(collapsed ? 'Expand' : 'Collapse')} onClick={toggleCollapse}>{collapsed ? '▸' : '▾'}</button>
        <span className="gitlab-hosting-node__product">GitLab hosting</span>
        <EditableNodeTitle value={data.serviceLabel ?? ''} onChange={(next) => updateNodeData(id, { serviceLabel: next })} ariaLabel="Name for this GitLab hosting node" title={vocab('Rename')} baseTriggerClassName="" triggerClassName="gitlab-hosting-node__label" emptyLabel={<span className="gitlab-hosting-node__label-empty">Name this GitLab host…</span>} rejectEmpty={false} />
      </div>
      {!collapsed ? <GitLabHostingPanel nodeId={id} config={config} onConfigChange={(next) => updateNodeData(id, { gitlabHostingConfig: next })} /> : null}
    </div>
  )
}
