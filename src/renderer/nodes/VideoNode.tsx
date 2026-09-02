import { useEffect, useState } from 'react'
import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { NODE_MIN_SIZES } from '../lib/nodeSizing'
import type { CanvasNode } from '../state/workspace'
import { useProjects } from '../state/projects'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { IconButton } from '@renderer/ui/md3'

/**
 * A video player node. A local file is served over the `nt-media://` protocol (allowlisted on
 * mount via `media.allow`) and rendered with native controls so seeking/scrubbing works. A file
 * in an SSH project (`data.sshFs` — the path lives on the HOST, mirroring EditorNode's flag) is
 * first pulled into the local media cache over the project's ControlMaster (`media.allowSsh`;
 * re-fetch is skipped when the cached copy still matches), then played the same way. The
 * frame/header mirror {@link EditorNode} for consistent drag/resize/close behavior.
 */
export default function VideoNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const vocab = useVocabularyMapper()
  const { deleteElements } = useReactFlow()
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')
  const [externalError, setExternalError] = useState(false)
  const [fetching, setFetching] = useState(false)
  const filePath = (data.filePath as string) ?? ''
  const fileName = filePath.split('/').pop() || ''
  const displayFileName = fileName || vocab('video')
  const remote = !!data.sshFs

  useEffect(() => {
    if (!filePath) return
    let alive = true
    if (remote) {
      // Remote fetch can take a while for a large file — say what the wait is.
      const projectId = useProjects.getState().activeProjectId
      if (!projectId) {
        setError('Couldn’t load this video.')
        setExternalError(false)
        return
      }
      setFetching(true)
      window.nodeTerminal.media
        .allowSsh(projectId, filePath)
        .then((r) => {
          if (!alive) return
          setFetching(false)
          if (r.ok) setSrc(r.url)
          else {
            setError(r.error)
            setExternalError(true)
          }
        })
        .catch(() => {
          if (!alive) return
          setFetching(false)
          setError('Couldn’t load this video.')
          setExternalError(false)
        })
      return () => {
        alive = false
      }
    }
    window.nodeTerminal.media
      .allow(filePath)
      .then((url) => {
        if (alive) setSrc(url)
      })
      .catch(() => {
        if (alive) {
          setError('Couldn’t load this video.')
          setExternalError(false)
        }
      })
    return () => {
      alive = false
    }
    // activeProjectId is read at effect time on purpose: the node lives inside its project's
    // canvas, so the active project when the node mounts IS its project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, remote])

  const headerFill = nodeHeaderFillStyle(data.color)

  return (
    <div
      className={`term-node video-node${selected ? ' selected' : ''}`}
      data-easter-surface="media"
      style={{ borderTopColor: data.color }}
    >
      <NodeResizer minWidth={NODE_MIN_SIZES.video.width} minHeight={NODE_MIN_SIZES.video.height} isVisible={selected} color={data.color} />
      {/* Invisible target handle so a rope from the agent node that opened this can attach. */}
      <Handle
        id="flow-in"
        type="target"
        position={Position.Top}
        isConnectable={false}
        style={{ opacity: 0, pointerEvents: 'none', top: 0 }}
      />

      <div
        className={`term-node__header ${headerFill.className}${
          headerFill.filled ? ' term-node__header--filled' : ''
        }`}
        style={headerFill.style}
      >
        <span className="term-node__title-text" title={filePath}>
          {displayFileName}
        </span>
        <span className="term-node__spacer" />
<IconButton
          size="compact"
          className="term-node__close"
          icon="close"
          aria-label="Close"
          title="Close"
          onClick={() => deleteElements({ nodes: [{ id }] })}
        />
      </div>

      <div className="editor-node__body">
        <div className="editor-node__image nodrag nowheel">
          {src ? (
            <video
              src={src}
              controls
              preload="metadata"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : (
            <span className="editor-node__loading">
              {error
                ? externalError
                  ? error
                  : vocab(error)
                : fetching
                  ? vocab('Fetching from the host…')
                  : vocab('Loading…')}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
