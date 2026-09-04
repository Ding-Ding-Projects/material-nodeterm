import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { browserPartitionFor } from '@shared/browser-profiles'
import {
  KIOSK_DEFAULT_TITLE,
  kioskLocalProfileStorageKey,
  normalizeKioskUrl,
  sanitizeKioskManifest,
  type KioskDisplayMode,
  type KioskManifestMetadata
} from '@shared/kiosk-sessions'
import type { CanvasNode } from '../state/workspace'
import { useProjects } from '../state/projects'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { BrowserSurface } from './BrowserSurface'
import { Button, IconButton } from '../ui/md3'

function freshLocalProfileId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function localProfileFor(projectId: string, nodeId: string): string {
  const key = kioskLocalProfileStorageKey(projectId, nodeId)
  try {
    const existing = window.localStorage.getItem(key)
    if (existing && /^[a-z0-9-]{8,80}$/i.test(existing)) return existing
    const created = freshLocalProfileId()
    window.localStorage.setItem(key, created)
    return created
  } catch {
    // Private browsing or a restricted browser store still gets a per-node partition for this
    // process. It is intentionally not persisted into the portable project file.
    return `${nodeId}-${freshLocalProfileId()}`
  }
}

/** A PWA/Kiosk node with a dedicated persistent partition and a deliberately small control bar.
 *
 * The page URL, title and sanitized manifest are project intent. Cookies, service workers,
 * localStorage, cache and the opaque partition key remain machine-local. Switching computers
 * therefore presents a new isolated profile and a visible rebind state rather than silently
 * borrowing another browser node's identity.
 */
export default function KioskNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { deleteElements, updateNodeData } = useReactFlow()
  const projectId = useProjects((s) => s.activeProjectId) || 'local-project'
  const [mode, setMode] = useState<KioskDisplayMode>(data.kioskMode === 'fullscreen' ? 'fullscreen' : 'bounded')
  const [manifest, setManifest] = useState<KioskManifestMetadata | undefined>(data.kioskManifest)
  const [profileGeneration, setProfileGeneration] = useState(0)
  const [failure, setFailure] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const localProfileId = useMemo(
    () => localProfileFor(projectId, `${id}-${profileGeneration}`),
    [projectId, id, profileGeneration]
  )
  const partition = browserPartitionFor(projectId, `kiosk-${localProfileId}`)
  const rawUrl = typeof data.url === 'string' ? data.url : ''
  const safeUrl = normalizeKioskUrl(rawUrl) || ''
  const title = (typeof data.title === 'string' && data.title.trim()) || KIOSK_DEFAULT_TITLE
  const headerFill = nodeHeaderFillStyle(data.color)

  const saveMode = useCallback(
    (next: KioskDisplayMode) => {
      setMode(next)
      updateNodeData(id, { kioskMode: next })
    },
    [id, updateNodeData]
  )

  const enterFullscreen = useCallback(async () => {
    const element = rootRef.current
    if (!element?.requestFullscreen) {
      setFailure('Full-screen mode is unavailable here. Use bounded mode instead.')
      return
    }
    try {
      await element.requestFullscreen()
      saveMode('fullscreen')
      setFailure('')
    } catch {
      setFailure('The platform declined full-screen mode. The page remains in bounded mode.')
      saveMode('bounded')
    }
  }, [saveMode])

  const leaveFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen()
    } finally {
      saveMode('bounded')
    }
  }, [saveMode])

  useEffect(() => {
    const onFullscreen = (): void => {
      if (!document.fullscreenElement) {
        setMode('bounded')
        updateNodeData(id, { kioskMode: 'bounded' })
      }
    }
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => document.removeEventListener('fullscreenchange', onFullscreen)
  }, [id, updateNodeData])

  const onManifestDiscovered = useCallback(
    (value: unknown, manifestUrl: string): void => {
      const next = sanitizeKioskManifest(value, manifestUrl)
      if (!next) return
      setManifest(next)
      updateNodeData(id, { kioskManifest: next })
    },
    [id, updateNodeData]
  )

  const onUrlChange = useCallback(
    (next: string): void => {
      const safe = normalizeKioskUrl(next)
      if (!safe) {
        setFailure('Navigation was refused. Kiosk sessions accept only HTTP(S) pages.')
        return
      }
      setFailure('')
      updateNodeData(id, { url: safe })
    },
    [id, updateNodeData]
  )

  const resetProfile = (): void => {
    try {
      window.localStorage.removeItem(kioskLocalProfileStorageKey(projectId, `${id}-${profileGeneration}`))
    } catch {
      // The next generation still creates a new in-memory partition when local storage is absent.
    }
    setProfileGeneration((value) => value + 1)
    setFailure('A fresh isolated profile is ready. Sign in again if the page requires it.')
  }

  return (
    <div
      ref={rootRef}
      className={`term-node kiosk-node kiosk-node--${mode}${selected ? ' selected' : ''}`}
      style={{ borderTopColor: data.color }}
      data-kiosk-mode={mode}
    >
      <NodeResizer minWidth={420} minHeight={280} isVisible={selected && mode === 'bounded'} color={data.color} />
      <Handle id="flow-in" type="target" position={Position.Top} isConnectable={false} style={{ opacity: 0, pointerEvents: 'none', top: 0 }} />
      <div
        className={`term-node__header ${headerFill.className}${headerFill.filled ? ' term-node__header--filled' : ''}`}
        style={headerFill.style}
      >
        <span className="term-node__title-text" title={safeUrl}>{title}</span>
        <span className="term-node__spacer" />
        <span className="kiosk-node__profile" title="Cookies and site storage stay in this machine-local profile">
          Isolated profile
        </span>
        {mode === 'fullscreen' ? (
          <Button variant="text" size="small" className="kiosk-node__control" onClick={() => void leaveFullscreen()} title="Exit full-screen mode">
            Exit full-screen
          </Button>
        ) : (
          <Button variant="text" size="small" className="kiosk-node__control" onClick={() => void enterFullscreen()} title="Enter full-screen mode">
            Full-screen
          </Button>
        )}
        <Button variant="text" size="small" className="kiosk-node__control" onClick={resetProfile} title="Create a new isolated profile">
          Rebind
        </Button>
        <IconButton size="compact" className="term-node__close" icon="close" onClick={() => deleteElements({ nodes: [{ id }] })} title="Close kiosk session" aria-label="Close kiosk session" />
      </div>
      <div className="kiosk-node__status" role="status" aria-live="polite">
        {manifest ? (
          <span>Installable PWA: {manifest.name}{manifest.display ? ` · ${manifest.display}` : ''}</span>
        ) : (
          <span>No installable manifest detected yet. The page still works as a kiosk session.</span>
        )}
        <Button variant="text" size="small" className="kiosk-node__mode" onClick={() => (mode === 'fullscreen' ? void leaveFullscreen() : saveMode('bounded'))}>
          {mode === 'fullscreen' ? 'Use bounded mode' : 'Bounded mode'}
        </Button>
      </div>
      {failure && (
        <div className="kiosk-node__recovery" role="alert">
          <span>{failure}</span>
          <Button variant="text" size="small" onClick={() => setFailure('')}>Dismiss</Button>
        </div>
      )}
      <div className="editor-node__body kiosk-node__body">
        {safeUrl || !rawUrl ? (
          <BrowserSurface
            key={`${id}::${partition}`}
            nodeId={id}
            url={safeUrl}
            onUrlChange={onUrlChange}
            onTitleChange={(next) => next && updateNodeData(id, { title: next })}
            partition={partition}
            hideExtensions
            allowPopups={false}
            onManifestDiscovered={onManifestDiscovered}
            validateUrl={normalizeKioskUrl}
          />
        ) : (
          <div className="kiosk-node__invalid" role="alert">
            <strong>This kiosk URL cannot be opened.</strong>
            <span>Only an HTTP(S) URL without embedded credentials is allowed.</span>
            <Button variant="tonal" size="small" onClick={() => updateNodeData(id, { url: '' })}>Open the safe start page</Button>
          </div>
        )}
      </div>
    </div>
  )
}
