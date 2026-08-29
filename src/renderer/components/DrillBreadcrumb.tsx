import { useProjects } from '../state/projects'
import type { DrillContext } from '../state/workspace'

/** Canvas-level navigation strip for group, node, and project-reference drills. */
export function DrillBreadcrumb({ drill, onExit }: { drill: DrillContext; onExit: () => void }) {
  const projects = useProjects((state) => state.projects)
  const targetProjectId = drill.kind === 'project-ref' ? drill.targetId : drill.projectId
  const project = projects.find((item) => item.id === targetProjectId)
  const title =
    drill.kind === 'project-ref'
      ? project?.name ?? 'Project'
      : project?.nodes.find(
          (node) => node.id === (drill.kind === 'group' ? drill.groupId : drill.nodeId)
        )?.title ?? (drill.kind === 'group' ? 'Group' : 'Node')
  const prefix = drill.kind === 'project-ref' ? 'Project' : drill.kind === 'group' ? 'Group' : 'Node'
  return (
    <div className="announce-banner announce-banner--info drill-breadcrumb" role="status">
      <span className="announce-banner__dot" />
      <div className="announce-banner__content">
        <span className="announce-banner__body">
          {prefix}: <strong>{title}</strong> · drilled view
        </span>
      </div>
      <button className="announce-banner__close" type="button" title="Return to canvas" onClick={onExit}>
        Return
      </button>
    </div>
  )
}
