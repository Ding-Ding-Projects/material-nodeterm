import type { DrillContext } from '../state/workspace'
import { useProjects } from '../state/projects'

/**
 * Canvas-level navigation chrome for a group drill. The drilled node set no longer contains the
 * frame that was opened, so the return path must live outside React Flow and remain available even
 * when the group has no children.
 */
export function DrillBreadcrumb({
  drill,
  onExit
}: {
  drill: DrillContext
  onExit: () => void
}): JSX.Element {
  const project = useProjects((state) => state.projects.find((item) => item.id === drill.projectId))
  const group = project?.nodes.find((node) => node.id === drill.groupId)
  const title = group?.title || 'Group'
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
