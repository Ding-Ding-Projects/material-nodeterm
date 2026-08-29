import { columnForNode } from '../../lib/kanban'
import { alphaTint } from '../color/tint'
import { useProjects } from '../../state/projects'
import { useViewMode } from '../../state/viewMode'

/** Half-pill flush against a session node's TOP edge showing its kanban column — rendered as
 *  a SIBLING of the node's root (the roots are overflow:hidden, which would clip a child
 *  poking above the border). Hidden for Ungrouped/unassigned nodes; click opens the board. */
export function ColumnPill({ nodeId }: { nodeId: string }) {
  const column = useProjects((s) =>
    columnForNode(s.projects.find((p) => p.id === s.activeProjectId)?.kanban, nodeId)
  )
  if (!column) return null
  return (
    <button
      className="kanban-node-pill nodrag"
      // alphaTint, NOT `${column.color}2e`: a hex-alpha suffix is only a colour for 6-digit hex,
      // so the moment the column recolour strip offers anything the picker can emit
      // (`rgb(…)`, `oklch(…)`) the pill's fill silently vanishes while its border stays right —
      // CSS drops the unparsable declaration and says nothing. Latent today only because
      // KanbanColumn's swatches are NODE_COLORS presets; fixed so widening them stays safe.
      // 46/255 is exactly what the `2e` suffix meant.
      style={{ background: alphaTint(column.color, 46 / 255), borderColor: column.color, color: column.color }}
      title={`Kanban: ${column.title} — open the board`}
      onClick={(e) => {
        e.stopPropagation() // don't select/drag the node under the pill
        const id = useProjects.getState().activeProjectId
        if (id) useViewMode.getState().toggle(id)
      }}
    >
      {column.title}
    </button>
  )
}
