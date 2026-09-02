import { useEffect, useState } from 'react'
import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { IconButton } from '@renderer/ui/md3'

export default function PhotoNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { deleteElements } = useReactFlow()
  const vocab = useVocabularyMapper()
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')
  const path = String(data.filePath ?? '')
  useEffect(() => {
    let alive = true
    if (!path) return () => { alive = false }
    window.nodeTerminal.media.allow(path).then((url) => { if (alive) setSrc(url) }).catch(() => { if (alive) setError(vocab('Could not load this photo.')) })
    return () => { alive = false }
  }, [path, vocab])
  const fill = nodeHeaderFillStyle(data.color)
  const title = String(data.title || vocab('Photo'))
  return <div className={`term-node photo-node${selected ? ' selected' : ''}`} data-easter-surface="media" style={{ borderTopColor: data.color }}>
    <NodeResizer minWidth={280} minHeight={220} isVisible={selected} color={data.color} />
    <Handle id="flow-in" type="target" position={Position.Top} isConnectable={false} style={{ opacity: 0, pointerEvents: 'none', top: 0 }} />
    <div className={`term-node__header ${fill.className}${fill.filled ? ' term-node__header--filled' : ''}`} style={fill.style}>
      <span className="term-node__title-text" title={path}>{title}</span><span className="term-node__spacer" />
      <IconButton size="compact" className="term-node__close" icon="close" vocabularyMode="factual" title={vocab('Close')} aria-label={vocab('Close photo')} onClick={() => deleteElements({ nodes: [{ id }] })} />
    </div>
    <div className="editor-node__body"><div className="editor-node__image nodrag nowheel">
      {src ? <img src={src} alt={title} /> : <span className="editor-node__loading">{error || (path ? vocab('Loading photo…') : vocab('No photo selected.'))}</span>}
    </div></div>
  </div>
}
