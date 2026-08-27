import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { NODE_MIN_SIZES } from '../lib/nodeSizing'
import { reportsOwnCopy } from '@shared/agents/config'
import type { AgentId } from '@shared/agents/config'
import { useSession } from '../session/session'
import { useSettings } from '../state/settings'
import { LocalTransport } from '../terminal/local-transport'
import { parseOsc52 } from '../terminal/osc52'
import { activateUnicode11 } from '../terminal/unicode-width'
import { useCopyFeedback } from '../terminal/useCopyFeedback'
import {
  attachReplay,
  cursorPlacementSeq,
  seedPaint,
  stripTrailingNewline,
  terminalKeyAction,
  toXtermText,
  xtermOptionsFromSettings,
  SHIFT_ENTER_SEQ,
  CO_ATTACH_MOUSE_SEQ
} from '../terminal/terminal-config'
import { resolveSshRemote, reportSshDrop } from './TerminalNode'
import { buildSshArgs } from '@shared/ssh'
import { travelToNode } from './travel-handler'
import type { CanvasNode } from '../state/workspace'
import type { CanvasNodeState, Project } from '@shared/types'

/** B-side context for one derived foreign projection. It is transient React Flow data, never a
 * project-file record. */
export interface XProjectSpawn {
  bProjectId: string
  bNodeId: string
  bNode: CanvasNodeState
  bProject: Project
}

export function XProjectNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { api } = useSession()
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const transportRef = useRef<LocalTransport | null>(null)
  const spawn = data.xprojSpawn as XProjectSpawn | undefined
  const originName = String(data.xprojOriginName ?? spawn?.bProject.name ?? '')
  const originColor = String(data.xprojOriginColor ?? spawn?.bProject.color ?? '#8e8e93')
  const copy = useCopyFeedback({
    hostRef,
    hasSelection: () => !!termRef.current?.hasSelection(),
    enabled: !reportsOwnCopy(
      ((spawn?.bNode as CanvasNodeState & { agentBaseId?: AgentId }).agentBaseId ??
        spawn?.bNode.agentId) as AgentId | undefined
    )
  })
  const [retry, setRetry] = useState(0)
  const [plate, setPlate] = useState<'no-session' | 'ssh' | 'closed' | null>('no-session')

  useEffect(() => {
    if (!spawn || !hostRef.current) return
    const { bProjectId, bNodeId, bNode, bProject } = spawn
    const viewerId = `xproj-${bProjectId}-${bNodeId}-${Math.random().toString(36).slice(2, 8)}`
    const transport = new LocalTransport(api, viewerId)
    const term = new Terminal(xtermOptionsFromSettings(useSettings.getState().settings))
    const fit = new FitAddon()
    activateUnicode11(term)
    term.loadAddon(fit)
    termRef.current = term
    fitRef.current = fit
    transportRef.current = transport
    term.open(hostRef.current)
    fit.fit()

    let sessionId: string | null = null
    let disposed = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const cleanups: Array<() => void> = []
    const attempt = retry

    term.parser.registerOscHandler(52, (oscData) => {
      const text = parseOsc52(oscData)
      if (text !== null) {
        window.nodeTerminal.clipboard.writeText(text)
        copy.notifyCopy(text)
      }
      return true
    })
    term.attachCustomKeyEventHandler((event) => {
      const action = terminalKeyAction(event, term.hasSelection(), false)
      if (action === 'pass') return true
      event.preventDefault()
      if (action === 'copy') window.nodeTerminal.clipboard.writeText(term.getSelection())
      else if (action === 'shift-enter' && sessionId) transport.write(sessionId, SHIFT_ENTER_SEQ)
      return false
    })

    void (async () => {
      const sshRemote = bProject.ssh
        ? await resolveSshRemote(bProject.ssh.server, bNode.cwd)
        : undefined
      if (disposed) return
      if (bProject.ssh && !sshRemote) {
        setPlate('ssh')
        reportSshDrop(bProjectId, bNodeId)
        return
      }
      const localSsh = !!bNode.ssh && !bNode.sshRemoteTmux && !bProject.ssh
      const result = await transport.create({
        cols: term.cols,
        rows: term.rows,
        shell: localSsh ? 'ssh' : bNode.shell,
        shellArgs: localSsh ? buildSshArgs(bNode.ssh!) : undefined,
        cwd: bNode.cwd,
        persistKey: bNodeId,
        ownerProjectId: bProjectId,
        agentId: bNode.agentId,
        agentModel: bNode.agentModel,
        accountId: bNode.accountId,
        sshRemote,
        requireRemote: !!bProject.ssh,
        requireExisting: true
      })
      if (disposed) {
        if (result.sessionId) transport.kill(result.sessionId)
        return
      }
      if (result.unavailable === 'no-session') {
        setPlate('no-session')
        if (attempt < 15) retryTimer = setTimeout(() => setRetry((value) => value + 1), 2000)
        return
      }
      if (result.unavailable === 'ssh') {
        setPlate('ssh')
        reportSshDrop(bProjectId, bNodeId)
        return
      }
      if (result.closed) {
        setPlate('closed')
        return
      }
      sessionId = result.sessionId
      setPlate(null)
      cleanups.push(transport.onData(sessionId, (chunk) => term.write(chunk)))
      cleanups.push(transport.onExit(sessionId, () => term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n')))
      if (transport.onSize) cleanups.push(transport.onSize(sessionId, (size) => term.resize(size.cols, size.rows)))
      term.onData((chunk) => sessionId && transport.write(sessionId, chunk))
      const paint = seedPaint({
        replay: attachReplay({ parked: false, fresh: result.fresh, hasInitialCommand: false }),
        superseded: false,
        snapshot: null,
        screen: result.screen
      })
      if (paint === 'create-screen' && result.screen) {
        term.write('\x1b[0m' + toXtermText(stripTrailingNewline(result.screen)))
        term.write(cursorPlacementSeq(result.cursor))
      }
      if (result.coAttachMouse) term.write(CO_ATTACH_MOUSE_SEQ)
      const resizeObserver = new ResizeObserver(() => {
        fit.fit()
        if (sessionId) transport.resize(sessionId, term.cols, term.rows)
      })
      resizeObserver.observe(hostRef.current!)
      cleanups.push(() => resizeObserver.disconnect())
      transport.resize(sessionId, term.cols, term.rows)
      term.focus()
    })()

    return () => {
      disposed = true
      cleanups.forEach((cleanup) => cleanup())
      if (retryTimer) clearTimeout(retryTimer)
      if (sessionId) transport.kill(sessionId)
      term.dispose()
      termRef.current = null
      fitRef.current = null
      transportRef.current = null
    }
    // The projection identity and bounded retry counter are the only lifecycle inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, id, retry, spawn])

  return (
    <div className={`xproj-node${selected ? ' selected' : ''}`} style={{ '--xproj-stroke': originColor } as CSSProperties}>
      <NodeResizer isVisible={selected} minWidth={NODE_MIN_SIZES.terminal.width} minHeight={NODE_MIN_SIZES.terminal.height} color={originColor} />
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="xproj-node__header nodrag">
        <span className="xproj-node__origin" style={{ color: originColor }}>
          <span className="xproj-node__dot" style={{ background: originColor }} />
          {originName}
        </span>
        <span className="xproj-node__title">{String(data.title || 'projection')}</span>
        <button
          className="xproj-node__jump"
          title={`Open in ${originName}`}
          aria-label={`Open ${String(data.title || 'projection')} in ${originName}`}
          onClick={(event) => {
            event.stopPropagation()
            if (spawn) travelToNode(spawn.bNodeId)
          }}
        >
          ↗
        </button>
      </div>
      <div className="xproj-node__body nodrag nowheel" ref={hostRef} />
      {plate && (
        <div className="xproj-node__plate">
          {plate === 'no-session' && `${originName}'s session is not live yet. Open ${originName} and this view will connect.`}
          {plate === 'ssh' && `Not connected to ${originName}'s host. Nothing was started; reconnect and retry.`}
          {plate === 'closed' && `${originName}'s session was closed by another user.`}
        </div>
      )}
    </div>
  )
}
