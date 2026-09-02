import { useEffect, useMemo, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { browserPartitionForNode } from '@shared/browser-profiles'
import { portableKioskPwaIntent, type KioskPwaLifecycle, type PortableKioskPwaIntent } from '@shared/kiosk-pwa'
import type { CanvasNode } from '../state/workspace'
import { useProjects } from '../state/projects'
import { NODE_MIN_SIZES } from '../lib/nodeSizing'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { mapAroundExactFacts } from './nodeVocabulary'
import { Button, IconButton } from '@renderer/ui/md3'

interface KioskPwaNodeProps {
  id: string
  intent: PortableKioskPwaIntent
  selected?: boolean
}

function localProfileKey(nodeId: string): string {
  return `nodeterm.kiosk-pwa.profile.${nodeId}`
}

function readProfileId(nodeId: string): string {
  if (typeof window === 'undefined') return `ephemeral-${nodeId}`
  try {
    const existing = window.localStorage.getItem(localProfileKey(nodeId))
    if (existing) return existing
    const created = `profile-${nodeId}-${Math.random().toString(36).slice(2, 10)}`
    window.localStorage.setItem(localProfileKey(nodeId), created)
    return created
  } catch {
    // Private storage can be unavailable in a browser-hosted surface. The session remains usable
    // with an ephemeral profile, and the visible copy names that the profile will not persist.
    return `ephemeral-${nodeId}`
  }
}

/**
 * A browser-owned kiosk/PWA session. The project stores only `intent`; this component keeps the
 * profile key and lifecycle in the local browser profile, and refuses every popup or permission
 * request that was not explicitly selected in the setup surface.
 */
export function KioskPwaNode({ id, data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const { deleteElements } = useReactFlow()
  const activeProjectId = useProjects((state) => state.activeProjectId)
  const intent = useMemo(() => portableKioskPwaIntent(data.kioskPwaIntent), [data.kioskPwaIntent])
  const partition = browserPartitionForNode(activeProjectId, `kiosk-pwa-${id}`, undefined)
  const [lifecycle, setLifecycle] = useState<KioskPwaLifecycle>('idle')
  const [profileId] = useState(() => readProfileId(id))
  const [reloadKey, setReloadKey] = useState(0)
  const viewRef = useRef<HTMLElement | null>(null)

  const source = useMemo(() => {
    if (!intent) return undefined
    return intent.target.kind === 'url' ? intent.target.url : intent.target.startUrl
  }, [intent])

  useEffect(() => {
    if (!intent || !source) {
      setLifecycle('unavailable')
      return
    }
    setLifecycle('starting')
    const timer = window.setTimeout(() => setLifecycle('running'), 0)
    return () => window.clearTimeout(timer)
  }, [intent, source, reloadKey])

  useEffect(() => {
    const view = viewRef.current as (HTMLElement & { addEventListener: HTMLElement['addEventListener'] }) | null
    if (!view) return
    const onPermission = (event: Event): void => {
      const candidate = event as Event & { permission?: string; request?: { allow?: () => void; deny?: () => void } }
      const permission = candidate.permission as PortableKioskPwaIntent['requestedPermissions'][number] | undefined
      if (!permission || !intent?.requestedPermissions.includes(permission)) {
        candidate.request?.deny?.()
        event.preventDefault()
        return
      }
      // Permission grants are still denied by default. The host can add a reviewed confirmation
      // route later; this node must never turn a portable request into an ambient grant.
      candidate.request?.deny?.()
      event.preventDefault()
    }
    view.addEventListener('permissionrequest', onPermission as EventListener)
    return () => view.removeEventListener('permissionrequest', onPermission as EventListener)
  }, [intent, reloadKey])

  const stop = (): void => {
    setLifecycle('stopping')
    setReloadKey((value) => value + 1)
    setLifecycle('stopped')
  }

  const recover = (): void => {
    setLifecycle('starting')
    setReloadKey((value) => value + 1)
  }

  const headerFill = nodeHeaderFillStyle(data.color)
  const title = intent?.displayName || (data.title as string) || mapAroundExactFacts('Kiosk or PWA session', ['Kiosk', 'PWA'], vocab)
  const modeLabel = intent?.mode === 'pwa' ? mapAroundExactFacts('PWA mode', ['PWA'], vocab) : mapAroundExactFacts('Kiosk mode', ['Kiosk'], vocab)
  return (
    <div className={`term-node browser-node kiosk-pwa-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }}>
      <NodeResizer minWidth={NODE_MIN_SIZES.browser.width} minHeight={NODE_MIN_SIZES.browser.height} isVisible={selected} color={data.color} />
      <Handle id="flow-in" type="target" position={Position.Top} isConnectable={false} style={{ opacity: 0, pointerEvents: 'none', top: 0 }} />
      <div className={`term-node__header ${headerFill.className}${headerFill.filled ? ' term-node__header--filled' : ''}`} style={headerFill.style}>
        <span className="term-node__title-text" title={source}>{title}</span>
        <span className="kiosk-pwa-node__mode" aria-label={modeLabel}>{intent?.mode === 'pwa' ? 'PWA' : 'Kiosk'}</span>
        <span className="term-node__spacer" />
        <span className="kiosk-pwa-node__state" role="status">{lifecycle}</span>
        {(lifecycle === 'running' || lifecycle === 'starting') && <Button variant="outlined" size="small" className="kiosk-pwa-node__action" onClick={stop} title="Exit session">Exit</Button>}
        {(lifecycle === 'stopped' || lifecycle === 'unavailable' || lifecycle === 'error') && <Button variant="tonal" size="small" className="kiosk-pwa-node__action" vocabularyMode="factual" onClick={recover} title={vocab('Try session again')}>{vocab('Retry')}</Button>}
        <IconButton size="compact" className="term-node__close" icon="close" title="Close" aria-label="Close" onClick={() => deleteElements({ nodes: [{ id }] })} />
      </div>
      <div className="editor-node__body kiosk-pwa-node__body">
        {!intent && <div className="kiosk-pwa-node__message" role="alert">{mapAroundExactFacts('This session intent is unavailable. Recreate it from the kiosk or PWA setup.', ['kiosk', 'PWA'], vocab)}</div>}
        {intent && !source && <div className="kiosk-pwa-node__message" role="alert">{vocab('No secure target is available. Choose a URL or installed app again.')}</div>}
        {intent && source && (lifecycle === 'running' || lifecycle === 'starting') && (
          // eslint-disable-next-line react/no-unknown-property
          <webview key={`${profileId}:${reloadKey}`} ref={(element) => { viewRef.current = element }} src={source} partition={partition || undefined} allowpopups={false} style={{ width: '100%', height: '100%' }} />
        )}
        {lifecycle === 'stopped' && <div className="kiosk-pwa-node__message" role="status">{vocab('The session is stopped. Retry keeps the same local profile and portable intent.')}</div>}
        {lifecycle === 'unavailable' && <div className="kiosk-pwa-node__message" role="alert">{vocab('This session is unavailable on this host. Check the secure address or installed-app inventory, then retry.')}</div>}
        {lifecycle === 'error' && <div className="kiosk-pwa-node__message" role="alert">{vocab('The session could not start. Nothing was launched outside the selected target.')}</div>}
      </div>
    </div>
  )
}

export default KioskPwaNode
