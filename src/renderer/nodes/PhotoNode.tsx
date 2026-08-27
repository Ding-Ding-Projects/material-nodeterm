import { useEffect, useState } from 'react'
import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import { nodeHeaderFillStyle } from '../lib/nodeColor'

export default function PhotoNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { deleteElements } = useReactFlow()
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')
  const path = String(data.filePath ?? '')
  useEffect(() => {
    let alive = true
    if (!path) return () => { alive = false }
    window.nodeTerminal.media.allow(path).then((url) => { if (alive) setSrc(url) }).catch(() => { if (alive) setError('Could not load this photo.') })
    return () => { alive = false }
  }, [path])
  const fill = nodeHeaderFillStyle(data.color)
  return <div className={`term-node photo-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }}>
    <NodeResizer minWidth={280} minHeight={220} isVisible={selected} color={data.color} />
    <Handle id="flow-in" type="target" position={Position.Top} isConnectable={false} style={{ opacity: 0, pointerEvents: 'none', top: 0 }} />
    <div className={`term-node__header ${fill.className}${fill.filled ? ' term-node__header--filled' : ''}`} style={fill.style}>
      <span className="term-node__title-text" title={path}>{String(data.title || 'Photo')}</span><span className="term-node__spacer" />
      <button className="term-node__close" title="Close" aria-label="Close photo" onClick={() => deleteElements({ nodes: [{ id }] })}>×</button>
    </div>
    <div className="editor-node__body"><div className="editor-node__image nodrag nowheel">
      {src ? <img src={src} alt={String(data.title || 'Photo')} /> : <span className="editor-node__loading">{error || (path ? 'Loading photo…' : 'No photo selected.')}</span>}
    </div></div>
  </div>
}
