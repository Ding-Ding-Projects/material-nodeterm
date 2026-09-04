import { useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import {
  PORTAL_RECOVERY_BOARD,
  createPortalRecoveryState,
  portalRecoveryProgressAfterCompletion,
  portalRecoveryReducer,
  sanitizePortalRecoveryProgress,
  type PortalRecoveryDirection,
  type PortalRecoveryState
} from '@shared/portal-recovery'
import type { CanvasNode } from '../state/workspace'
import { useSchoolMode } from '../state/schoolMode'
import { Button, IconButton } from '../ui/md3'
import { Input } from '../ui/Input'

function directionForDelta(dx: number, dy: number): PortalRecoveryDirection | null {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right'
  if (Math.abs(dy) > 0) return dy < 0 ? 'up' : 'down'
  return null
}

/**
 * A small, deterministic top-down recovery game. It is a recovery aid only: winning records
 * portable progress on the node and never unlocks an account, creates a session, or changes a
 * credential. The normal portal code/passphrase flow remains required after the game.
 */
export function PortalRecoveryNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { updateNodeData, deleteElements } = useReactFlow()
  const schoolMode = useSchoolMode((state) => state.enabled && state.hydrated)
  const [game, setGame] = useState<PortalRecoveryState>(() => createPortalRecoveryState())
  const [reducedMotion, setReducedMotion] = useState(false)
  const completionRecorded = useRef(false)
  const progress = useMemo(() => sanitizePortalRecoveryProgress(data.portalRecoveryProgress), [data.portalRecoveryProgress])

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(query.matches)
    sync()
    query.addEventListener?.('change', sync)
    return () => query.removeEventListener?.('change', sync)
  }, [])

  useEffect(() => {
    if (game.status !== 'completed' || completionRecorded.current) return
    completionRecorded.current = true
    updateNodeData(id, { portalRecoveryProgress: portalRecoveryProgressAfterCompletion(progress, game) })
  }, [game, id, progress, updateNodeData])

  const move = (direction: PortalRecoveryDirection) => {
    setGame((current) => portalRecoveryReducer(current, { type: 'move', direction }))
  }

  const reset = () => {
    completionRecorded.current = false
    setGame((current) => portalRecoveryReducer(current, { type: 'reset' }))
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keyMap: Record<string, PortalRecoveryDirection | undefined> = {
      ArrowUp: 'up',
      w: 'up',
      W: 'up',
      ArrowDown: 'down',
      s: 'down',
      S: 'down',
      ArrowLeft: 'left',
      a: 'left',
      A: 'left',
      ArrowRight: 'right',
      d: 'right',
      D: 'right'
    }
    const direction = keyMap[event.key]
    if (!direction) return
    event.preventDefault()
    event.stopPropagation()
    move(direction)
  }

  const status = schoolMode
    ? {
        ready: 'Ready. Use the arrow keys or controls to find all three energy keys.',
        playing: 'Find all three energy keys, then reach the core.',
        failed: 'Energy depleted. Restart the recovery game to try again.',
        completed: 'Core activated. This only records local progress; enter the normal portal code or passphrase next.'
      }[game.status]
    : {
        ready: 'Ready · 準備好。Find three energy keys, then activate the core.',
        playing: 'Find all three energy keys, then activate the core · 搵齊三條能量匙，再啟動核心。',
        failed: 'Energy depleted · 能量用完。Restart the game and try again.',
        completed: 'Core activated · 核心已啟動。This records progress only; use the normal portal code or passphrase next.'
      }[game.status]

  const cellLabels = useMemo(() => {
    const labels = new Map<string, string>()
    for (let y = 0; y < PORTAL_RECOVERY_BOARD.rows; y += 1) {
      for (let x = 0; x < PORTAL_RECOVERY_BOARD.columns; x += 1) {
        const keyIndex = PORTAL_RECOVERY_BOARD.keys.findIndex((key) => key.x === x && key.y === y)
        const hazard = PORTAL_RECOVERY_BOARD.hazards.some((point) => point.x === x && point.y === y)
        const player = game.position.x === x && game.position.y === y
        const parts = [`Cell ${x + 1}, ${y + 1}`]
        if (keyIndex >= 0 && !game.collected[keyIndex]) parts.push(`energy key ${keyIndex + 1}`)
        if (hazard) parts.push('hazard')
        if (x === PORTAL_RECOVERY_BOARD.core.x && y === PORTAL_RECOVERY_BOARD.core.y) parts.push('activation core')
        if (player) parts.push('you are here')
        labels.set(`${x}:${y}`, parts.join(', '))
      }
    }
    return labels
  }, [game.collected, game.position])

  return (
    <div className={`portal-recovery-node${selected ? ' selected' : ''}${reducedMotion ? ' reduce-motion' : ''}`}>
      <NodeResizer minWidth={460} minHeight={430} isVisible={selected} color={data.color} />
      <div className="portal-recovery-node__header" style={{ borderColor: data.color }}>
        <span className="term-node__color" style={{ background: data.color }} aria-hidden="true" />
        <Input
          className="mdx-input--bare term-node__title nodrag"
          value={data.title}
          spellCheck={false}
          aria-label="Portal recovery title"
          onChange={(event) => updateNodeData(id, { title: event.target.value })}
        />
        <span className="portal-recovery-node__badge">{game.energy}/3 energy</span>
        <IconButton size="compact" className="term-node__close" icon="close" title="Close" aria-label="Close portal recovery" onClick={() => deleteElements({ nodes: [{ id }] })} />
      </div>

      <div className="portal-recovery-node__body nodrag nowheel" tabIndex={0} onKeyDown={onKeyDown} role="group" aria-label="Portal recovery game">
        <div className="portal-recovery-node__intro">
          <strong>{schoolMode ? 'Portal recovery' : 'Portal recovery · 傳送門復原'}</strong>
          <span>{status}</span>
          <span className="portal-recovery-node__safety">
            This game never unlocks an account, bypasses a portal credential, or creates a session.
          </span>
        </div>
        <div
          className="portal-recovery-node__board"
          role="grid"
          aria-label="Top-down recovery map. Move one cell at a time."
          style={{ gridTemplateColumns: `repeat(${PORTAL_RECOVERY_BOARD.columns}, minmax(20px, 1fr))` }}
        >
          {Array.from({ length: PORTAL_RECOVERY_BOARD.rows * PORTAL_RECOVERY_BOARD.columns }, (_, index) => {
            const x = index % PORTAL_RECOVERY_BOARD.columns
            const y = Math.floor(index / PORTAL_RECOVERY_BOARD.columns)
            const keyIndex = PORTAL_RECOVERY_BOARD.keys.findIndex((key) => key.x === x && key.y === y)
            const hazard = PORTAL_RECOVERY_BOARD.hazards.some((point) => point.x === x && point.y === y)
            const isCore = PORTAL_RECOVERY_BOARD.core.x === x && PORTAL_RECOVERY_BOARD.core.y === y
            const isPlayer = game.position.x === x && game.position.y === y
            return (
              <Button
                variant="text"
                key={`${x}:${y}`}
                className={`portal-recovery-node__cell${isPlayer ? ' is-player' : ''}${hazard ? ' is-hazard' : ''}${isCore ? ' is-core' : ''}${keyIndex >= 0 && !game.collected[keyIndex] ? ' is-key' : ''}`}
                role="gridcell"
                aria-label={cellLabels.get(`${x}:${y}`)}
                onClick={() => {
                  const direction = directionForDelta(x - game.position.x, y - game.position.y)
                  if (direction) move(direction)
                }}
              >
                {isPlayer ? '◆' : keyIndex >= 0 && !game.collected[keyIndex] ? '⚿' : isCore ? '◎' : hazard ? '×' : ''}
              </Button>
            )
          })}
        </div>
        <div className="portal-recovery-node__legend" aria-label="Map legend">
          <span>◆ You</span><span>⚿ Energy key</span><span>× Hazard</span><span>◎ Core</span>
        </div>
        <div className="portal-recovery-node__controls" aria-label="Recovery controls">
          <Button variant="outlined" size="small" onClick={() => move('up')} disabled={game.status === 'completed'} aria-label="Move up">↑</Button>
          <Button variant="outlined" size="small" onClick={() => move('left')} disabled={game.status === 'completed'} aria-label="Move left">←</Button>
          <Button variant="outlined" size="small" onClick={() => move('down')} disabled={game.status === 'completed'} aria-label="Move down">↓</Button>
          <Button variant="outlined" size="small" onClick={() => move('right')} disabled={game.status === 'completed'} aria-label="Move right">→</Button>
          <Button variant="tonal" size="small" className="portal-recovery-node__reset" onClick={reset}>Restart</Button>
        </div>
        <div className="portal-recovery-node__progress" aria-live="polite">
          Keys: {game.collected.filter(Boolean).length}/3 · Moves: {game.moves}
          {progress.completed && ` · Best: ${progress.bestMoves ?? '—'} moves`}
        </div>
        <p className="portal-recovery-node__hint">Keyboard: Arrow keys or W A S D. Touch: use the controls or select a nearby cell. Reduced motion is respected.</p>
      </div>
    </div>
  )
}

export default PortalRecoveryNode
