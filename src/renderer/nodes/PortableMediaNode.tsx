import { useEffect, useState } from 'react'
import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import { useProjects } from '../state/projects'
import { resolvePortableMediaReference } from '../lib/portableMediaRuntime'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { IconButton } from '../ui/md3'

export default function PortableMediaNode({ id, data, selected, type }: NodeProps<CanvasNode>): React.JSX.Element {
  const { deleteElements } = useReactFlow()
  const [sources, setSources] = useState<Array<{ ref: NonNullable<typeof data.media>[number]; url?: string; error?: string }>>([])
  const refs = (data.media ?? []) as NonNullable<typeof data.media>
  const project = useProjects.getState().projects.find((item) => item.id === useProjects.getState().activeProjectId)
  useEffect(() => {
    let alive = true
    void Promise.all(refs.map(async (ref) => ({ ref, result: await resolvePortableMediaReference(project ?? { id: '', name: '', color: '#000000', viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] }, ref, window.nodeTerminal.media) }))).then((resolved) => {
      if (!alive) return
      setSources(resolved.map(({ ref, result }) => result.ok ? { ref, url: result.url } : { ref, error: result.error }))
    })
    return () => { alive = false }
  }, [refs.map((ref) => ref.assetId + ':' + ref.source).join('|'), project?.id])
  const headerFill = nodeHeaderFillStyle(data.color)
  const render = (item: typeof sources[number]) => item.url
    ? item.ref.kind === 'audio' ? <audio key={item.ref.assetId} src={item.url} controls preload="metadata" />
      : <img key={item.ref.assetId} src={item.url} alt={item.ref.displayName} />
    : <span key={item.ref.assetId} role="status">{item.error ?? 'Loading media…'}</span>
  return (
    <div className={'term-node portable-media-node ' + (selected ? 'selected' : '')}>
      <NodeResizer minWidth={320} minHeight={200} isVisible={selected} color={data.color} />
      <Handle id="flow-in" type="target" position={Position.Top} isConnectable={false} style={{ opacity: 0, pointerEvents: 'none', top: 0 }} />
      <div className={'term-node__header ' + headerFill.className + (headerFill.filled ? ' term-node__header--filled' : '')} style={headerFill.style}>
        <span className="term-node__title-text">{data.title}</span><span className="term-node__spacer" />
        <IconButton size="compact" className="term-node__close" icon="close" title="Close" aria-label="Close media node" onClick={() => deleteElements({ nodes: [{ id }] })} />
      </div>
      <div className="editor-node__body portable-media-node__body">
        {type === 'gallery' ? <div className="portable-media-node__gallery">{sources.map(render)}</div> : sources.slice(0, 1).map(render)}
      </div>
    </div>
  )
}
