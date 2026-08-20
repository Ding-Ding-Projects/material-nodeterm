import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import type { BrowserProfile } from '@shared/types'
import { browserPartitionFor } from '@shared/browser-profiles'
import type { CanvasNode } from '../state/workspace'
import { useProjects } from '../state/projects'
import { BrowserSurface } from './BrowserSurface'
import { BrowserProfilePicker } from './BrowserProfilePicker'

/**
 * A navigable Chromium browser node: node chrome (frame/header/resize/close) wrapping the shared
 * {@link BrowserSurface} (webview + toolbar). The last top-level URL persists to `data.url` so the
 * node reopens where it was; the same surface backs the kanban card modal's browser popup.
 *
 * Multiple browser profiles per project (2026-08): the header's {@link BrowserProfilePicker} lets
 * the user switch which of the project's named `browserProfiles` this node uses — two nodes on
 * the same profile share cookies/storage, nodes on different profiles are isolated. See
 * `shared/browser-profiles.ts` for the partition derivation this is built on.
 */
export default function BrowserNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { deleteElements, updateNodeData } = useReactFlow()
  const activeProjectId = useProjects((s) => s.activeProjectId)
  const projectBrowserProfiles = useProjects(
    (s) => s.projects.find((p) => p.id === s.activeProjectId)?.browserProfiles
  )
  const setProjectBrowserProfiles = useProjects((s) => s.setProjectBrowserProfiles)

  const browserProfileId = data.browserProfileId as string | undefined
  const partition = browserPartitionFor(activeProjectId, browserProfileId)

  return (
    <div className={`term-node browser-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }}>
      <NodeResizer minWidth={360} minHeight={240} isVisible={selected} color={data.color} />
      {/* Invisible target handle so a rope from the agent node that opened this can attach. */}
      <Handle
        id="flow-in"
        type="target"
        position={Position.Top}
        isConnectable={false}
        style={{ opacity: 0, pointerEvents: 'none', top: 0 }}
      />
      {/* Invisible source handle so a rope to a browser node this one spawned (new-window) attaches. */}
      <Handle
        id="flow-out"
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        style={{ opacity: 0, pointerEvents: 'none', bottom: 0 }}
      />

      <div className="term-node__header">
        <span className="term-node__title-text" title={(data.url as string) || ''}>
          {(data.title as string) || 'Browser'}
        </span>
        <span className="term-node__spacer" />
        <BrowserProfilePicker
          profiles={projectBrowserProfiles}
          selectedId={browserProfileId}
          onSelect={(profileId) => updateNodeData(id, { browserProfileId: profileId })}
          onCreate={(profile: BrowserProfile) =>
            setProjectBrowserProfiles(activeProjectId, [...(projectBrowserProfiles ?? []), profile])
          }
          onRename={(profileId, name) =>
            setProjectBrowserProfiles(
              activeProjectId,
              (projectBrowserProfiles ?? []).map((p) => (p.id === profileId ? { ...p, name } : p))
            )
          }
          onRemove={(profileId) => {
            setProjectBrowserProfiles(
              activeProjectId,
              (projectBrowserProfiles ?? []).filter((p) => p.id !== profileId)
            )
            // This node's own selection stays as-is (still a valid, isolated partition — see
            // `browserPartitionFor`'s dangling-reference note); only the name disappears from the
            // picker. A node that was ON the removed profile keeps its own cookie jar rather than
            // silently merging into the default session.
          }}
        />
        <button className="term-node__close" title="Close" onClick={() => deleteElements({ nodes: [{ id }] })}>
          ×
        </button>
      </div>

      <div className="editor-node__body">
        <BrowserSurface
          // Keyed by partition: switching profiles must tear down and rebuild the <webview> onto
          // the new Electron session rather than trying to reparent a live guest across sessions —
          // see BrowserSurfaceProps.partition's doc comment.
          key={partition ?? 'default'}
          nodeId={id}
          ownerNodeId={data.browserOwnerNodeId as string | undefined}
          url={(data.url as string) ?? ''}
          onUrlChange={(u) => updateNodeData(id, { url: u })}
          onTitleChange={(t) => updateNodeData(id, { title: t })}
          partition={partition}
        />
      </div>
    </div>
  )
}
