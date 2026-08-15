// Reusable bulk-action toolbar for any list/table/grid in the app (see docs/bulk-actions.md).
// Shows the selection count, a select-all/invert/clear cluster, and the caller's own set of bulk
// actions. Every action click goes through a reviewable preview dialog before it runs (see
// ./BulkActionPreview) — "say what will happen before it happens" applies to every action here,
// destructive or not, though only destructive ones use a blocking confirmation.

import { useState } from 'react'
import { BulkActionPreview } from './BulkActionPreview'

export interface BulkAction<T> {
  id: string
  label: string
  /** True for delete/kill/similar irreversible actions — gets the blocking confirm + danger
   *  styling. Non-destructive actions (export, tag) still show the count/preview, just without a
   *  blocking gate — informational, per the app's non-blocking-notification convention. */
  destructive?: boolean
  /** Disabled entirely (not merely "will skip some rows") — e.g. no rows of a compatible kind are
   *  selected. Must name the reason; a disabled control with no explanation reads as broken. */
  disabledReason?: (selected: T[]) => string | null
  /** How each selected item will be described in the preview list. */
  describe: (item: T) => string
  /** Items this action would SKIP and why (e.g. "no node — nothing to end"), computed before the
   *  action runs so "42 selected" and "39 will change" can differ honestly. */
  excluded?: (items: T[]) => { item: T; reason: string }[]
  /** Run the action across the (already-filtered-for-exclusions) items. Report partial results
   *  via the returned promise; the caller renders them as a summary toast, not a claim that
   *  everything succeeded. */
  run: (items: T[]) => Promise<{ succeeded: T[]; failed: { item: T; reason: string }[] }>
}

export interface BulkActionBarProps<T> {
  /** Every currently-visible (filtered) item, in display order — the universe "select all" and
   *  "invert" operate over. See bulkSelection.ts on why this app has no separate "this page". */
  visible: T[]
  idOf: (item: T) => string
  selectedIds: ReadonlySet<string>
  onSelectAll: () => void
  onInvert: () => void
  onClear: () => void
  actions: BulkAction<T>[]
  /** Fired after an action's preview is confirmed and it finishes running, with the honest
   *  partial-result summary — the caller decides how to surface it (a toast, in this app's
   *  non-blocking-notification convention). */
  onActionComplete?: (actionId: string, result: { succeeded: T[]; failed: { item: T; reason: string }[] }) => void
}

export function BulkActionBar<T>({
  visible,
  idOf,
  selectedIds,
  onSelectAll,
  onInvert,
  onClear,
  actions,
  onActionComplete
}: BulkActionBarProps<T>): JSX.Element {
  const [pending, setPending] = useState<BulkAction<T> | null>(null)
  const [running, setRunning] = useState(false)

  const selectedItems = visible.filter((v) => selectedIds.has(idOf(v)))
  const count = selectedItems.length

  const startAction = (action: BulkAction<T>): void => {
    setPending(action)
  }

  const confirmAction = async (): Promise<void> => {
    if (!pending) return
    const action = pending
    setRunning(true)
    try {
      const excluded = action.excluded?.(selectedItems) ?? []
      const excludedIds = new Set(excluded.map((e) => idOf(e.item)))
      const runnable = selectedItems.filter((i) => !excludedIds.has(idOf(i)))
      const result = await action.run(runnable)
      onActionComplete?.(action.id, {
        succeeded: result.succeeded,
        // Merge the up-front exclusions into the failure list so the summary the caller renders
        // is complete: "N succeeded, M skipped, K failed" rather than silently dropping the
        // skipped-before-we-even-tried rows.
        failed: [...excluded, ...result.failed]
      })
    } finally {
      setRunning(false)
      setPending(null)
    }
  }

  return (
    <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
      <div className="bulk-bar__selection">
        <button
          type="button"
          className="bulk-bar__select-all"
          onClick={onSelectAll}
          disabled={visible.length === 0}
        >
          Select all ({visible.length} matching)
        </button>
        <button type="button" className="bulk-bar__invert" onClick={onInvert} disabled={visible.length === 0}>
          Invert
        </button>
        {count > 0 && (
          <button type="button" className="bulk-bar__clear" onClick={onClear}>
            Clear
          </button>
        )}
        <span className="bulk-bar__count" aria-live="polite">
          {count} selected
        </span>
      </div>
      {count > 0 && (
        <div className="bulk-bar__actions">
          {actions.map((action) => {
            const reason = action.disabledReason?.(selectedItems) ?? null
            return (
              <button
                key={action.id}
                type="button"
                className={`bulk-bar__action${action.destructive ? ' bulk-bar__action--danger' : ''}`}
                disabled={!!reason || running}
                title={reason ?? undefined}
                aria-disabled={!!reason}
                onClick={() => startAction(action)}
              >
                {action.label}
              </button>
            )
          })}
        </div>
      )}
      {pending && (
        <BulkActionPreview
          title={pending.label}
          items={selectedItems}
          describe={pending.describe}
          excluded={pending.excluded?.(selectedItems) ?? []}
          destructive={!!pending.destructive}
          busy={running}
          onConfirm={confirmAction}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  )
}
