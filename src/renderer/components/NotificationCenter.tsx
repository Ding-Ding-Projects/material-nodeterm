import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNotifications, type AppNotification, type NotificationKind } from '../state/notifications'
import { Checkbox } from '@renderer/ui/md3'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'

type FilterKind = 'all' | 'unread' | NotificationKind

const FILTERS: { id: FilterKind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'info', label: 'Info' },
  { id: 'success', label: 'Success' },
  { id: 'progress', label: 'In progress' },
  { id: 'warning', label: 'Warning' },
  { id: 'error', label: 'Error' }
]

function matchesFilter(n: AppNotification, f: FilterKind): boolean {
  if (f === 'all') return true
  if (f === 'unread') return !n.read
  return n.kind === f
}

function matchesQuery(n: AppNotification, q: string): boolean {
  if (!q.trim()) return true
  const s = q.toLowerCase()
  return n.title.toLowerCase().includes(s) || (n.body ?? '').toLowerCase().includes(s)
}

function relTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function toMarkdown(items: AppNotification[]): string {
  return items
    .map((n) => {
      const state = n.dismissedAt == null ? 'active' : 'dismissed'
      return `- **[${n.kind}]** ${n.title}${n.body ? ` — ${n.body}` : ''} _(${state}, ${new Date(n.createdAt).toISOString()})_`
    })
    .join('\n')
}

function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the click a tick to start before revoking, then release the blob URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export interface NotificationCenterProps {
  onClose: () => void
  /** Bulk-delete is destructive (permanently removes history) and goes through the app's
   *  super-confirmation gate, anchored beside the button that requested it. */
  onRequestBulkDelete: (ids: string[], anchorEl: HTMLElement) => void
}

/**
 * The notification history/centre — every notification ever pushed this session, dismissed or
 * not, reviewable, searchable, and actionable in bulk. See docs/notifications.md.
 */
export function NotificationCenter({
  onClose,
  onRequestBulkDelete
}: NotificationCenterProps): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const items = useNotifications((s) => s.items)
  const dismiss = useNotifications((s) => s.dismiss)
  const dismissMany = useNotifications((s) => s.dismissMany)
  const restore = useNotifications((s) => s.restore)
  const markAllRead = useNotifications((s) => s.markAllRead)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterKind>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const filtered = useMemo(
    () => items.filter((n) => matchesFilter(n, filter) && matchesQuery(n, query)),
    [items, filter, query]
  )
  const filteredIds = useMemo(() => filtered.map((n) => n.id), [filtered])
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id))
  const selectedInFilter = filteredIds.filter((id) => selected.has(id))

  const toggleOne = (id: string): void => {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Honestly scoped: this button always names exactly what it acts on — every notification
  // currently matching the search + filter, never a hidden "everything, filtered or not" set.
  const selectAllFiltered = (): void => {
    setSelected((s) => {
      const next = new Set(s)
      filteredIds.forEach((id) => next.add(id))
      return next
    })
  }
  const clearFilteredSelection = (): void => {
    setSelected((s) => {
      const next = new Set(s)
      filteredIds.forEach((id) => next.delete(id))
      return next
    })
  }
  const invertFilteredSelection = (): void => {
    setSelected((s) => {
      const next = new Set(s)
      filteredIds.forEach((id) => (next.has(id) ? next.delete(id) : next.add(id)))
      return next
    })
  }

  const bulkDismiss = (): void => {
    dismissMany(selectedInFilter)
  }
  const bulkExport = (e: React.MouseEvent): void => {
    // Export the SELECTED subset when there is one, else the whole active filter — either way it
    // is exactly what's on screen (or explicitly checked), never the unfiltered full history.
    const scope = selectedInFilter.length > 0 ? selectedInFilter : filteredIds
    const scoped = items.filter((n) => scope.includes(n.id))
    const format = e.shiftKey ? 'json' : 'md'
    if (format === 'json') {
      downloadText(
        `notifications-${Date.now()}.json`,
        JSON.stringify(
          scoped.map((n) => ({ ...n, actions: undefined })),
          null,
          2
        ),
        'application/json'
      )
    } else {
      downloadText(`notifications-${Date.now()}.md`, toMarkdown(scoped), 'text/markdown')
    }
  }

  return createPortal(
    <div className="drawer-overlay" onClick={onClose}>
      <div className="notif-center" onClick={(e) => e.stopPropagation()}>
        <div className="notif-center__head">
          <h2>{vocab('Notifications')}</h2>
          <button className="drawer__close" onClick={onClose} aria-label={vocab('Close')}>
            ×
          </button>
        </div>
        <div className="notif-center__search">
          <input
            type="search"
            placeholder="Search notifications…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={vocab('Search notifications')}
          />
          <div className="notif-center__filters" role="group" aria-label="Filter by kind">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                className={`notif-center__filter${filter === f.id ? ' active' : ''}`}
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="notif-center__bulkbar">
          <button onClick={allFilteredSelected ? clearFilteredSelection : selectAllFiltered}>
            {allFilteredSelected ? 'Clear selection' : `Select all (${filteredIds.length})`}
          </button>
          <button onClick={invertFilteredSelection} disabled={filteredIds.length === 0}>
            Invert selection
          </button>
          <button onClick={bulkDismiss} disabled={selectedInFilter.length === 0}>
            Dismiss ({selectedInFilter.length})
          </button>
          <button
            className="danger"
            disabled={selectedInFilter.length === 0}
            onClick={(e) => onRequestBulkDelete(selectedInFilter, e.currentTarget)}
          >
            Delete ({selectedInFilter.length})
          </button>
          <button
            onClick={bulkExport}
            title="Click to export Markdown, Shift-click for JSON. Exports the selection, or the current filter if nothing is selected."
          >
            Export ({selectedInFilter.length > 0 ? selectedInFilter.length : filteredIds.length})
          </button>
          <button onClick={() => markAllRead()} disabled={items.every((n) => n.read)}>
            Mark all read
          </button>
        </div>
        <div className="notif-center__list" role="listbox" aria-label="Notifications" aria-multiselectable="true">
          {filtered.length === 0 && <div className="notif-center__empty">No matching notifications.</div>}
          {filtered.map((n) => (
            <div
              key={n.id}
              className={`notif-center__row${n.read ? '' : ' unread'}${n.deliveredSilently ? ' quieted' : ''}`}
              role="option"
              aria-selected={selected.has(n.id)}
            >
              <Checkbox
                checked={selected.has(n.id)}
                onChange={() => toggleOne(n.id)}
                aria-label={`Select: ${n.title}`}
              />
              <div className="notif-center__row-body">
                <div className="notif-center__row-title">{n.title}</div>
                {n.body && <div className="notif-center__row-text">{n.body}</div>}
                <div className="notif-center__row-meta">
                  <span>{n.kind}</span>
                  <span>{relTime(n.createdAt)}</span>
                  <span>{n.dismissedAt == null ? 'active' : 'dismissed'}</span>
                  {n.deliveredSilently && <span className="notif-center__row-quieted">quieted</span>}
                </div>
              </div>
              {n.dismissedAt == null ? (
                <button className="notif-center__row-dismiss" onClick={() => dismiss(n.id)}>
                  Dismiss
                </button>
              ) : (
                <button className="notif-center__row-dismiss" onClick={() => restore(n.id)}>
                  Restore
                </button>
              )}
              <button
                className="notif-center__row-dismiss"
                title="Remove from history permanently"
                onClick={(e) => onRequestBulkDelete([n.id], e.currentTarget)}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}
