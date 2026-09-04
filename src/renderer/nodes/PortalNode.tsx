import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import type { PortalDoor } from '@shared/types'
import { Button } from '../ui/md3'

let activateDoor: ((nodeId: string, door: PortalDoor) => void) | null = null

/** Canvas installs the current navigation controller here; the node itself never changes canvas state. */
export function setPortalDoorActionHandler(handler: ((nodeId: string, door: PortalDoor) => void) | null): void {
  activateDoor = handler
}

/** A visible, keyboard-operable door. It has no generic href or tab destination by design. */
export function PortalNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const door = data.portal
  if (!door) return <div className="portal-node portal-node--invalid">Portal door is unavailable.</div>
  const isEntry = door.direction === 'entry'
  return (
    <div className={`portal-node${selected ? ' selected' : ''}`} data-door-pair-id={door.doorPairId}>
      <NodeResizer minWidth={220} minHeight={140} isVisible={selected} color={data.color} />
      <Handle type="target" position={Position.Left} className="portal-node__handle" />
      <Handle type="source" position={Position.Right} className="portal-node__handle" />
      <div className="portal-node__frame" style={{ borderColor: data.color }}>
        <div className="portal-node__hinge" aria-hidden="true" />
        <div className="portal-node__header">
          <span className="portal-node__icon" aria-hidden="true">{isEntry ? '⇥' : '⇤'}</span>
          <strong>{data.title || (isEntry ? 'Portal door' : 'Return door')}</strong>
        </div>
        <div className="portal-node__copy">
          {isEntry ? 'Enter the matched child canvas' : 'Return through the matched entry door'}
          <span lang="zh-Hant">{isEntry ? '由配對門進入子畫布' : '經配對入口門返回'}</span>
        </div>
        <Button
          variant="filled"
          className="portal-node__activate"
          aria-label={`${isEntry ? 'Enter' : 'Return from'} ${data.title || 'portal door'}`}
          onClick={() => activateDoor?.(id, door)}
          disabled={!activateDoor}
        >
          {isEntry ? 'Enter · 進入' : 'Return · 返回'}
        </Button>
      </div>
    </div>
  )
}

