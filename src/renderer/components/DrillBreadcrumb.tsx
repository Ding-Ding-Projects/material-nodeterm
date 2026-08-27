import type { DrillContext } from '../state/workspace'
import { useProjects } from '../state/projects'

/**
 * Canvas-level navigation chrome for group and linked-project drills. The drilled node set no
 * longer contains the frame that was opened, so the return path must live outside React Flow.
 */
export function DrillBreadcrumb({
  drill,
  onExit
}: {
  drill: DrillContext
  onExit: () => void
}): JSX.Element {
  const projectId = drill.kind === 'project-ref' ? drill.targetId : drill.projectId
  const project = useProjects((state) => state.projects.find((item) => item.id === projectId))
  const group = drill.kind === 'group'
    ? project?.nodes.find((node) => node.id === drill.groupId)
    : undefined
  const title = drill.kind === 'project-ref' ? project?.name || 'Project' : group?.title || 'Group'
  return (
    <div className="announce-banner announce-banner--info drill-breadcrumb" role="status">
      <span className="announce-banner__dot" aria-hidden="true" />
      <div className="announce-banner__content">
        <span className="announce-banner__body">
          Opened <strong>{title}</strong> as a canvas
        </span>
      </div>
      <button
        className="announce-banner__close"
        type="button"
        title="Return to canvas"
        onClick={onExit}
      >
        ← back
      </button>
    </div>
  )
}
