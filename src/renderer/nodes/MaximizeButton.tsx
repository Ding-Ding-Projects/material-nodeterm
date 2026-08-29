import { useReactFlow, useStoreApi } from '@xyflow/react'
import { Tooltip } from '../components/Tooltip'
import { markWorkspaceDirty } from '../state/workspaceDirty'
import { maximizeNodeToRect, restoreMaximizedNode, type CanvasNode } from '../state/workspace'
import { maximizeTargetRect } from '../lib/nodeMaximize'

/** Header control shared by terminal, editor, and diff nodes. */
export function MaximizeButton({ id, maximized }: { id: string; maximized: boolean }) {
  const { setNodes, getViewport } = useReactFlow()
  const store = useStoreApi()
  const toggle = () => {
    setNodes((ns) => {
      const flow = ns as CanvasNode[]
      if (maximized) return restoreMaximizedNode(flow, id)
      const { width, height } = store.getState()
      const rect = maximizeTargetRect(getViewport(), width, height)
      return rect ? maximizeNodeToRect(flow, id, rect) : ns
    })
    markWorkspaceDirty()
  }
  return (
    <Tooltip label={maximized ? 'Restore previous size and position' : 'Maximize — fill the visible canvas'}>
      <button
        className="term-node__maximize nodrag"
        aria-label={maximized ? 'Restore node size' : 'Maximize node'}
        aria-pressed={maximized}
        onClick={(e) => { e.stopPropagation(); toggle() }}
      >
        <span aria-hidden="true">{maximized ? '↙↗' : '↗↙'}</span>
      </button>
    </Tooltip>
  )
}
