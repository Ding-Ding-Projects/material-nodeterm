import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import { DEFAULT_GITLAB_HOSTING_CONFIG, type GitLabHostingConfig } from '@shared/gitlab-hosting'
import type { CanvasNode } from '../state/workspace'
import { COLLAPSED_HEIGHT } from '../state/workspace'
import { GitLabHostingPanel } from '../components/gitlab/GitLabHostingPanel'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import { nodeBorderStyle, nodeColorStyle } from '../lib/nodeColor'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { mapAroundExactFacts } from './nodeVocabulary'
import { IconButton } from '@renderer/ui/md3'

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
  const gitLabLabel = data.serviceLabel ? mapAroundExactFacts(`GitLab hosting: ${data.serviceLabel}`, ['GitLab', data.serviceLabel], vocab) : mapAroundExactFacts('GitLab hosting', ['GitLab'], vocab)

  const toggleCollapse = (): void => {
    setNodes((nodes) => nodes.map((node) => {
      if (node.id !== id) return node
      const expandedHeight = (node.data.expandedHeight as number | undefined) ?? node.measured?.height ?? node.height ?? 620
      const height = collapsed ? expandedHeight : COLLAPSED_HEIGHT
      return { ...node, height, style: { ...node.style, height }, data: { ...node.data, collapsed: !collapsed, expandedHeight } }
    }))
  }

  return (
    <div className={`gitlab-hosting-node${selected ? ' selected' : ''}${collapsed ? ' collapsed' : ''} ${border.className}`} data-easter-surface="hosting" style={border.style} role="group" aria-label={gitLabLabel}>
      <NodeResizer minWidth={560} minHeight={360} isVisible={selected && !collapsed} color={data.color} />
      <div className={`gitlab-hosting-node__header ${header.className}`} style={header.style}>
        <IconButton size="compact" className="term-node__collapse" icon={collapsed ? 'chevron_right' : 'arrow_drop_down'} title={collapsed ? 'Expand' : 'Collapse'} aria-label={collapsed ? 'Expand' : 'Collapse'} onClick={toggleCollapse} />
        <span className="gitlab-hosting-node__product">{mapAroundExactFacts('GitLab hosting', ['GitLab'], vocab)}</span>
        <EditableNodeTitle value={data.serviceLabel ?? ''} onChange={(next) => updateNodeData(id, { serviceLabel: next })} ariaLabel={mapAroundExactFacts('Name for this GitLab hosting node', ['GitLab'], vocab)} title={vocab('Rename')} baseTriggerClassName="" triggerClassName="gitlab-hosting-node__label" emptyLabel={<span className="gitlab-hosting-node__label-empty">{mapAroundExactFacts('Name this GitLab host…', ['GitLab'], vocab)}</span>} rejectEmpty={false} />
      </div>
      {!collapsed ? <GitLabHostingPanel nodeId={id} config={config} onConfigChange={(next) => updateNodeData(id, { gitlabHostingConfig: next })} /> : null}
    </div>
  )
}
