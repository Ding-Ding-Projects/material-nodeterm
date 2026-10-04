import { useCallback, useEffect, useRef, useState } from 'react'
import { MANUAL_UPDATE_STEPS, type UpdatePrepInspection } from '@shared/update-prep'
import { useI18n } from '@renderer/lib/i18n'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { Button, Dialog } from '@renderer/ui/md3'
import { useAgentStatus } from '../state/agentStatus'
import { agentUpdateExitFn } from '../terminal/agent-restart'
import { mapTemplate } from './UpdateCard'
import {
  planUpdatePrep,
  updatePrepStopSummary,
  type PrepCopy,
  type PrepNode,
  type PrepRow,
  type UpdatePrepPlan
} from '../lib/updatePrep'

// Prepare-for-update (Windows session host; ported from upstream, issue #829 there). Updates install
// while the session host keeps running from its own staged copy, but that host keeps its OLDER
// version until it stops. This dialog ends it on purpose, WITHOUT deleting a node:
//   1. list every session the host holds (all projects, closed ones too) and refuse while any agent
//      is working or waiting on the user; each one is listed with a "Go" button;
//   2. ask each idle, resumable agent on a mounted node to quit cleanly (`/exit`, `/quit`, ...);
//   3. say plainly what still stops (shells, unreachable agents) and confirm, Cancel focused;
//   4. ask the host to end every session and exit (`shutdown`), confirm it is gone, then quit.
// A host from an older build cannot shut itself down: the dialog shows the manual steps instead.
// There is no path here that kills the host process or ends a session through node deletion.

type Phase =
  | { k: 'inspecting' }
  | { k: 'inspected'; inspection: UpdatePrepInspection; plan: UpdatePrepPlan | null }
  | { k: 'exiting'; done: number; total: number }
  | { k: 'confirm'; plan: UpdatePrepPlan; exited: number }
  | { k: 'shutting' }
  | { k: 'failed'; message: PrepCopy }

interface Props {
  /** Every terminal node in every project (closed ones included), the active one committed. */
  collectNodes: () => PrepNode[]
  onTravel: (nodeId: string) => void
  onClose: () => void
}

function planFor(inspection: UpdatePrepInspection, nodes: PrepNode[]): UpdatePrepPlan | null {
  if (inspection.kind !== 'host') return null
  const byId = useAgentStatus.getState().byId
  return planUpdatePrep({
    sessions: inspection.sessions,
    nodes,
    statusOf: (id) => byId[id],
    mirrorOf: (session) => inspection.mirror[session],
    canExitInPlace: (id) => !!agentUpdateExitFn(id)
  })
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function PrepareUpdateDialog({ collectNodes, onTravel, onClose }: Props): JSX.Element {
  const [phase, setPhase] = useState<Phase>({ k: 'inspecting' })
  const busyRef = useRef(false)
  const { t } = useI18n()
  const vocab = useVocabularyMapper()
  /** Authored copy through the catalog and the personal vocabulary; inserted values (counts, node
   *  titles, error text) stay factual and untouched. */
  const say = (c: PrepCopy): string => mapTemplate(t(c.id, c.fallback).primary, c.params ?? {}, vocab)
  const text = (id: string, fallback: string, params?: Record<string, string>): string =>
    say({ id, fallback, params })

  const inspect = useCallback(async (): Promise<{
    inspection: UpdatePrepInspection
    plan: UpdatePrepPlan | null
  }> => {
    const inspection = await window.nodeTerminal.updates
      .prepareInspect()
      .catch((e: unknown): UpdatePrepInspection => ({ kind: 'error', error: errorText(e) }))
    return { inspection, plan: planFor(inspection, collectNodes()) }
  }, [collectNodes])

  const refresh = useCallback(async () => {
    setPhase({ k: 'inspecting' })
    const r = await inspect()
    setPhase({ k: 'inspected', ...r })
  }, [inspect])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const working = phase.k === 'exiting' || phase.k === 'shutting'
  const close = useCallback(() => {
    if (!working) onClose()
  }, [working, onClose])

  const quit = useCallback(() => window.nodeTerminal.updates.prepareQuit(), [])

  /** Step 2: clean exits, one node at a time (each is a choreography in its own pane). Then the
   *  host is asked again (something may have started working meanwhile) before the confirm. */
  const runExits = useCallback(
    async (plan: UpdatePrepPlan) => {
      if (busyRef.current) return
      busyRef.current = true
      try {
        let exited = 0
        const total = plan.toExit.length
        setPhase({ k: 'exiting', done: 0, total })
        for (const [i, row] of plan.toExit.entries()) {
          const fn = row.node ? agentUpdateExitFn(row.node.nodeId) : undefined
          const outcome = fn ? await fn().catch(() => 'not-eligible' as const) : 'not-eligible'
          if (outcome === 'exited') exited++
          setPhase({ k: 'exiting', done: i + 1, total })
        }
        const r = await inspect()
        if (
          r.inspection.kind !== 'host' ||
          !r.plan ||
          r.plan.blocking.length > 0 ||
          !r.inspection.shutdownSupported
        ) {
          setPhase({ k: 'inspected', ...r })
          return
        }
        setPhase({ k: 'confirm', plan: r.plan, exited })
      } finally {
        busyRef.current = false
      }
    },
    [inspect]
  )

  /** Step 4: the host ends every session and exits; only a confirmed exit quits the app. */
  const shutdown = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setPhase({ k: 'shutting' })
    try {
      const outcome = await window.nodeTerminal.updates.prepareShutdownHost()
      switch (outcome.kind) {
        case 'shut-down':
        case 'no-host':
          quit()
          return
        case 'failed':
          setPhase({
            k: 'failed',
            message: {
              id: 'updatePrep.failed.failed',
              fallback: 'The session host could not end every session and is still running ({error}). Nothing was quit.',
              params: { error: outcome.error }
            }
          })
          return
        case 'unconfirmed':
          setPhase({
            k: 'failed',
            message: {
              id: 'updatePrep.failed.unconfirmed',
              fallback:
                'The session host did not confirm it shut down ({error}). Quit nodeterm and check Task Manager before starting it again.',
              params: { error: outcome.error }
            }
          })
          return
        case 'host-unsupported':
          setPhase({
            k: 'failed',
            message: {
              id: 'updatePrep.failed.hostUnsupported',
              fallback: 'This session host was started by an older nodeterm and cannot shut itself down.'
            }
          })
          return
        default:
          setPhase({
            k: 'failed',
            message: { id: 'updatePrep.failed.unavailable', fallback: 'Preparing for an update is not available here.' }
          })
      }
    } catch (e) {
      setPhase({
        k: 'failed',
        message: {
          id: 'updatePrep.failed.noAnswer',
          fallback: 'The session host did not answer ({error}).',
          params: { error: errorText(e) }
        }
      })
    } finally {
      busyRef.current = false
    }
  }, [quit])

  const rowLabel = (row: PrepRow): string => {
    if (!row.node) return row.session
    const where = row.node.projectClosed
      ? text('updatePrep.closedProject', '{project} (closed)', { project: row.node.projectName })
      : row.node.projectName
    return `${row.node.title || row.node.nodeId} · ${where}`
  }

  const manualSteps = (
    <ol className="update-prep__list">
      {MANUAL_UPDATE_STEPS.map((step, i) => (
        <li key={step}>{text(`updatePrep.manual.${i + 1}`, step)}</li>
      ))}
    </ol>
  )
  const closeButton = (
    <Button variant="text" vocabularyMode="factual" autoFocus onClick={close}>
      {text('updatePrep.close', 'Close')}
    </Button>
  )

  let title = text('updatePrep.title', 'Prepare for update')
  let content: JSX.Element
  let actions: JSX.Element | null = closeButton

  if (phase.k === 'confirm') {
    title = text('updatePrep.confirmTitle', 'Stop all sessions and quit?')
    content = (
      <ul className="update-prep__list">
        {updatePrepStopSummary(phase.plan, phase.exited).map((line) => (
          <li key={line.id}>{say(line)}</li>
        ))}
      </ul>
    )
    actions = (
      <>
        <Button variant="text" vocabularyMode="factual" autoFocus onClick={close}>
          {text('updatePrep.cancel', 'Cancel')}
        </Button>
        <Button variant="filled" danger vocabularyMode="factual" onClick={() => void shutdown()}>
          {text('updatePrep.confirmAction', 'Stop sessions and quit')}
        </Button>
      </>
    )
  } else if (phase.k === 'inspecting') {
    content = <p className="update-prep__msg">{text('updatePrep.inspecting', 'Checking the session host…')}</p>
  } else if (phase.k === 'exiting') {
    content = (
      <p className="update-prep__msg" role="status">
        {text('updatePrep.exiting', 'Asking agents to exit so their conversations are saved… {done} of {total}', {
          done: String(phase.done),
          total: String(phase.total)
        })}
      </p>
    )
    actions = null
  } else if (phase.k === 'shutting') {
    content = (
      <p className="update-prep__msg" role="status">
        {text('updatePrep.shutting', 'Stopping sessions and the session host…')}
      </p>
    )
    actions = null
  } else if (phase.k === 'failed') {
    content = (
      <>
        <p className="update-prep__msg" role="alert">{say(phase.message)}</p>
        <p className="update-prep__msg">{text('updatePrep.manualIntro', 'To finish by hand:')}</p>
        {manualSteps}
      </>
    )
  } else {
    const { inspection, plan } = phase
    if (inspection.kind === 'unsupported') {
      content = (
        <p className="update-prep__msg">
          {text('updatePrep.unsupported', 'Not needed here: this machine does not run terminals in the session host.')}
        </p>
      )
    } else if (inspection.kind === 'no-host') {
      content = (
        <p className="update-prep__msg">
          {text(
            'updatePrep.noHost',
            'No session host is running, so nothing keeps an older version alive. Quit nodeterm and start it again.'
          )}
        </p>
      )
      actions = (
        <>
          <Button variant="text" vocabularyMode="factual" autoFocus onClick={close}>
            {text('updatePrep.cancel', 'Cancel')}
          </Button>
          <Button variant="filled" vocabularyMode="factual" onClick={quit}>
            {text('updatePrep.quit', 'Quit nodeterm')}
          </Button>
        </>
      )
    } else if (inspection.kind === 'error') {
      content = (
        <>
          <p className="update-prep__msg" role="alert">
            {text('updatePrep.error', 'Could not read the session host: {error}', { error: inspection.error })}
          </p>
          {manualSteps}
        </>
      )
    } else if (plan && plan.blocking.length > 0) {
      content = (
        <>
          <p className="update-prep__msg">
            {text(
              'updatePrep.blocking',
              'Wait for these sessions first. Stopping them now would abandon a running turn or an unanswered question:'
            )}
          </p>
          <ul className="update-prep__list">
            {plan.blocking.map((row) => (
              <li key={row.session} className="update-prep__row">
                <span>
                  {rowLabel(row)} ·{' '}
                  {row.busyReason === 'working'
                    ? text('updatePrep.working', 'working')
                    : text('updatePrep.needsYou', 'needs you')}
                </span>
                {row.node && (
                  <Button
                    variant="tonal"
                    size="small"
                    vocabularyMode="factual"
                    onClick={() => {
                      onTravel(row.node!.nodeId)
                      onClose()
                    }}
                  >
                    {text('updatePrep.go', 'Go')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )
      actions = (
        <>
          {closeButton}
          <Button variant="filled" vocabularyMode="factual" onClick={() => void refresh()}>
            {text('updatePrep.checkAgain', 'Check again')}
          </Button>
        </>
      )
    } else if (!inspection.shutdownSupported) {
      content = (
        <>
          <p className="update-prep__msg">
            {text(
              'updatePrep.olderHost',
              'The running session host was started by an older nodeterm and cannot shut itself down from here.'
            )}
          </p>
          <p className="update-prep__msg">{text('updatePrep.manualIntro', 'To finish by hand:')}</p>
          {manualSteps}
        </>
      )
    } else if (plan) {
      const exitCount = plan.toExit.length
      content = (
        <>
          <p className="update-prep__msg">
            {text(
              'updatePrep.intro',
              'Updates install while your sessions keep running, but the session host keeps its older version until it stops. It holds {count} session(s) across your projects.',
              { count: String(plan.rows.length) }
            )}
          </p>
          <p className="update-prep__msg">
            {exitCount > 0
              ? text(
                  'updatePrep.introExit',
                  'First, {count} idle agent(s) will be asked to exit so their conversations are saved. You confirm before anything else stops. Canvas nodes are kept.',
                  { count: String(exitCount) }
                )
              : text('updatePrep.introNoExit', 'You confirm before anything stops. Canvas nodes are kept.')}
          </p>
        </>
      )
      actions = (
        <>
          <Button variant="text" vocabularyMode="factual" autoFocus onClick={close}>
            {text('updatePrep.cancel', 'Cancel')}
          </Button>
          <Button variant="filled" vocabularyMode="factual" onClick={() => void runExits(plan)}>
            {text('updatePrep.continue', 'Continue')}
          </Button>
        </>
      )
    } else {
      content = <p className="update-prep__msg">{text('updatePrep.nothing', 'Nothing to prepare.')}</p>
    }
  }

  return (
    <Dialog
      open
      onClose={close}
      title={title}
      vocabularyMode="factual"
      className="update-prep"
      closeOnScrimClick={!working}
      closeOnEscape={!working}
      actions={actions ?? undefined}
    >
      {content}
    </Dialog>
  )
}
