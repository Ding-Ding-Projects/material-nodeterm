import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Input } from '@renderer/ui/Input'
import { Button, IconButton } from '@renderer/ui/md3'
import type { KanbanColumn as KanbanColumnT } from '@shared/types'
import { NODE_COLORS } from '../../state/workspace'
import { SessionCard } from './SessionCard'
import type { KanbanCardMeta, KanbanLabel } from '@shared/types'
import type {
  KanbanCreateChoice,
  KanbanCreateOption,
  KanbanCreateSubmenuOption,
  KanbanSession
} from './KanbanView'
import type { GitHubIssueCardView } from '@shared/github-issues'
import { GitHubIssueCard } from './GitHubIssueCard'
import { useLocalizedVocabularyText } from '../../lib/personalVocabulary/useLocalizedVocabularyText'
import type { KanbanTerminalProfilePresentation } from './terminal-profile-ui'

interface KanbanColumnProps {
  /** null = the virtual Ungrouped column: fixed label, no rename/recolor/delete, header not draggable. */
  column: KanbanColumnT | null
  cards: KanbanSession[]
  githubCards?: GitHubIssueCardView[]
  githubColumns?: KanbanColumnT[]
  githubMoving?: Record<number, true>
  githubReadOnly?: boolean
  githubStatus?: Record<number, string>
  displayCount?: number
  // Column-scoped callbacks carry the column id (and card-scoped ones the node id) so KanbanView
  // can hand every column the SAME function references — that identity stability is what lets
  // memo() skip columns/cards untouched by a render.
  onRename?: (columnId: string, title: string) => void
  onRecolor?: (columnId: string, color: string) => void
  onDelete?: (columnId: string) => void
  /** Open a card's modal (↗ / double-click on the card). */
  onOpenCard: (nodeId: string) => void
  /** Card metadata lookup (assignees/due) for the chips on each card. */
  metaOf: (nodeId: string) => KanbanCardMeta | undefined
  /** Resolved board labels for a card (the colored label chips). */
  labelsOf: (nodeId: string) => KanbanLabel[]
  /** Stable machine-local profile lookup shared by every memoized column. */
  terminalProfileOf: (nodeId: string) => KanbanTerminalProfilePresentation | undefined
  /** "+ New" menu entries (agents, terminal, sticky) and what to do when one is picked
   *  (columnId null = Ungrouped: no assignment). */
  createOptions: KanbanCreateOption[]
  onCreate: (choice: KanbanCreateChoice, columnId: string | null) => void
  // Drag plumbing — the single drag source of truth lives in KanbanView.
  onCardDragStart: (nodeId: string) => void
  onColumnDragStart?: (columnId: string) => void
  onDragEnd: () => void
  /** Drop on the column body: a card lands at the END of this column; a column lands BEFORE it. */
  onDropOnColumn: (columnId: string | null) => void
  onDropAtCard: (columnId: string | null, nodeId: string, side: 'before' | 'after') => void
  /** Right-click on a card — bubbles the cursor position + node id up to the board menu. */
  onCardContext: (nodeId: string, x: number, y: number) => void
  onOpenGitHub?: (issue: GitHubIssueCardView) => void
  onMoveGitHub?: (issue: GitHubIssueCardView, columnId: string | null) => void
  onGitHubDragStart?: (issue: GitHubIssueCardView) => void
  onLoadMoreGitHub?: (columnId: string | null) => void
  hasMoreGitHub?: boolean
}

export const KanbanColumn = memo(function KanbanColumn({
  column, cards, githubCards = [], githubColumns = [], githubMoving = {}, displayCount, metaOf, labelsOf,
  githubReadOnly = false, githubStatus = {},
  onRename, onRecolor, onDelete, onOpenCard, onCardContext, onOpenGitHub, onMoveGitHub,
  onGitHubDragStart, onLoadMoreGitHub, hasMoreGitHub,
  createOptions, onCreate, onCardDragStart, onColumnDragStart, onDragEnd, onDropOnColumn,
  onDropAtCard, terminalProfileOf
}: KanbanColumnProps) {
  const profileText = useLocalizedVocabularyText()
  const [editingTitle, setEditingTitle] = useState(false)
  const [title, setTitle] = useState(column?.title ?? '')
  const [swatchesOpen, setSwatchesOpen] = useState(false)
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [activeCreateSubmenu, setActiveCreateSubmenu] = useState<string | null>(null)
  // The "+ New session" menu normally drops DOWN (top:100%); a column near the window's bottom edge
  // would push it off-screen, so we flip it UP when it doesn't fit below. Measured on open.
  const [menuUp, setMenuUp] = useState(false)
  const newMenuRef = useRef<HTMLDivElement>(null)
  const newMenuButtonRef = useRef<HTMLButtonElement>(null)
  const submenuBackRef = useRef<HTMLButtonElement>(null)
  const rootOptionRefs = useRef(new Map<string, HTMLButtonElement>())
  const restoreRootOptionRef = useRef<string | null>(null)
  // Trello-style drop highlight: counted enter/leave (dragleave fires when crossing children).
  const [dragOverCount, setDragOverCount] = useState(0)

  useLayoutEffect(() => {
    if (!newMenuOpen) {
      setMenuUp(false)
      return
    }
    const el = newMenuRef.current
    if (!el) return
    // Measured while rendered DOWN. If its bottom clears the viewport AND there's more room above
    // the trigger than below it, flip up. (getBoundingClientRect includes the current position.)
    const rect = el.getBoundingClientRect()
    const overflowsBelow = rect.bottom > window.innerHeight - 8
    const spaceAbove = rect.top // menu top ≈ just under the button
    const spaceBelow = window.innerHeight - rect.top
    if (overflowsBelow && spaceAbove > spaceBelow) setMenuUp(true)
    if (activeCreateSubmenu) {
      submenuBackRef.current?.focus()
    } else if (restoreRootOptionRef.current) {
      rootOptionRefs.current.get(restoreRootOptionRef.current)?.focus()
      restoreRootOptionRef.current = null
    }
  }, [newMenuOpen, activeCreateSubmenu])

  const colId = column?.id ?? null
  const activeSubmenu = createOptions.find(
    (option): option is KanbanCreateSubmenuOption =>
      option.type === 'submenu' && option.key === activeCreateSubmenu
  )
  const returnToCreateRoot = (): void => {
    if (activeCreateSubmenu) restoreRootOptionRef.current = activeCreateSubmenu
    setActiveCreateSubmenu(null)
  }
  const closeCreateMenu = (): void => {
    setActiveCreateSubmenu(null)
    setNewMenuOpen(false)
    newMenuButtonRef.current?.focus()
  }
  // Binds this column's id onto the shared card-drop handler; stable while the parent's is.
  const dropAtCard = useCallback(
    (nodeId: string, side: 'before' | 'after') => onDropAtCard(colId, nodeId, side),
    [onDropAtCard, colId]
  )

  const commitTitle = () => {
    const t = title.trim()
    if (column && t && t !== column.title) onRename?.(column.id, t)
    setEditingTitle(false)
  }

  return (
    <div
      className={`kanban-col${column ? '' : ' kanban-col--ungrouped'}${dragOverCount > 0 ? ' kanban-col--drop' : ''}`}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={() => setDragOverCount((c) => c + 1)}
      onDragLeave={() => setDragOverCount((c) => Math.max(0, c - 1))}
      onDrop={(e) => {
        e.preventDefault()
        setDragOverCount(0)
        onDropOnColumn(colId)
      }}
    >
      <div
        className="kanban-col__header"
        draggable={!!column}
        onDragStart={(e) => {
          if (!column) return
          e.dataTransfer.effectAllowed = 'move'
          onColumnDragStart?.(column.id)
        }}
        onDragEnd={onDragEnd}
      >
        {column ? (
          <button
            className="kanban-col__dot"
            style={{ background: column.color }}
            title="Column color"
            onClick={() => setSwatchesOpen((v) => !v)}
          />
        ) : (
          <span className="kanban-col__dot kanban-col__dot--ungrouped" />
        )}
        {column && editingTitle ? (
          <Input
            className="kanban-col__rename"
            vocabularyMode="factual"
            aria-label="Column title"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle()
              if (e.key === 'Escape') setEditingTitle(false)
            }}
          />
        ) : (
          <span
            className="kanban-col__title"
            onClick={() => {
              if (!column) return
              setTitle(column.title)
              setEditingTitle(true)
            }}
          >
            {column ? column.title : 'Ungrouped'}
          </span>
        )}
        <span className="kanban-col__count">{displayCount ?? cards.length + githubCards.length}</span>
        {column && (
          <IconButton size="dense"
            className="kanban-col__close"
            title="Delete column (cards return to Ungrouped)" aria-label="Delete column (cards return to Ungrouped)"
            onClick={() => onDelete?.(column.id)}
          >
            ✕
          </IconButton>
        )}
      </div>
      {column && swatchesOpen && (
        <div className="kanban-col__swatches">
          {NODE_COLORS.map((c) => (
            <button
              key={c}
              className="kanban-col__swatch"
              style={{ background: c }}
              onClick={() => {
                if (column) onRecolor?.(column.id, c)
                setSwatchesOpen(false)
              }}
            />
          ))}
        </div>
      )}
      <div className="kanban-col__cards">
        {cards.map((s) => (
          <SessionCard
            key={s.id}
            session={s}
            terminalProfile={terminalProfileOf(s.id)}
            meta={metaOf(s.id)}
            labels={labelsOf(s.id)}
            onOpen={onOpenCard}
            onContext={onCardContext}
            onDragStart={onCardDragStart}
            onDragEnd={onDragEnd}
            onDropAt={dropAtCard}
          />
        ))}
        {githubCards.map((issue) => (
          <GitHubIssueCard
            key={`github:${issue.id}`}
            issue={issue}
            columns={githubColumns}
            moving={!!githubMoving[issue.number]}
            readOnly={githubReadOnly}
            status={githubStatus[issue.number]}
            onOpen={(item) => onOpenGitHub?.(item)}
            onMove={(item, target) => onMoveGitHub?.(item, target)}
            onDragStart={(item) => onGitHubDragStart?.(item)}
            onDragEnd={onDragEnd}
          />
        ))}
        {hasMoreGitHub && (
          <Button variant="text" size="small" className="kanban-github-more" onClick={() => onLoadMoreGitHub?.(colId)}>
            Show more issues
          </Button>
        )}
      </div>
      <div className="kanban-col__footer">
        {newMenuOpen && (
          <div
            ref={newMenuRef}
            id={`kanban-new-menu-${colId ?? 'ungrouped'}`}
            className={menuUp ? 'kanban-col__newmenu kanban-col__newmenu--up' : 'kanban-col__newmenu'}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              if (activeSubmenu) returnToCreateRoot()
              else closeCreateMenu()
            }}
          >
            {activeSubmenu && (
              <button
                ref={submenuBackRef}
                className="kanban-col__newback"
                onClick={returnToCreateRoot}
              >
                <span aria-hidden>←</span>
                {profileText(
                  'terminalProfiles.create.backToNewSessions',
                  'Back to new sessions'
                )}
              </button>
            )}
            {(activeSubmenu?.children ?? createOptions).map((option) => {
              if (option.type === 'submenu') {
                return (
                  <button
                    key={option.key}
                    ref={(element) => {
                      if (element) rootOptionRefs.current.set(option.key, element)
                      else rootOptionRefs.current.delete(option.key)
                    }}
                    aria-haspopup="true"
                    aria-expanded={activeCreateSubmenu === option.key}
                    aria-controls={`kanban-new-menu-${colId ?? 'ungrouped'}`}
                    onClick={() => setActiveCreateSubmenu(option.key)}
                  >
                    <span className="kanban-col__newicon">{option.icon}</span>
                    <span className="kanban-col__newlabel">{option.label}</span>
                    <span className="kanban-col__newchevron" aria-hidden>›</span>
                  </button>
                )
              }
              return (
                <button
                  key={option.key}
                  aria-disabled={option.disabled || undefined}
                  title={option.hint}
                  onClick={() => {
                    if (option.disabled) return
                    closeCreateMenu()
                    onCreate(option.choice, colId)
                  }}
                >
                  <span className="kanban-col__newicon">{option.icon}</span>
                  <span className="kanban-col__newlabel">
                    {option.label}
                    {option.disabled && option.hint && (
                      <span className="kanban-col__newreason">{option.hint}</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <Button variant="tonal" size="small"
          ref={newMenuButtonRef}
          className="kanban-col__new"
          aria-expanded={newMenuOpen}
          aria-controls={`kanban-new-menu-${colId ?? 'ungrouped'}`}
          onClick={() => {
            setActiveCreateSubmenu(null)
            setNewMenuOpen((v) => !v)
          }}
        >
          + New session
        </Button>
      </div>
    </div>
  )
})
