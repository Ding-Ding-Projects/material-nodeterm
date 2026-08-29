import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import type { CanvasNodeState, Project } from '@shared/types'
import { useSession } from '../session/session'
import { useSettings } from '../state/settings'
import { LocalTransport } from '../terminal/local-transport'
import {
  CO_ATTACH_MOUSE_SEQ,
  attachReplay,
  cursorPlacementSeq,
  seedPaint,
  stripTrailingNewline,
  toXtermText,
  xtermOptionsFromSettings
} from '../terminal/terminal-config'
import { activateUnicode11 } from '../terminal/unicode-width'
import { quantizeCharSize } from '../terminal/char-size-quantize'
import { parseOsc52 } from '../terminal/osc52'
import { travelToNode } from './travel-handler'
import type { CanvasNode } from '../state/workspace'

/** The owning project and node context carried by a render-only foreign projection. */
export interface XProjectSpawn {
  bProjectId: string
  bNodeId: string
  bNode: CanvasNodeState
  bProject: Pick<Project, 'id' | 'name' | 'color' | 'cwd' | 'ssh' | 'remote' | 'closed' | 'unavailable'>
}

type ProjectionState = 'connecting' | 'ready' | 'no-session' | 'closed' | 'ssh' | 'remote' | 'missing'

/**
 * A live, non-owning view of a terminal from another project. The node is supplied by Canvas as a
 * render-only projection. It uses a distinct viewer id and `requireExisting`, so a missing target
 * session is reported and retried rather than silently spawning a new owner in the foreign project.
 */
export function XProjectNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { api } = useSession()
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const transportRef = useRef<LocalTransport | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ProjectionState>('connecting')
  const spawn = data.xprojSpawn as XProjectSpawn | undefined
  const project = spawn?.bProject
  const originName = (data.xprojOriginName as string | undefined) ?? project?.name ?? 'Project'
  const originColor = (data.color as string | undefined) ?? project?.color ?? '#8e8e93'

  useEffect(() => {
    if (!spawn || !project || project.unavailable || project.closed) {
      setState(spawn ? 'missing' : 'connecting')
      return
    }
    if (project.ssh) {
      setState('ssh')
      return
    }
    if (project.remote) {
      setState('remote')
      return
    }
    let disposed = false
    let sessionId: string | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const cleanups: Array<() => void> = []
    const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const viewerId = `xproj-${spawn.bProjectId}-${spawn.bNodeId}-${nonce.slice(0, 8)}`
    const transport = new LocalTransport(api, viewerId)
    const settings = useSettings.getState().settings
    const term = new Terminal(xtermOptionsFromSettings(settings))
    const fit = new FitAddon()
    term.loadAddon(fit)
    activateUnicode11(term)
    terminalRef.current = term
    transportRef.current = transport

    const retryLater = (): void => {
      if (disposed || attempt >= 15) return
      retryTimer = setTimeout(() => setAttempt((value) => value + 1), 2000)
    }

    term.open(hostRef.current!)
    quantizeCharSize(term)
    fit.fit()
    term.parser.registerOscHandler(52, (value) => {
      const text = parseOsc52(value)
      if (text !== null) window.nodeTerminal.clipboard.writeText(text)
      return true
    })

    void transport
      .create({
        cols: term.cols,
        rows: term.rows,
        cwd: spawn.bNode.cwd,
        shell: spawn.bNode.shell,
        persistKey: spawn.bNodeId,
        ownerProjectId: spawn.bProjectId,
        agentId: spawn.bNode.agentId,
        agentBaseId: spawn.bNode.agentBaseId,
        agentModel: spawn.bNode.agentModel,
        accountId: spawn.bNode.accountId,
        requireExisting: true
      })
      .then((result) => {
        if (disposed) {
          if (result.sessionId) transport.kill(result.sessionId)
          return
        }
        if (result.unavailable === 'no-session') {
          setState('no-session')
          retryLater()
          return
        }
        if (result.unavailable === 'ssh') {
          setState('ssh')
          return
        }
        if (result.closed) {
          setState('closed')
          return
        }
        sessionId = result.sessionId
        setState('ready')
        cleanups.push(transport.onData(sessionId, (value) => term.write(value)))
        cleanups.push(transport.onExit(sessionId, () => setState('closed')))
        if (transport.onSize) {
          cleanups.push(transport.onSize(sessionId, (size) => term.resize(size.cols, size.rows)))
        }
        const input = term.onData((value) => transport.write(sessionId!, value))
        cleanups.push(() => input.dispose())
        if (result.screen) {
          const paint = seedPaint({
            replay: attachReplay({ parked: false, fresh: result.fresh, hasInitialCommand: false }),
            superseded: false,
            screen: result.screen
          })
          if (paint === 'create-screen') {
            term.write('\x1b[0m' + toXtermText(stripTrailingNewline(result.screen)))
            term.write(cursorPlacementSeq(result.cursor))
          }
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
      })
      .catch(() => {
        if (!disposed) {
          setState('no-session')
          retryLater()
        }
      })

    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      cleanups.forEach((cleanup) => cleanup())
      if (sessionId) transport.kill(sessionId)
      term.dispose()
      terminalRef.current = null
      transportRef.current = null
    }
  }, [api, attempt, id, project, spawn])

  const message =
    state === 'no-session'
      ? `${originName}'s session is not live yet. Open the owning project to start it.`
      : state === 'ssh'
        ? `${originName} is remote and is not available for a local projection.`
        : state === 'remote'
          ? `${originName} is a relay project and is not available for a local projection.`
        : state === 'closed'
          ? `${originName}'s session was closed.`
          : state === 'missing'
            ? 'The referenced project or node is unavailable.'
            : undefined

  return (
    <div
      className={`xproj-node${selected ? ' selected' : ''}`}
      style={{ '--xproj-stroke': originColor } as React.CSSProperties}
      aria-label={`${originName} projection`}
    >
      <NodeResizer isVisible={selected} minWidth={360} minHeight={220} color={originColor} />
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="xproj-node__header nodrag">
        <span className="xproj-node__origin" style={{ color: originColor }}>
          <span className="xproj-node__dot" style={{ background: originColor }} />
          {originName}
        </span>
        <span className="xproj-node__title">{(data.title as string | undefined) || 'Projection'}</span>
        <button
          className="xproj-node__jump"
          type="button"
          title={`Open ${originName}`}
          aria-label={`Open ${originName}`}
          onClick={(event) => {
            event.stopPropagation()
            if (spawn) travelToNode(spawn.bNodeId)
          }}
        >
          ↗
        </button>
      </div>
      <div className="xproj-node__body nodrag nowheel" ref={hostRef} />
      {message && <div className="xproj-node__plate">{message}</div>}
    </div>
  )
}
