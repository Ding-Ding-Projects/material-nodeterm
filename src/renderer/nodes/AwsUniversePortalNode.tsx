import { NodeResizer, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import { useLocalizedVocabularyText } from '../lib/personalVocabulary/useLocalizedVocabularyText'

/** Material Design 3 portal card for one AWS-only Universe child canvas. */
export function AwsUniversePortalNode({ id, data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const ts = useLocalizedVocabularyText()
  const canvasId = typeof data.universeCanvasId === 'string' ? data.universeCanvasId : ''
  const title = data.title || ts('awsUniverse.title', 'AWS Universe')
  const open = (): void => {
    if (!canvasId) return
    window.dispatchEvent(new CustomEvent('nodeterm:open-aws-universe', { detail: { canvasId } }))
  }
  return (
    <div id={id} className="aws-universe-portal-node" data-appearance-id={`node:${id}`}>
      <NodeResizer isVisible={selected} minWidth={320} minHeight={220} />
      <button type="button" className="aws-universe-portal-node__open" onClick={open} aria-label={ts('awsUniverse.open', 'Open AWS Universe')}>
        <span className="aws-universe-portal-node__icon" aria-hidden="true">◎</span>
        <span className="aws-universe-portal-node__title">{title}</span>
      </button>
      <p className="aws-universe-portal-node__scope">{ts('awsUniverse.scope', 'AWS-only scope')}</p>
      <p className="aws-universe-portal-node__description">{ts('awsUniverse.description', 'An AWS-only canvas. Provider credentials and runtime bindings stay on this computer.')}</p>
    </div>
  )
}
