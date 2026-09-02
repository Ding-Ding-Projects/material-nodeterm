import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNotifications, type AppNotification, type NotificationKind } from '../state/notifications'
import { Checkbox } from '@renderer/ui/md3'
import { Button, Chip, ChipRow, SearchField } from '../ui/md3'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { saveBlobDownload } from '../lib/exportSave'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { copy as copySegment, fact, mapOwnedSentence } from '../lib/personalVocabulary/ownedCopy'

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

export interface NotificationCopyView {
  title: string
  body?: string
}

export function mapNotificationCopy(n: AppNotification, vocab: (value: string) => string): NotificationCopyView {
  return {
    title: n.titleKind === 'authored' ? vocab(n.title) : n.title,
    body: n.bodyKind === 'authored' && n.body ? vocab(n.body) : n.body
  }
}

export function matchesQuery(n: AppNotification, q: string, vocab: (value: string) => string = (value) => value): boolean {
  if (!q.trim()) return true
  const copy = mapNotificationCopy(n, vocab)
  const s = q.toLowerCase()
  return copy.title.toLowerCase().includes(s) || (copy.body ?? '').toLowerCase().includes(s)
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

export function toMarkdown(items: AppNotification[]): string {
  return items
    .map((n) => {
      const state = n.dismissedAt == null ? 'active' : 'dismissed'
      return `- **[${n.kind}]** ${n.title}${n.body ? ` — ${n.body}` : ''} _(${state}, ${new Date(n.createdAt).toISOString()})_`
    })
    .join('\n')
}

export function notificationToExportRecord(
  n: AppNotification
): Record<string, unknown> {
  // Exports are durable records, not the private display boundary. Keep the stored title/body
  // and their ownership tags byte-identical, so a personal vocabulary never leaks into a file.
  return { ...n, actions: undefined }
}

function downloadText(filename: string, text: string, mime: string): void {
  saveBlobDownload(new Blob([text], { type: mime }), filename)
}

export interface NotificationCenterProps {
  onClose: () => void
  /** Open the stable destination carried by an actionable notification. */
  onGoToNode?: (nodeId: string) => void
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
  onGoToNode,
  onRequestBulkDelete
}: NotificationCenterProps): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const items = useNotifications((s) => s.items)
  const dismiss = useNotifications((s) => s.dismiss)
  const dismissMany = useNotifications((s) => s.dismissMany)
  const restore = useNotifications((s) => s.restore)
  const markAllRead = useNotifications((s) => s.markAllRead)

  const search = useRegexSearchField()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState<FilterKind>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    searchInputRef.current?.focus()
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const filtered = useMemo(
    () => items.filter((n) => {
      if (!matchesFilter(n, filter)) return false
      const copy = mapNotificationCopy(n, vocab)
      return search.test(`${copy.title} ${copy.body ?? ''}`)
    }),
    [items, filter, search, vocab]
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
            scoped.map((n) => notificationToExportRecord(n)),
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
      <div className="notif-center" data-easter-surface="notifications" onClick={(e) => e.stopPropagation()}>
        <div className="notif-center__head">
          <h2>{vocab('Notifications')}</h2>
          <Button variant="outlined" size="small" vocabularyMode="factual" className="drawer__close" onClick={onClose} aria-label={vocab('Close')}>
            ×
          </Button>
        </div>
        <div className="notif-center__search">
          <SearchField
            ref={searchInputRef}
            placeholder={search.mode === 'regex' ? 'Search notifications (regex)…' : 'Search notifications…'}
            value={search.value}
            onChange={(e) => search.setValue(e.target.value)}
            aria-label="Search notifications"
            trailingSlot={
            <AnchoredRegexBuilder search={search} fieldRef={searchInputRef} label="Regex — notification search" zIndex={93} />
          }
          />
          {search.error && <div className="notif-center__search-error" role="alert">{search.error}</div>}
          <ChipRow className="notif-center__filters" role="group" aria-label={vocab('Filter by kind')}>
            {FILTERS.map((f) => (
              <Chip key={f.id} selected={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </Chip>
            ))}
          </ChipRow>
        </div>
        <div className="notif-center__bulkbar">
          <Button variant="tonal" size="small" onClick={allFilteredSelected ? clearFilteredSelection : selectAllFiltered}>
            {allFilteredSelected
              ? vocab('Clear selection')
              : mapOwnedSentence(vocab, [copySegment('Select all ('), fact(String(filteredIds.length)), copySegment(')')])}
          </Button>
          <Button variant="tonal" size="small" vocabularyMode="factual" onClick={invertFilteredSelection} disabled={filteredIds.length === 0}>
            {vocab('Invert selection')}
          </Button>
          <Button variant="tonal" size="small" vocabularyMode="factual" onClick={bulkDismiss} disabled={selectedInFilter.length === 0}>
            {mapOwnedSentence(vocab, [copySegment('Dismiss ('), fact(String(selectedInFilter.length)), copySegment(')')])}
          </Button>
          <Button
            variant="outlined"
            size="small"
            danger
            vocabularyMode="factual"
            disabled={selectedInFilter.length === 0}
            onClick={(e) => onRequestBulkDelete(selectedInFilter, e.currentTarget)}
          >
            {mapOwnedSentence(vocab, [copySegment('Delete ('), fact(String(selectedInFilter.length)), copySegment(')')])}
          </Button>
          <Button
            variant="tonal"
            size="small"
            vocabularyMode="factual"
            onClick={bulkExport}
            title={vocab(
              'Click to export Markdown, Shift-click for JSON. Exports the selection, or the current filter if nothing is selected.'
            )}
          >
            {mapOwnedSentence(vocab, [
              copySegment('Export ('),
              fact(String(selectedInFilter.length > 0 ? selectedInFilter.length : filteredIds.length)),
              copySegment(')')
            ])}
          </Button>
          <Button variant="tonal" size="small" vocabularyMode="factual" onClick={() => markAllRead()} disabled={items.every((n) => n.read)}>
            {vocab('Mark all read')}
          </Button>
        </div>
        <div
          className="notif-center__list"
          role="listbox"
          aria-label={vocab('Notifications')}
          aria-multiselectable="true"
        >
          {filtered.length === 0 && (
            <div className="notif-center__empty">{vocab('No matching notifications.')}</div>
          )}
          {filtered.map((n) => {
            const notificationCopy = mapNotificationCopy(n, vocab)
            return (
            <div
              key={n.id}
              className={`notif-center__row${n.read ? '' : ' unread'}${n.deliveredSilently ? ' quieted' : ''}`}
              role="option"
              aria-selected={selected.has(n.id)}
              tabIndex={0}
              aria-label={`${notificationCopy.title}${n.read ? '' : ', unread'}${n.target ? ', action available' : ''}`}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return
                if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault()
                  toggleOne(n.id)
                }
              }}
            >
              <Checkbox
                checked={selected.has(n.id)}
                onChange={() => toggleOne(n.id)}
                aria-label={mapOwnedSentence(vocab, [copySegment('Select: '), fact(notificationCopy.title)])}
              />
              <div className="notif-center__row-body">
                <div className="notif-center__row-title">{notificationCopy.title}</div>
                {notificationCopy.body && <div className="notif-center__row-text">{notificationCopy.body}</div>}
                <div className="notif-center__row-meta">
                  <span>{n.kind}</span>
                  <span>{relTime(n.createdAt)}</span>
                  <span>{n.dismissedAt == null ? 'active' : 'dismissed'}</span>
                  {n.deliveredSilently && <span className="notif-center__row-quieted">quieted</span>}
                </div>
              </div>
              {n.target && onGoToNode && (
                <Button
                  variant="text"
                  size="small"
                  className="notif-center__row-action"
                  onClick={() => {
                    markAllRead([n.id])
                    onGoToNode(n.target!.nodeId)
                    onClose()
                  }}
                >
                  Open agent
                </Button>
              )}
              {n.dismissedAt == null ? (
                <Button variant="text" size="small" className="notif-center__row-action" onClick={() => dismiss(n.id)}>
                  Dismiss
                </Button>
              ) : (
                <Button variant="text" size="small" className="notif-center__row-action" onClick={() => restore(n.id)}>
                  Restore
                </Button>
              )}
              <Button
                variant="text"
                size="small"
                danger
                className="notif-center__row-action"
                title="Remove from history permanently"
                onClick={(e) => onRequestBulkDelete([n.id], e.currentTarget)}
              >
                Delete
              </Button>
            </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body
  )
}
