import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import { advancePortalDoorConstruction, PORTAL_DOOR_PARTS, type PortalDoorPart } from '@shared/portal-door'
import { COLLAPSED_HEIGHT, type CanvasNode } from '../state/workspace'
import { nodeBorderStyle, nodeColorStyle } from '../lib/nodeColor'
import { ColumnPill } from '../components/kanban/ColumnPill'
import { EditableNodeTitle } from '../components/EditableNodeTitle'

const LABELS: Record<PortalDoorPart, string> = {
  frame: 'Frame', hinges: 'Hinges', panel: 'Panel', handle: 'Handle', 'activation-core': 'Activation core'
}
const DESCRIPTIONS: Record<PortalDoorPart, string> = {
  frame: 'Set the stable doorway boundary.', hinges: 'Seat the two moving joints.', panel: 'Fit the solid portal panel.', handle: 'Add the physical pull handle.', 'activation-core': 'Install the final activation core.'
}

export function PortalDoorNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { updateNodeData, setNodes } = useReactFlow<CanvasNode>()
  const construction = data.portalDoor
  const completed = construction?.completed ?? []
  const collapsed = !!data.collapsed
  const border = nodeBorderStyle(data.color)
  const tint = nodeColorStyle(data.color, 0.2)
  const next = PORTAL_DOOR_PARTS[completed.length]

  const toggleCollapse = () => setNodes((nodes) => nodes.map((node) => {
    if (node.id !== id) return node
    const isCollapsed = !node.data.collapsed
    const expandedHeight = node.data.expandedHeight ?? node.measured?.height ?? node.height ?? 460
    const height = isCollapsed ? COLLAPSED_HEIGHT : expandedHeight
    return { ...node, height, style: { ...node.style, height }, data: { ...node.data, collapsed: isCollapsed, expandedHeight } }
  }))

  const addPart = (part: PortalDoorPart) => {
    if (!construction || part !== next) return
    updateNodeData(id, { portalDoor: advancePortalDoorConstruction(construction, part) })
  }

  return <>
    <ColumnPill nodeId={id} />
    <div className={`portal-door-node${selected ? ' selected' : ''}${collapsed ? ' collapsed' : ''} ${border.className}`} style={border.style} role="group" aria-label={data.portalDoor?.stage === 'complete' ? 'Portal door construction complete' : 'Interactive portal door construction'}>
      <NodeResizer minWidth={360} minHeight={260} isVisible={selected && !collapsed} color={data.color} />
      <div className={`portal-door-node__header ${tint.className}`} style={tint.style}>
        <button className="term-node__collapse" title={collapsed ? 'Expand' : 'Collapse'} aria-label={collapsed ? 'Expand portal door' : 'Collapse portal door'} onClick={toggleCollapse}>{collapsed ? '▸' : '▾'}</button>
        <span className="portal-door-node__icon" aria-hidden="true">🚪</span>
        <EditableNodeTitle value={data.title} onChange={(title) => updateNodeData(id, { title })} ariaLabel="Portal door name" title="Rename" baseTriggerClassName="" triggerClassName="portal-door-node__title" emptyLabel="Name this portal door…" rejectEmpty={false} />
      </div>
      {!collapsed && <div className="portal-door-node__body">
        <div className="portal-door-node__preview" data-stage={construction?.stage ?? 'frame'} aria-label={`Portal door preview, ${construction?.stage ?? 'frame'} stage`}>
          <div className="portal-door-node__frame"><div className="portal-door-node__panel"><span className="portal-door-node__handle" /><span className="portal-door-node__core" aria-hidden="true">✦</span></div></div>
        </div>
        <div className="portal-door-node__status" role="status"><strong>{construction?.stage === 'complete' ? 'Door construction complete' : `Next: ${LABELS[next ?? 'activation-core']}`}</strong><span>{completed.length} of {PORTAL_DOOR_PARTS.length} parts installed</span></div>
        <div className="portal-door-node__parts" role="list" aria-label="Portal door construction parts">
          {PORTAL_DOOR_PARTS.map((part) => { const done = completed.includes(part); const active = part === next; const unavailable = `Available after ${LABELS[PORTAL_DOOR_PARTS[Math.max(0, PORTAL_DOOR_PARTS.indexOf(part) - 1)]!]}`; return <div className={`portal-door-node__part${done ? ' complete' : ''}${active ? ' active' : ''}`} role="listitem" key={part}><div><strong>{done ? '✓ ' : ''}{LABELS[part]}</strong><span>{done ? 'Installed and saved' : DESCRIPTIONS[part]}</span></div><button type="button" disabled={!active} title={done ? 'Installed and saved' : active ? `Install ${LABELS[part]}` : unavailable} onClick={() => addPart(part)} aria-label={`${done ? 'Installed' : `Install ${LABELS[part]}`}${active ? '' : `, ${unavailable.toLowerCase()}`}`}>{done ? 'Installed' : active ? `Install ${LABELS[part]}` : unavailable}</button></div> })}
        </div>
        <p className="portal-door-node__note">This lane records the door's physical parts and portable metadata only. Entry, recovery, and navigation arrive in later portal lanes.</p>
      </div>}
    </div>
  </>
}
