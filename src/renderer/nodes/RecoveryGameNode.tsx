import { useMemo, useRef, type KeyboardEvent } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { useNotifications } from '../state/notifications'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import {
  RECOVERY_BOARD_HEIGHT,
  RECOVERY_BOARD_WIDTH,
  RECOVERY_CORE,
  RECOVERY_ENERGY_KEYS,
  RECOVERY_KEY_POSITIONS,
  activateRecoveryCore,
  canRecoveryStep,
  createRecoveryGameSnapshot,
  moveRecoveryGame,
  normalizeRecoveryGameSnapshot,
  recoveryCellKind,
  recoveryCoreDisabledReason,
  recoveryKeyAt,
  type RecoveryGameSnapshot,
  type RecoveryMove,
  type RecoveryPoint,
  type RecoveryTransition
} from '@shared/recovery-game'
import { Button, IconButton } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'

export function pointLabel(point: RecoveryPoint, snapshot: RecoveryGameSnapshot): string {
  const kind = recoveryCellKind(point)
  const parts = [`Column ${point.x + 1}, row ${point.y + 1}`]
  if (snapshot.player.x === point.x && snapshot.player.y === point.y) parts.push('player')
  if (kind === 'hazard') parts.push('hazard')
  if (kind === 'core') parts.push(snapshot.coreActivated ? 'activation core online' : 'activation core')
  const key = recoveryKeyAt(point)
  if (key) parts.push(snapshot.energizedKeys.includes(key) ? `${key} energy key energized` : `${key} energy key`)
  if (kind === 'start') parts.push('start')
  return parts.join(', ')
}

export function recoveryMeta(snapshot: RecoveryGameSnapshot, vocab: (value: string) => string): string {
  return `${vocab('Hazard contacts:')} ${snapshot.hazardHits}. ${vocab('Energized keys:')} ${snapshot.energizedKeys.length} ${vocab('of 3.')}`
}

function transitionNotice(transition: RecoveryTransition, title: string, vocab: (value: string) => string): void {
  if (transition.event === 'key-energized') {
    useNotifications.getState().push({
      kind: 'success',
      title: vocab('Energy key energized'),
      body: `${title} ${vocab('energized the')} ${transition.energyKey} ${vocab('key')}. ${transition.snapshot.energizedKeys.length} ${vocab('of 3 keys are online.')}`,
      autoDismissMs: 6000
    })
  } else if (transition.event === 'hazard-hit') {
    useNotifications.getState().push({
      kind: 'warning',
      title: vocab('Hazard contact'),
      body: vocab('The player returned to the start. Energized keys were preserved.'),
      autoDismissMs: null
    })
  } else if (transition.event === 'core-activated') {
    useNotifications.getState().push({
      kind: 'success',
      title: vocab('Activation core online'),
      body: `${title} ${vocab('completed the recovery run with all three energy keys.')}`,
      autoDismissMs: 9000
    })
  } else if (transition.event === 'core-ready') {
    useNotifications.getState().push({
      kind: 'info',
      title: vocab('Activation core ready'),
      body: vocab('All three energy keys are online. Activate the core to finish the recovery run.'),
      autoDismissMs: 6000
    })
  }
}

export default function RecoveryGameNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { updateNodeData, deleteElements } = useReactFlow()
  const vocab = useVocabularyMapper()
  const boardSearch = useRegexSearchField()
  const boardSearchRef = useRef<HTMLInputElement>(null)
  const snapshot = normalizeRecoveryGameSnapshot(data.recoveryGame ?? createRecoveryGameSnapshot())
  const headerFill = nodeHeaderFillStyle(data.color)
  const coreReason = recoveryCoreDisabledReason(snapshot)
  const localizedCoreReason = coreReason === 'The activation core is already online.'
    ? vocab(coreReason)
    : coreReason?.startsWith('Energize ')
      ? `${vocab('Energize')} ${snapshot.energizedKeys.length === 2 ? 1 : RECOVERY_ENERGY_KEYS.length - snapshot.energizedKeys.length} ${vocab(snapshot.energizedKeys.length === 2 ? 'more energy key before activating the core.' : 'more energy keys before activating the core.')}`
      : coreReason
        ? vocab(coreReason)
        : null

  const commit = (next: RecoveryGameSnapshot) => updateNodeData(id, { recoveryGame: next })
  const move = (direction: RecoveryMove) => {
    const transition = moveRecoveryGame(snapshot, direction)
    if (transition.event !== 'blocked') commit(transition.snapshot)
    transitionNotice(transition, String(data.title || vocab('Recovery game')), vocab)
  }
  const moveTo = (point: RecoveryPoint) => {
    if (!canRecoveryStep(snapshot.player, point)) return
    if (point.x < snapshot.player.x) move('left')
    else if (point.x > snapshot.player.x) move('right')
    else if (point.y < snapshot.player.y) move('up')
    else move('down')
  }
  const activate = () => {
    const transition = activateRecoveryCore(snapshot)
    commit(transition.snapshot)
    transitionNotice(transition, String(data.title || vocab('Recovery game')), vocab)
  }
  const reset = () => {
    commit(createRecoveryGameSnapshot())
    useNotifications.getState().push({
      kind: 'info',
      title: vocab('Recovery game reset'),
      body: vocab('The board is back at the start. Energize all three keys to try again.'),
      autoDismissMs: 5000
    })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction: Record<string, RecoveryMove | undefined> = {
      ArrowUp: 'up', w: 'up', W: 'up',
      ArrowDown: 'down', s: 'down', S: 'down',
      ArrowLeft: 'left', a: 'left', A: 'left',
      ArrowRight: 'right', d: 'right', D: 'right'
    }
    const next = direction[event.key]
    if (next) {
      event.preventDefault()
      event.stopPropagation()
      move(next)
    } else if (event.key === 'Enter' && coreReason === null) {
      event.preventDefault()
      event.stopPropagation()
      activate()
    }
  }

  const status = snapshot.coreActivated
    ? vocab('Activation core online. Recovery complete.')
    : localizedCoreReason ?? vocab('Activation core ready. Press Enter or choose Activate core.')
  const matchingCells = useMemo(() => {
    let count = 0
    for (let y = 0; y < RECOVERY_BOARD_HEIGHT; y += 1) {
      for (let x = 0; x < RECOVERY_BOARD_WIDTH; x += 1) {
        if (boardSearch.test(pointLabel({ x, y }, snapshot))) count += 1
      }
    }
    return count
  }, [boardSearch, snapshot])
  const statusId = `${id}-recovery-status`

  return (
    <section className={`term-node recovery-game-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }} aria-label={vocab('Top-down recovery game')}>
      <NodeResizer minWidth={480} minHeight={520} isVisible={selected} color={data.color} />
      <div className={`term-node__header ${headerFill.className}${headerFill.filled ? ' term-node__header--filled' : ''}`} style={headerFill.style}>
        <span className="recovery-game-node__glyph" aria-hidden="true">◇</span>
        <EditableNodeTitle value={String(data.title ?? '')} onChange={(title) => updateNodeData(id, { title })} emptyLabel={vocab('Recovery game')} title={vocab('Click to rename')} ariaLabel={vocab('Recovery game node name')} rejectEmpty={false} />
        <span className="term-node__spacer" />
        <IconButton size="compact" className="term-node__close" icon="close" vocabularyMode="factual" title={vocab('Close')} aria-label={vocab('Close recovery game')} onClick={() => void deleteElements({ nodes: [{ id }] })} />
      </div>

      <div className="recovery-game-node__body nodrag nowheel">
        <div className="recovery-game-node__mission">
          <strong>{vocab('Recovery mission')}</strong>
          <span>{vocab('Energize all three keys, avoid hazards, then stand on the core and activate it.')}</span>
        </div>

        <div className="recovery-game-node__search">
          <label htmlFor={`${id}-recovery-search`}>{vocab('Find a board location')}</label>
          <div className="recovery-game-node__search-row">
            <Input
              type="search"
              vocabularyMode="factual"
              id={`${id}-recovery-search`}
              ref={boardSearchRef}
              value={boardSearch.value}
              onChange={(event) => boardSearch.setValue(event.target.value)}
              placeholder={vocab('Plain text search')}
              aria-label={vocab('Find a board location')}
            />
            <AnchoredRegexBuilder search={boardSearch} fieldRef={boardSearchRef} label={vocab('Regex for recovery board')} />
          </div>
          <span className="recovery-game-node__search-count" role="status">{vocab(`${matchingCells} board locations match`)}</span>
          {boardSearch.error && <span className="recovery-game-node__search-error" role="alert">{vocab(boardSearch.error)}</span>}
        </div>

        <div className="recovery-game-node__keys" aria-label={vocab('Energy key status')}>
          {RECOVERY_ENERGY_KEYS.map((key) => (
            <span key={key} className={snapshot.energizedKeys.includes(key) ? 'is-online' : ''}>
              <span aria-hidden="true">{snapshot.energizedKeys.includes(key) ? '◆' : '◇'}</span>
              {vocab(key)}
            </span>
          ))}
        </div>

        <div
          className="recovery-game-node__board"
          role="grid"
          aria-label={vocab('Recovery board. Use arrow keys or W A S D to move.')}
          aria-describedby={statusId}
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight W A S D"
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          {Array.from({ length: RECOVERY_BOARD_HEIGHT }, (_, y) =>
            Array.from({ length: RECOVERY_BOARD_WIDTH }, (_, x) => {
              const point = { x, y }
              const kind = recoveryCellKind(point)
              const key = recoveryKeyAt(point)
              const isPlayer = snapshot.player.x === x && snapshot.player.y === y
              const enabled = !snapshot.coreActivated && canRecoveryStep(snapshot.player, point)
              const keyOnline = key ? snapshot.energizedKeys.includes(key) : false
              const matchesSearch = boardSearch.test(pointLabel(point, snapshot))
              const classes = [
                'recovery-game-node__cell',
                `is-${kind}`,
                isPlayer ? 'is-player' : '',
                keyOnline ? 'is-online' : '',
                boardSearch.active && matchesSearch ? 'is-search-match' : '',
                snapshot.coreActivated && x === RECOVERY_CORE.x && y === RECOVERY_CORE.y ? 'is-activated' : ''
              ].filter(Boolean).join(' ')
              return (
                <button
                  type="button"
                  role="gridcell"
                  aria-rowindex={y + 1}
                  aria-colindex={x + 1}
                  key={`${x}:${y}`}
                  className={classes}
                  aria-label={pointLabel(point, snapshot)}
                  aria-describedby={statusId}
                  aria-current={isPlayer ? 'true' : undefined}
                  disabled={!enabled}
                  title={enabled ? `${vocab('Move to')} column ${x + 1}, row ${y + 1}` : pointLabel(point, snapshot)}
                  onClick={() => moveTo(point)}
                >
                  <span aria-hidden="true">
                    {isPlayer ? '●' : key ? (keyOnline ? '◆' : '◇') : kind === 'hazard' ? '×' : kind === 'core' ? '◎' : kind === 'start' ? '⌂' : ''}
                  </span>
                </button>
              )
            })
          )}
        </div>

        <div className="recovery-game-node__controls" aria-label={vocab('Movement controls')}>
          <IconButton size="compact" vocabularyMode="factual" aria-label={vocab('Move up')} onClick={() => move('up')} disabled={snapshot.coreActivated || snapshot.player.y === 0} aria-describedby={statusId} title={vocab(snapshot.player.y === 0 ? 'The top edge blocks this move.' : 'Move up')}>↑</IconButton>
          <IconButton size="compact" vocabularyMode="factual" aria-label={vocab('Move left')} onClick={() => move('left')} disabled={snapshot.coreActivated || snapshot.player.x === 0} aria-describedby={statusId} title={vocab(snapshot.player.x === 0 ? 'The left edge blocks this move.' : 'Move left')}>←</IconButton>
          <IconButton size="compact" vocabularyMode="factual" aria-label={vocab('Move down')} onClick={() => move('down')} disabled={snapshot.coreActivated || snapshot.player.y === RECOVERY_BOARD_HEIGHT - 1} aria-describedby={statusId} title={vocab(snapshot.player.y === RECOVERY_BOARD_HEIGHT - 1 ? 'The bottom edge blocks this move.' : 'Move down')}>↓</IconButton>
          <IconButton size="compact" vocabularyMode="factual" aria-label={vocab('Move right')} onClick={() => move('right')} disabled={snapshot.coreActivated || snapshot.player.x === RECOVERY_BOARD_WIDTH - 1} aria-describedby={statusId} title={vocab(snapshot.player.x === RECOVERY_BOARD_WIDTH - 1 ? 'The right edge blocks this move.' : 'Move right')}>→</IconButton>
           <Button variant="filled" size="small" vocabularyMode="factual" className="recovery-game-node__activate" onClick={activate} disabled={coreReason !== null} aria-describedby={statusId} title={localizedCoreReason ?? vocab('Activate the core')}>{vocab('Activate core')}</Button>
          <Button variant="outlined" size="small" vocabularyMode="factual" className="recovery-game-node__reset" onClick={reset} aria-describedby={statusId} title={vocab('Reset the recovery game')}>{vocab('Reset game')}</Button>
        </div>

         <p id={statusId} className="recovery-game-node__status" role="status" aria-live="polite">{status}</p>
         <p className="recovery-game-node__meta">{recoveryMeta(snapshot, vocab)}</p>
      </div>
    </section>
  )
}
