import { NodeResizer, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import { isAwsShopNode } from '@shared/aws-shop'
import { Button } from '../ui/md3'

/** Persistent AWS Shop canvas node. It never dials AWS; it only opens the local catalog surface. */
export function AwsShopNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const valid = isAwsShopNode({ id, kind: 'aws-shop', awsUniverseId: data.awsUniverseId })
  return (
    <section className={`aws-shop-node${selected ? ' is-selected' : ''}`} aria-label="AWS Shop">
      <NodeResizer isVisible={selected} minWidth={420} minHeight={260} />
      <header className="aws-shop-node__header">
        <span className="aws-shop-node__icon" aria-hidden="true">AWS</span>
        <div>
          <strong>{data.title || 'AWS Shop'}</strong>
          <small>{valid ? 'Non-deletable catalog entry' : 'Repair required'}</small>
        </div>
      </header>
      <p>Browse typed AWS operation blueprints for this universe. Credentials and AWS calls stay outside the portable canvas.</p>
      <Button
        variant="filled"
        className="nodrag"
        disabled={!valid}
        title={valid ? undefined : 'This Shop identity is malformed and must be repaired first.'}
        onClick={() => window.dispatchEvent(new CustomEvent('nodeterm:open-aws-shop', { detail: { nodeId: id, universeId: data.awsUniverseId } }))}
      >
        Open AWS catalog
      </Button>
    </section>
  )
}

