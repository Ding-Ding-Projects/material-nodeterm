import { Chip } from '@renderer/ui/md3'
import { useLocalizedVocabularyText } from '../../lib/personalVocabulary/useLocalizedVocabularyText'

/** Where a board card comes from: everything, or exactly one source. Pull requests are a source of
 *  their own because they are read-only on the board (no drag, no move control). */
export type KanbanSource = 'all' | 'github' | 'pulls' | 'sessions'

const SOURCES: ReadonlyArray<{ id: KanbanSource; textId: string; label: string }> = [
  { id: 'all', textId: 'kanban.source.all', label: 'All' },
  { id: 'github', textId: 'kanban.source.issues', label: 'Issues' },
  { id: 'pulls', textId: 'kanban.source.pulls', label: 'Pull requests' },
  { id: 'sessions', textId: 'kanban.source.sessions', label: 'Sessions' }
]

/** Does the current filter show this source's cards? */
export function sourceVisible(filter: KanbanSource, id: Exclude<KanbanSource, 'all'>): boolean {
  return filter === 'all' || filter === id
}

export function KanbanSourceFilter({
  value,
  onChange
}: {
  value: KanbanSource
  onChange: (value: KanbanSource) => void
}): React.JSX.Element {
  const text = useLocalizedVocabularyText()
  return (
    <div className="kanban-source-filter" role="group" aria-label={text('kanban.source.label', 'Card source')}>
      {SOURCES.map((source) => (
        <Chip
          key={source.id}
          className={value === source.id ? 'kanban-source-filter__button is-active' : 'kanban-source-filter__button'}
          selected={value === source.id}
          vocabularyMode="factual"
          onClick={() => onChange(source.id)}
        >
          {text(source.textId, source.label)}
        </Chip>
      ))}
    </div>
  )
}
