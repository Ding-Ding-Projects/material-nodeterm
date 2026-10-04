import { memo, useCallback, useState } from 'react'
import {
  devPortUrl,
  forwardRefusalText,
  type DevPortForwardRequest,
  type DevPortForwardResult
} from '@shared/dev-ports'
import { devPortsSig, parseDevPortsSig, portRowLabel, type PortRow } from '../lib/devPorts'
import { scanDevPorts, useDevPorts } from '../state/devPorts'
import { sessionForProject } from '../session/session'
import { isBrowserRuntime } from '../bridge/runtime'
import { useLocalizedVocabularyText } from '../lib/personalVocabulary/useLocalizedVocabularyText'
import { Chip } from '../ui/md3'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { ConfirmDialog } from './ConfirmDialog'

function toast(message: string): void {
  window.dispatchEvent(new CustomEvent('nodeterm:toast', { detail: { kind: 'error', message } }))
}

interface Pending {
  message: string
  confirmLabel: string
  retry: Partial<DevPortForwardRequest>
  port: number
}

/**
 * The dev-server ports a node's session is listening on, drawn by the canvas node header AND the
 * kanban card modal — one component, so the two views of one session cannot disagree. Absent when
 * the session listens on no (non-ephemeral) port.
 *
 * A row opens the port in a browser node. On an SSH project it first forwards the SAME port over
 * the project's master, so `http://localhost:<port>` — the URL the tool itself printed — reaches the
 * host. A local port that is taken, or a privileged one, is never forwarded silently: the person
 * is asked, and a different local port is only ever their explicit choice.
 *
 * In a browser tab (Server Edition) the rows are informational: the page would load on the
 * VIEWER's machine, where the server's loopback port is not, and a browser tab has no browser
 * node. The list still tells the person what is running and where.
 */
export const PortsChip = memo(function PortsChip({
  nodeId,
  projectId,
  remote,
  onOpenUrl,
  menuZIndex = 70
}: {
  nodeId: string
  projectId: string
  /** The project is an SSH project: its ports are on the host and must be forwarded. */
  remote: boolean
  onOpenUrl: (url: string) => void
  menuZIndex?: number
}): React.JSX.Element | null {
  const text = useLocalizedVocabularyText()
  const sig = useDevPorts((s) => {
    const p = s.byProject[projectId]
    return devPortsSig(p?.nodes[nodeId], p?.forwards.filter((f) => f.nodeId === nodeId))
  })
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const browserTab = isBrowserRuntime()

  const forward = useCallback(
    async (req: DevPortForwardRequest): Promise<void> => {
      let result: DevPortForwardResult
      try {
        result = await sessionForProject(projectId).api.devPorts.forward(req)
      } catch {
        result = { ok: false, reason: 'forward-failed', message: forwardRefusalText('forward-failed', req.port) }
      }
      if (result.ok) {
        useDevPorts.getState().noteForward(projectId, { nodeId, remotePort: req.port, localPort: result.localPort })
        onOpenUrl(result.url)
        return
      }
      if (result.reason === 'privileged') {
        setPending({
          port: req.port,
          message: text(
            'devPorts.confirm.privileged',
            '{reason} Forward it to this computer anyway? Binding a port below 1024 may need administrator rights here.',
            { reason: result.message }
          ),
          confirmLabel: text('devPorts.confirm.forwardAnyway', 'Forward anyway'),
          retry: { ...req, allowPrivileged: true }
        })
        return
      }
      if (
        (result.reason === 'local-port-busy' || result.reason === 'local-port-denied') &&
        result.suggestedLocalPort !== undefined
      ) {
        const alt = String(result.suggestedLocalPort)
        setPending({
          port: req.port,
          message: text(
            'devPorts.confirm.otherPort',
            '{reason} Forward it to local port {alt} instead? Links the tool prints (http://localhost:{port}) will not reach it; use the browser node this opens.',
            { reason: result.message, alt, port: String(req.port) }
          ),
          confirmLabel: text('devPorts.confirm.usePort', 'Use port {alt}', { alt }),
          retry: { ...req, localPort: result.suggestedLocalPort }
        })
        return
      }
      if (result.reason === 'not-listening') void scanDevPorts(projectId, remote, 'user')
      toast(result.message)
    },
    [nodeId, onOpenUrl, projectId, remote, text]
  )

  const open = useCallback(
    (row: PortRow): void => {
      if (!remote) {
        onOpenUrl(devPortUrl(row.port))
        return
      }
      void forward({ projectId, nodeId, port: row.port })
    },
    [forward, nodeId, onOpenUrl, projectId, remote]
  )

  const rows = parseDevPortsSig(sig)
  const primary = rows.filter((r) => !r.ephemeral)
  const label =
    primary.length === 0
      ? null
      : primary.length === 1
        ? `:${primary[0].port}`
        : text('devPorts.chip.count', '{count} ports', { count: String(primary.length) })
  if (!label && !pending) return null

  const rowItems = (row: PortRow): MenuItem[] => {
    const port = String(row.port)
    if (browserTab) {
      return [
        {
          label: portRowLabel(row),
          vocabularyMode: 'factual',
          hint: text(
            'devPorts.row.browserTab',
            'Listening on the server. A browser tab cannot open the server’s localhost; open it on the server or from the desktop app.'
          ),
          disabled: true,
          onClick: () => {}
        }
      ]
    }
    const items: MenuItem[] = [
      {
        label: text('devPorts.row.open', 'Open {row}', { row: portRowLabel(row) }),
        hint: remote
          ? row.forwardedTo !== undefined
            ? text(
                'devPorts.row.openForwarded',
                'Forwarded to localhost:{local} on this computer; open it in a browser node',
                { local: String(row.forwardedTo) }
              )
            : text(
                'devPorts.row.openForward',
                'Forward port {port} from the server to the same port here, then open it in a browser node',
                { port }
              )
          : text('devPorts.row.openLocal', 'Open http://localhost:{port} in a browser node', { port }),
        onClick: () => open(row)
      }
    ]
    if (remote && row.forwardedTo !== undefined) {
      const localPort = row.forwardedTo
      items.push({
        label: text('devPorts.row.stop', 'Stop forwarding :{port}', { port }),
        hint: text('devPorts.row.stopHint', 'Close localhost:{local} on this computer', { local: String(localPort) }),
        onClick: () => {
          void sessionForProject(projectId)
            .api.devPorts.unforward({ projectId, localPort })
            .then(() => useDevPorts.getState().dropForward(projectId, localPort))
        }
      })
    }
    return items
  }
  const other = rows.filter((r) => r.ephemeral)
  const items: MenuItem[] = [
    {
      type: 'label',
      label: remote || browserTab
        ? text('devPorts.menu.server', 'Listening on the server')
        : text('devPorts.menu.session', 'Listening in this session')
    },
    ...primary.flatMap(rowItems)
  ]
  if (other.length > 0) {
    items.push({
      type: 'submenu',
      label: text('devPorts.menu.other', 'Other ports ({count})', { count: String(other.length) }),
      children: other.flatMap(rowItems)
    })
  }

  const stop = (e: React.SyntheticEvent): void => e.stopPropagation()
  const title = browserTab
    ? text('devPorts.chip.titleBrowser', 'Dev servers listening on the server; click to list them')
    : remote
      ? text('devPorts.chip.titleRemote', 'Dev servers listening on the server; click to forward and open')
      : text('devPorts.chip.titleLocal', 'Dev servers listening in this session; click to open')
  return (
    // Inside a draggable header and a clickable card: every event stops here.
    <span
      className="ports-chip-wrap"
      onClick={stop}
      onDoubleClick={stop}
      onMouseDown={stop}
      onPointerDown={stop}
      onContextMenu={stop}
      onKeyDown={stop}
    >
      {label && (
        <Chip
          className="ports-chip nodrag"
          vocabularyMode="factual"
          title={title}
          aria-label={text('devPorts.chip.aria', 'Listening ports: {ports}', { ports: label })}
          aria-pressed={undefined}
          aria-haspopup="menu"
          aria-expanded={!!menu}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            if (!menu) void scanDevPorts(projectId, remote, 'user')
            setMenu((cur) => (cur ? null : { x: r.left, y: r.bottom + 4 }))
          }}
        >
          {label}
        </Chip>
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} zIndex={menuZIndex} scroll items={items} onClose={() => setMenu(null)} />
      )}
      {pending && (
        <ConfirmDialog
          message={pending.message}
          confirmLabel={pending.confirmLabel}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const retry = pending.retry
            setPending(null)
            void forward({ projectId, nodeId, port: pending.port, ...retry })
          }}
        />
      )}
    </span>
  )
})
