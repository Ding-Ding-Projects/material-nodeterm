import { useEffect, useMemo, useState } from 'react'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'
import { Select } from '@renderer/ui/Select'
import { useSettings } from '../../../state/settings'
import { notify } from '../../../lib/adhdNotify'
import { buildDocumentExport } from '@shared/export'
import { saveBuiltExport } from '../../../lib/exportSave'
import {
  applyTunnelStateAction,
  TUNNEL_PHASES,
  TUNNEL_PHASE_LABELS,
  tunnelStateExportRows,
  type TunnelObservationState,
  type TunnelPhase,
  type TunnelStateSnapshot
} from '@shared/tunnel-state'

const ROWS = {
  state: {
    title: 'Tunnel state',
    description: 'Reconcile hosted tunnel observations by generation',
    keywords: ['tunnel', 'cloudflare', 'hosting', 'reconcile', 'generation', 'connector', 'dns', 'access', 'origin', 'external']
  },
  export: {
    title: 'Export tunnel state',
    description: 'Export safe tunnel observations without credentials',
    keywords: ['export', 'history', 'audit', 'json']
  }
}
const ENTRIES = Object.values(ROWS)
const OBSERVATION_STATES: TunnelObservationState[] = ['unknown', 'pending', 'healthy', 'failed']

function statusCopy(state: TunnelStateSnapshot): string {
  if (state.lifecycle === 'ready') return 'All eight observations are healthy for the current generation.'
  if (state.lifecycle === 'reconciling') return `Generation ${state.generation} is still being reconciled.`
  if (state.lifecycle === 'stale') return 'A delayed observation was refused as stale; start a fresh reconciliation.'
  if (state.lifecycle === 'error') return 'At least one observation failed. Review the phase error and retry after recovery.'
  if (state.lifecycle === 'partial') return 'Some observations are healthy, but the tunnel is not externally ready.'
  return 'No reconciliation has produced a healthy observation yet.'
}

export function TunnelStateSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const stored = useSettings((s) => s.settings.tunnelState)
  const update = useSettings((s) => s.update)
  const [draft, setDraft] = useState(stored)
  const [identity, setIdentity] = useState({
    tunnelId: stored.tunnelId,
    displayName: stored.displayName,
    hostname: stored.hostname,
    originUrl: stored.originUrl
  })

  useEffect(() => {
    setDraft(stored)
    setIdentity({
      tunnelId: stored.tunnelId,
      displayName: stored.displayName,
      hostname: stored.hostname,
      originUrl: stored.originUrl
    })
  }, [stored])

  const commit = (next: TunnelStateSnapshot, message: string, kind: 'success' | 'warning' = 'success') => {
    setDraft(next)
    update({ tunnelState: next })
    notify({ kind, title: 'Tunnel state', body: message })
  }

  const begin = () => {
    const result = applyTunnelStateAction(draft, { type: 'begin-reconciliation' })
    commit(result.state, `Reconciliation generation ${result.state.generation} started.`)
  }

  const setPhase = (phase: TunnelPhase, value: TunnelObservationState) => {
    const started = draft.generation === 0
      ? applyTunnelStateAction(draft, { type: 'begin-reconciliation' }).state
      : draft
    const generation = started.generation
    const base = started
    const result = applyTunnelStateAction(base, {
      type: 'observe-phase',
      generation,
      phase,
      observation: {
        state: value,
        checkedAt: value === 'unknown' || value === 'pending' ? null : Date.now(),
        detail: value === 'healthy' ? 'Observed by the provider-neutral state editor.' : undefined,
        error: value === 'failed' ? 'Observation reported a failure; connector details are not available in this lane.' : undefined
      }
    })
    commit(result.state, `${TUNNEL_PHASE_LABELS[phase]} recorded as ${value}.`, value === 'failed' ? 'warning' : 'success')
  }

  const complete = () => {
    const result = applyTunnelStateAction(draft, { type: 'complete-reconciliation', generation: draft.generation })
    commit(result.state, statusCopy(result.state), result.state.lifecycle === 'error' ? 'warning' : 'success')
  }

  const saveIdentity = () => {
    const hostname = identity.hostname.trim()
    const originUrl = identity.originUrl.trim()
    const validHostname = hostname.length <= 253 && hostname.length > 0 && !/[\s/:?#]/.test(hostname)
    let validOrigin = true
    if (originUrl) {
      try {
        const parsed = new URL(originUrl)
        validOrigin = (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password
      } catch {
        validOrigin = false
      }
    }
    if (!validHostname || !validOrigin) {
      notify({ kind: 'warning', title: 'Tunnel state', body: 'Enter a hostname without a path and an optional HTTP(S) origin URL without credentials.' })
      return
    }
    const result = applyTunnelStateAction(draft, { type: 'set-identity', ...identity })
    commit(result.state, 'Safe tunnel identity metadata saved. No token or provider session was stored.')
  }

  const exportState = () => {
    const built = buildDocumentExport({
      name: 'tunnel-state',
      data: {
        schemaVersion: draft.schemaVersion,
        state: {
          ...draft,
          phases: tunnelStateExportRows(draft),
          // History is safe mutation metadata, but no connector or credential values are included.
          history: draft.history
        },
        omissions: [
          'provider credentials and sessions',
          'token material',
          'process identifiers and machine paths',
          'connector runtime data and caches'
        ]
      }
    }, 'json')
    saveBuiltExport(built)
    notify({ kind: 'success', title: 'Tunnel state exported', body: 'The JSON export contains observations and history metadata only.' })
  }

  const latestHistory = useMemo(() => draft.history.slice(0, 6), [draft.history])

  return (
    <SettingsSection
      id="tunnel-state"
      title="Tunnel state"
      description="Track each hosted tunnel milestone independently. This local model records safe observations, reconciliation generations, stale responses, partial state, errors, history, and export omissions. Provider connectors are not included in this lane."
      isActive={isActive}
      searchEntries={ENTRIES}
    >
      <SearchableRow {...ROWS.state}>
        <div className="space-y-5">
          <div className="rounded-xl border border-outline/30 bg-surface-container-high p-4" role="status" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{draft.lifecycle === 'ready' ? '✅ Ready' : draft.lifecycle === 'error' ? '⚠️ Needs recovery' : draft.lifecycle === 'stale' ? '⏳ Stale observation' : '⏳ Not externally ready'}</h3>
                <p className="mt-1 text-sm text-text-muted">{statusCopy(draft)}</p>
              </div>
              <span className="text-xs text-text-muted">Generation {draft.generation} · {draft.partial ? 'partial' : 'complete'}</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FieldRow label="Tunnel identity" control={<Input value={identity.tunnelId} onChange={(e) => setIdentity({ ...identity, tunnelId: e.target.value })} placeholder="safe local identifier" />} />
            <FieldRow label="Display name" control={<Input value={identity.displayName} onChange={(e) => setIdentity({ ...identity, displayName: e.target.value })} placeholder="optional name" />} />
            <FieldRow label="Hostname" control={<Input value={identity.hostname} onChange={(e) => setIdentity({ ...identity, hostname: e.target.value })} placeholder="example.example" />} />
            <FieldRow label="Origin URL" control={<Input value={identity.originUrl} onChange={(e) => setIdentity({ ...identity, originUrl: e.target.value })} placeholder="https://origin.example" />} />
          </div>
          <p className="text-xs text-text-muted">These fields are safe intent and endpoint metadata only. Hostname must be a bare host, and Origin URL must be HTTP(S) without credentials. Do not paste tokens, cookies, credentials, process ids, or machine paths.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveIdentity}>Save safe identity</Button>
            <Button variant="default" onClick={begin}>Start new reconciliation</Button>
            <Button variant="ghost" disabled={draft.generation === 0} onClick={complete}>Complete generation</Button>
            <Button variant="ghost" onClick={() => commit(applyTunnelStateAction(draft, { type: 'reset' }).state, 'Tunnel observations reset; safe identity metadata was retained.')}>Reset observations</Button>
          </div>

          <div className="space-y-3" aria-label="Tunnel phases">
            <h3 className="text-sm font-semibold">Independent observations</h3>
            {TUNNEL_PHASES.map((phase) => (
              <div key={phase} className="grid gap-2 rounded-lg border border-outline/20 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div>
                  <p className="text-sm font-medium">{TUNNEL_PHASE_LABELS[phase]}</p>
                  <p className="text-xs text-text-muted">Generation {draft.generation} · {draft.phases[phase].detail ?? 'No detail recorded'}</p>
                  {draft.phases[phase].error ? <p className="text-xs text-error" role="alert">{draft.phases[phase].error}</p> : null}
                </div>
                <Select aria-label={`${TUNNEL_PHASE_LABELS[phase]} state`} value={draft.phases[phase].state} onChange={(e) => setPhase(phase, e.target.value as TunnelObservationState)}>
                  {OBSERVATION_STATES.map((value) => <option key={value} value={value}>{value}</option>)}
                </Select>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Recent state history</h3>
            {latestHistory.length === 0 ? <p className="text-sm text-text-muted">No tunnel actions recorded yet.</p> : latestHistory.map((entry) => <p key={entry.id} className="text-xs text-text-muted">{new Date(entry.at).toLocaleString()} · {entry.summary}</p>)}
          </div>
        </div>
      </SearchableRow>
      <SearchableRow {...ROWS.export}>
        <div className="space-y-3">
          <p className="text-sm text-text-muted">Export the current generation, all eight observations, and safe action history as UTF-8 JSON. The export states that credentials, token material, runtime data, process identifiers, and machine paths were omitted.</p>
          <Button onClick={exportState}>Export tunnel state (JSON)</Button>
        </div>
      </SearchableRow>
    </SettingsSection>
  )
}
