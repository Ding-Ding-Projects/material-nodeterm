import { NodeResizer, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'

/** Read-only blueprint node until the dedicated AWS execution lanes add their typed forms. */
export function AwsServiceNode({ data, selected }: NodeProps<CanvasNode>) {
  return (
    <section className={`aws-service-node${selected ? ' is-selected' : ''}`} aria-label={data.title}>
      <NodeResizer isVisible={selected} minWidth={360} minHeight={220} />
      <header className="aws-service-node__header">
        <span className="aws-service-node__icon" aria-hidden="true">AWS</span>
        <strong>{data.title}</strong>
      </header>
      <p>This is a typed AWS blueprint. Configure an account, region, and credentials before any operation can run.</p>
      <p className="aws-service-node__scope">AWS Universe: {data.awsUniverseId ?? 'unbound'}</p>
    </section>
  )
}

