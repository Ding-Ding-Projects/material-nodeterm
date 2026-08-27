// The panel behind the system-resource pill: which sessions are holding the machine's memory,
// biggest first, each one travelable and killable.
//
// Three rules run through the whole file, and each of them is a fact this feature exists to stop
// the app from getting wrong:
//   1. "We could not look" and "there is nothing" are DIFFERENT ANSWERS. A failed sweep says so —
//      it never degrades into an empty list, a `0 MB` total or a "0 sessions" count.
//   2. Orphan-ness comes from the resolved row, never from a missing agent state: a plain terminal
//      never enters the agent-status map at all.
//   3. Every row is rendered. A cap would have to announce itself.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentState } from '@shared/agents/normalize'
import { formatBytes } from '@shared/fsLimits'
import type { ExportTable } from '@shared/export'
import { buildTableExport } from '@shared/export'
import { useAgentStatus } from '../state/agentStatus'
import { useProjects } from '../state/projects'
import { useSessionMemory } from '../state/sessionMemory'
import { resolveSessionRows, totalMb, type SessionMemoryView } from '../lib/sessionMemoryRows'
import { usageScopeKey } from '../lib/usageScope'
import {
  clearSelection,
  emptySelection,
  invertSelection,
  isSelected,
  selectAll,
  selectRange,
  toggleOne,
  pruneSelection,
  type BulkSelectionState
} from '../lib/bulkSelection'
import { BulkActionBar, type BulkAction } from './BulkActionBar'
import { ExportMenu } from './ExportMenu'
import { Checkbox } from '@renderer/ui/md3'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'

export interface SessionMemoryPanelProps {
  /** Travel to the node behind a row. Canvas passes `travelToNode`, so a CLOSED project's tab is
   *  reopened first — the panel lists those sessions, so it has to be able to reach them. */
  onGoToNode: (nodeId: string) => void
  /** Confirm + end the session. `orphan` says whether the panel believes there is a node behind it;
   *  Canvas re-resolves the owner at click time and only uses this for the wording. */
  onKillSession: (nodeId: string, orphan: boolean) => void
  onClose: () => void
}

/** The panel as an exportable table — every column a row shows, so the export matches the screen.
 *  Bulk-select-and-export builds this from just the selected rows; the header's "Export…" builds
 *  it from every row CURRENTLY on screen (`measured` rows only — see the ExportMenu wiring below). */
function toExportTable(views: readonly SessionMemoryView[]): ExportTable {
  return {
    name: 'session_memory',
    columns: [
      { key: 'title', label: 'Title' },
      { key: 'command', label: 'Command' },
      { key: 'totalMb', label: 'Total MB' },
      { key: 'childrenMb', label: 'Children MB' },
      { key: 'childCount', label: 'Child processes' },
      { key: 'project', label: 'Project' },
      { key: 'orphan', label: 'Orphan (no node on any canvas)' },
      { key: 'session', label: 'tmux session' },
      { key: 'nodeId', label: 'Node id' }
    ],
    rows: views.map((v) => ({
      title: v.title,
      command: v.row.command,
      totalMb: v.row.totalMb,
      childrenMb: v.row.childrenMb,
      childCount: v.row.childCount,
      project: v.projectName,
      orphan: v.orphan,
      session: v.row.session,
      nodeId: v.row.nodeId
    }))
  }
}

/** Every number in this feature is MB; `formatBytes` speaks bytes. One formatter, so the panel's
 *  units read like the rest of the app. */
function formatMb(mb: number): string {
  return formatBytes(mb * 1024 * 1024)
}

/**
 * The node header's status vocabulary, as a dot: working is `--success`, waiting/blocked is
 * `--warn` (the two states the header spells RUNNING and NEEDS YOU), everything else is quiet.
 * Hollow = orphan: there is no node to have a state, and a filled neutral dot would read as "idle".
 */
function StatusDot({ state, hollow }: { state: AgentState | null; hollow: boolean }): JSX.Element {
  const kind =
    state === 'working' ? 'working' : state === 'waiting' || state === 'blocked' ? 'attention' : 'idle'
  return (
    <span
      className={`sessmem-row__dot md3-sessmem-dot sessmem-row__dot--${kind}${hollow ? ' sessmem-row__dot--hollow' : ''}`}
      aria-hidden
    />
  )
}

export function SessionMemoryPanel({
  onGoToNode,
  onKillSession,
  onClose
}: SessionMemoryPanelProps): JSX.Element {
  const vocab = useVocabularyMapper()
  const ok = useSessionMemory((s) => s.ok)
  const rows = useSessionMemory((s) => s.rows)
  const loading = useSessionMemory((s) => s.loading)
  const loadedScope = useSessionMemory((s) => s.loadedScope)
  const refreshFull = useSessionMemory((s) => s.refreshFull)

  // EVERY project, closed ones included: `closeProject` keeps the project and its nodes on disk
  // (only the tab goes away), so its sessions resolve to a real title. Filtering to the open tabs
  // here would turn every deliberately parked session into an orphan.
  const projects = useProjects((s) => s.projects)
  const activeProjectId = useProjects((s) => s.activeProjectId)
  const active = useMemo(
    () => projects.find((p) => p.id === activeProjectId),
    [projects, activeProjectId]
  )
  const scopeKey = usageScopeKey(active)
  // A relay tab's renderer runs on the GUEST while its sessions live on the host, so its
  // sessionMemory api is the ws-bridge stub — a permanent `ok:false`. That is the honest stub value
  // and the wrong story to tell a human: nothing failed and there is nothing to retry. The runtime
  // `remote` flag is how the rest of the renderer spots a relay tab (see TerminalNode's file links).
  const relay = !!active?.remote

  const byId = useAgentStatus((s) => s.byId)
  // `resolveSessionRows` wants the bare states; an entry's `state` is optional, and an unknown one
  // is null rather than a default.
  const states = useMemo(
    () => Object.fromEntries(Object.entries(byId).map(([id, v]) => [id, v.state])),
    [byId]
  )
  const views = useMemo(
    () => resolveSessionRows(rows, projects, states),
    [rows, projects, states]
  )

  // Bulk selection (see docs/bulk-actions.md). Keyed by nodeId — `resolveSessionRows` gives an
  // orphan row its session name as a stand-in id (`SessionMemoryRow.nodeId` is always populated),
  // so it stays a stable key across a sweep even for a row with no canvas node behind it.
  const [selection, setSelection] = useState<BulkSelectionState>(emptySelection())
  const visibleIds = useMemo(() => views.map((v) => v.row.nodeId), [views])
  // A refresh can drop a row (the session ended elsewhere) — prune rather than let a stale id
  // linger in the "N selected" count forever.
  useEffect(() => {
    setSelection((s) => pruneSelection(s, visibleIds))
  }, [visibleIds])
  const [exportResult, setExportResult] = useState<string | null>(null)

  const bulkActions: BulkAction<SessionMemoryView>[] = useMemo(
    () => [
      {
        id: 'export-selected',
        label: vocab('Export selected (CSV)'),
        describe: (v) => `${v.title} — ${formatMb(v.row.totalMb)}`,
        run: async (items) => {
          const built = buildTableExport(toExportTable(items), 'csv')
          const result = await window.nodeTerminal.export.saveText(built.filename, built.content, built.mimeType)
          if (!result.ok) {
            if (result.canceled) return { succeeded: [], failed: [] }
            return {
              succeeded: [],
              failed: items.map((item) => ({ item, reason: result.error ?? vocab('Save failed.') }))
            }
          }
          return { succeeded: items, failed: [] }
        }
      }
    ],
    [vocab]
  )

  // The sweep runs on OPEN (the panel is unmounted while closed) and on ⟳ — never on a timer, and
  // never from the pill: it walks the whole process table, and on an SSH scope that is an ssh exec
  // plus a `ps` of somebody else's machine. The project id is explicit, because the store's
  // `activeSessionApi()` fallback is the one path that can address the wrong machine — so BOTH
  // callers go through this one guarded function instead of each repeating the condition.
  //
  // This component must NEVER call `startHostPoll` / `stopHostPoll`: the store's timer and its
  // active-scope stamp are module singletons owned by the pill, and a `stopHostPoll` on unmount
  // would clear the pill's interval with nothing left to restart it.
  const sweep = useCallback(() => {
    if (relay || !activeProjectId) return
    void refreshFull(scopeKey, activeProjectId)
  }, [relay, scopeKey, activeProjectId, refreshFull])
  useEffect(() => sweep(), [sweep])

  // Have we got an answer for THIS machine yet? A `loadedScope` from the machine we just left says
  // nothing about this one, so it is compared, not merely checked for existence.
  const measured = ok && loadedScope === scopeKey

  let body: JSX.Element
  if (relay) {
    body = (
      <div className="sessmem-panel__note md3-sessmem-note">
        {vocab('Session memory is not available on a relay tab — these sessions run on the other machine.')}
      </div>
    )
  } else if (!ok) {
    // Rendering an empty list here would report "nothing is using memory" at exactly the moment we
    // failed to measure it.
    body = <div className="sessmem-panel__note md3-sessmem-note">{vocab('Could not measure sessions on this machine.')}</div>
  } else if (!measured) {
    body = <div className="sessmem-panel__note md3-sessmem-note">{vocab('Measuring…')}</div>
  } else if (views.length === 0) {
    // We looked, and there really is nothing — a different sentence from the two above.
    body = <div className="sessmem-panel__note md3-sessmem-note">{vocab('No sessions are running here.')}</div>
  } else {
    body = (
      <>
        <div className="sessmem-panel__export md3-sessmem-export">
          <ExportMenu kind="tabular" label={vocab('session memory')} build={(format) => buildTableExport(toExportTable(views), format)} />
        </div>
        <BulkActionBar<SessionMemoryView>
          visible={views}
          idOf={(v) => v.row.nodeId}
          selectedIds={selection.selected}
          onSelectAll={() => setSelection(selectAll(visibleIds))}
          onInvert={() => setSelection(invertSelection(selection, visibleIds))}
          onClear={() => setSelection(clearSelection())}
          actions={bulkActions}
          onActionComplete={(_id, result) => {
            const parts: string[] = []
            if (result.succeeded.length > 0) parts.push(`${result.succeeded.length} ${vocab('exported')}`)
            if (result.failed.length > 0) parts.push(`${result.failed.length} ${vocab('failed')}`)
            setExportResult(parts.length > 0 ? parts.join(', ') : null)
            if (parts.length > 0) setTimeout(() => setExportResult(null), 6000)
          }}
        />
        {exportResult && (
          <div className="sessmem-panel__toast md3-sessmem-toast" role="status" aria-live="polite">
            {exportResult}
          </div>
        )}
      <ul className="sessmem-panel__rows md3-sessmem-rows">
        {/* Every row, in core's order (already sorted by total, descending). */}
        {views.map((v) => (
          <li key={v.row.session} className="sessmem-row md3-sessmem-row">
            <Checkbox
              className="sessmem-row__select md3-sessmem-row__select"
              checked={isSelected(selection, v.row.nodeId)}
              aria-label={`${vocab('Select')} ${v.title}`}
              onClick={(e) => {
                if (e.shiftKey) {
                  setSelection((s) => selectRange(s, v.row.nodeId, visibleIds))
                } else {
                  setSelection((s) => toggleOne(s, v.row.nodeId))
                }
              }}
              // The checkbox's own click already toggled the selection above; onChange would
              // fire a second, redundant toggle on some browsers' checkbox semantics.
              onChange={() => {}}
            />
            <button
              className="sessmem-row__main md3-sessmem-row__main"
              // Nothing to travel to. The guard inside is not redundant: `disabled` is the DOM's
              // answer and this is the code's.
              disabled={v.orphan}
              onClick={() => {
                if (v.orphan) return
                onGoToNode(v.row.nodeId)
                onClose()
              }}
              title={v.orphan ? vocab('No node on any canvas') : `${vocab('Go to')} ${v.title}`}
            >
              <StatusDot state={v.state} hollow={v.orphan} />
              <span className="sessmem-row__title md3-sessmem-row__title">{v.title}</span>
              {v.orphan ? (
                <span className="sessmem-row__orphan md3-sessmem-chip">{vocab('no node')}</span>
              ) : (
                v.projectId !== activeProjectId && (
                  <span className="sessmem-row__project md3-sessmem-chip">{v.projectName}</span>
                )
              )}
              <span className="sessmem-row__cmd md3-sessmem-row__cmd">{v.row.command}</span>
              <span className="sessmem-row__mb md3-sessmem-row__mb">{formatMb(v.row.totalMb)}</span>
            </button>
            <button
              className="sessmem-row__kill md3-sessmem-row__kill"
              title={vocab('End this session')}
              aria-label={`${vocab('End')} ${v.title}`}
              onClick={() => onKillSession(v.row.nodeId, v.orphan)}
            >
              ×
            </button>
            {v.row.childCount > 0 && (
              // "child processes", NOT "MCP servers": `pane_pid` is the pane's SHELL, so the count
              // is the agent CLI itself plus everything it spawned. A claude session with two MCP
              // servers reads as 3, and a plain `npm run dev` has children too.
              <div className="sessmem-row__kids md3-sessmem-row__kids">
                └ +{v.row.childCount} {vocab('child processes')} <span>{formatMb(v.row.childrenMb)}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
      </>
    )
  }

  return (
    <div className="sessmem-panel md3-sessmem-panel" id="sessmem-panel" role="region" aria-label={vocab('Session memory')}>
      <div className="sessmem-panel__head md3-sessmem-head">
        <span className="sessmem-panel__title md3-sessmem-title">{vocab('Session memory')}</span>
        {/* Which machine these numbers describe. The SSH panel is visually identical to the local
            one, so the scope has to be written down. */}
        <span className="sessmem-panel__scope md3-sessmem-scope">{scopeKey || vocab('This machine')}</span>
        {/* No total unless we measured one: a grand total of `0 MB` beside a failure is the exact
            conflation this panel exists to end. */}
        {measured && <span className="sessmem-panel__total md3-sessmem-total">{formatMb(totalMb(views))}</span>}
      </div>

      {body}

      {/* Whose memory this is. The feature exists because a user reported "Claude terminals are
          killing my memory" — their NUMBER was right and their attribution was wrong: it is the
          agent CLI's own V8 heap, and nodeterm allocates none of it. Showing those numbers inside
          nodeterm's chrome with nothing said about it lets the panel repeat the mistake it was
          built to correct. One line, no figures: the measurements vary per machine and per model,
          and quoting one here would age into a lie (docs/session-memory.md §1 has them). */}
      <div className="sessmem-panel__attrib md3-sessmem-attrib">
        {vocab("Memory held by each session's own processes — the agent CLI and what it spawned, not nodeterm itself.")}
      </div>

      <div className="sessmem-panel__foot md3-sessmem-foot">
        <span className="sessmem-panel__count md3-sessmem-count">
          {measured ? `${views.length} ${vocab(views.length === 1 ? 'session' : 'sessions')}` : ''}
        </span>
        {/* A relay tab has nothing to retry — the answer is a stub, not a failure. */}
        {!relay && (
          <button
            className={`sessmem-panel__refresh md3-sessmem-refresh${loading ? ' spin' : ''}`}
            title={vocab('Re-measure')}
            aria-label={vocab('Re-measure')}
            disabled={loading}
            onClick={sweep}
          >
            ⟳
          </button>
        )}
      </div>
    </div>
  )
}
