import { Chip } from '@renderer/ui/md3'
export type KanbanSource = 'all' | 'github' | 'sessions'

export function KanbanSourceFilter({
  value,
  onChange
}: {
  value: KanbanSource
  onChange: (value: KanbanSource) => void
}): React.JSX.Element {
  return (
    <div className="kanban-source-filter" role="group" aria-label="Card source">
      {(['all', 'github', 'sessions'] as const).map((source) => (
        <Chip
          key={source}
          className={value === source ? 'kanban-source-filter__button is-active' : 'kanban-source-filter__button'}
          selected={value === source}
          onClick={() => onChange(source)}
        >
          {source === 'all' ? 'All' : source === 'github' ? 'GitHub' : 'Sessions'}
        </Chip>
      ))}
    </div>
  )
}
