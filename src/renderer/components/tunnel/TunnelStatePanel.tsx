import { useMemo, useRef, useState } from 'react'
import {
  TUNNEL_FACETS,
  TUNNEL_FACET_LABELS,
  tunnelOverallStatus,
  type TunnelFacet,
  type TunnelLiveState,
  type TunnelPortableIntent
} from '@shared/tunnel-state'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'

const STATUS_FILTERS = ['unknown', 'pending', 'ready', 'failed', 'blocked'] as const

function statusLabel(status: (typeof STATUS_FILTERS)[number]): string {
  switch (status) {
    case 'unknown': return 'Unknown'
    case 'pending': return 'Checking'
    case 'ready': return 'Ready'
    case 'failed': return 'Failed'
    case 'blocked': return 'Blocked'
  }
}

function stateClass(status: string): string {
  return `tunnel-state-panel__status tunnel-state-panel__status--${status}`
}

function facetCorpus(facet: TunnelFacet, live: TunnelLiveState | null): string {
  const row = live?.facets[facet]
  return [
    TUNNEL_FACET_LABELS[facet],
    row?.status ?? 'unknown',
    row?.detail ?? '',
    row?.reason ?? ''
  ].join(' ')
}

function formatObservationTime(checkedAt: number): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'
  return `${new Date(checkedAt).toLocaleString()} (${zone})`
}

export interface TunnelStatePanelProps {
  intent: TunnelPortableIntent
  live: TunnelLiveState | null
  /** The host starts a fresh bounded observation for one facet. */
  onRetry?: (facet: TunnelFacet) => void
  /** Cancels the current node observation while preserving its last trustworthy state. */
  onCancel?: () => void
}

/**
 * Guided display for the six independent tunnel observations. It is intentionally usable without
 * a provider connection so imported intent can explain what still needs Configure or Rebind.
 * Search and status filtering keep isolated regex state and each exposes its own anchored builder.
 */
export function TunnelStatePanel({ intent, live, onRetry, onCancel }: TunnelStatePanelProps): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const search = useRegexSearchField()
  const statusFilter = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)
  const statusFilterRef = useRef<HTMLInputElement>(null)
  const [showPortableDetails, setShowPortableDetails] = useState(false)
  const overall = tunnelOverallStatus(live)
  const probeRunning = live ? TUNNEL_FACETS.some((facet) => live.facets[facet].status === 'pending') : false

  const facets = useMemo(
    () => TUNNEL_FACETS.filter((facet) => {
      const row = live?.facets[facet]
      const status = row?.status ?? 'unknown'
      return search.test(facetCorpus(facet, live)) && statusFilter.test(status)
    }),
    [live, search, statusFilter]
  )

  return (
    <section className="tunnel-state-panel nodrag" aria-label={vocab('Tunnel state')}>
      <header className="tunnel-state-panel__header">
        <div>
          <h3 className="tunnel-state-panel__title">{vocab(intent.displayName || 'Cloudflare Tunnel')}</h3>
          <p className="tunnel-state-panel__hostname">
            {intent.hostname || vocab('No hostname selected')}
          </p>
        </div>
        <span className={stateClass(overall)} role="status" aria-label={`${vocab('Overall state')}: ${vocab(statusLabel(overall))}`}>
          {vocab(statusLabel(overall))}
        </span>
      </header>

      <p className="tunnel-state-panel__explanation">
        {vocab('Each row is checked independently. Unknown means no trustworthy observation exists; it is not a failure and it is not proof that the route is absent.')}
      </p>

      <div className="tunnel-state-panel__filters" role="search" aria-label={vocab('Tunnel state filters')}>
        <label className="tunnel-state-panel__field">
          <span>{vocab('Search tunnel checks')}</span>
          <div className="tunnel-state-panel__search-row">
            <Input
              ref={searchRef}
              type="search"
              value={search.value}
              onChange={(event) => search.setValue(event.target.value)}
              aria-label={vocab('Search tunnel checks')}
              placeholder={vocab('Search API, DNS, connector, policy, origin, or external')}
            />
            <AnchoredRegexBuilder
              search={search}
              fieldRef={searchRef}
              label={vocab('Open regex builder for tunnel check search')}
            />
          </div>
        </label>
        <label className="tunnel-state-panel__field">
          <span>{vocab('Filter by status')}</span>
          <div className="tunnel-state-panel__search-row">
            <Input
              ref={statusFilterRef}
              type="search"
              value={statusFilter.value}
              onChange={(event) => statusFilter.setValue(event.target.value)}
              aria-label={vocab('Filter tunnel checks by status')}
              placeholder={vocab('Type a status, for example failed')}
            />
            <AnchoredRegexBuilder
              search={statusFilter}
              fieldRef={statusFilterRef}
              label={vocab('Open regex builder for tunnel status filter')}
            />
          </div>
        </label>
      </div>

      {search.error ? <p className="tunnel-state-panel__message" role="alert">{search.error}</p> : null}
      {statusFilter.error ? <p className="tunnel-state-panel__message" role="alert">{statusFilter.error}</p> : null}

      <div className="tunnel-state-panel__legend" aria-label={vocab('Available status filters')}>
        {STATUS_FILTERS.map((status) => <span key={status} className={stateClass(status)}>{vocab(statusLabel(status))}</span>)}
        {probeRunning && onCancel ? <Button variant="ghost" onClick={onCancel}>{vocab('Cancel check')}</Button> : null}
      </div>

      <div className="tunnel-state-panel__rows" role="list" aria-label={vocab('Tunnel checks')}>
        {facets.map((facet) => {
          const row = live?.facets[facet] ?? {
            status: 'unknown' as const,
            checkedAt: null,
            source: 'unavailable' as const,
            evidence: 'No trustworthy observation has been recorded.'
          }
          const canRetry = row.status !== 'ready' && onRetry !== undefined
          const retryReason = row.status === 'unknown'
            ? vocab('Nothing has been observed yet. Configure the local binding, then retry this check.')
            : row.status === 'pending'
              ? vocab('This check is already running.')
              : row.status === 'ready'
                ? vocab('This check is current. Refresh only when the route may have changed.')
                : vocab('Retry this one check after resolving the stated reason.')
          return (
            <article key={facet} className="tunnel-state-panel__row" role="listitem">
              <div className="tunnel-state-panel__row-copy">
                <h4>{vocab(TUNNEL_FACET_LABELS[facet])}</h4>
                <span className={stateClass(row.status)}>{vocab(statusLabel(row.status))}</span>
                <p>{row.detail ?? row.reason ?? vocab('No observation recorded.')}</p>
                <small>{vocab('Evidence')}: {row.evidence} · {vocab('Source')}: {row.source}</small>
                <small>
                  {row.checkedAt === null
                    ? vocab('Last checked: not recorded')
                    : `${vocab('Last checked')}: ${formatObservationTime(row.checkedAt)}`}
                </small>
              </div>
              {onRetry ? (
                <Button
                  variant="ghost"
                  disabled={!canRetry}
                  title={retryReason}
                  aria-label={`${vocab('Retry')} ${vocab(TUNNEL_FACET_LABELS[facet])}`}
                  onClick={() => onRetry(facet)}
                >
                  {vocab('Retry')}
                </Button>
              ) : null}
            </article>
          )
        })}
      </div>

      {facets.length === 0 ? <p className="tunnel-state-panel__message" role="status">{vocab('No tunnel checks match this search.')}</p> : null}

      <div className="tunnel-state-panel__portable">
        <button
          type="button"
          className="tunnel-state-panel__portable-toggle"
          aria-expanded={showPortableDetails}
          onClick={() => setShowPortableDetails((open) => !open)}
        >
          {showPortableDetails ? vocab('Hide portable intent') : vocab('Show portable intent')}
        </button>
        {showPortableDetails ? (
          <dl className="tunnel-state-panel__portable-details">
            <div><dt>{vocab('Route')}</dt><dd>{intent.routeMode}</dd></div>
            <div><dt>{vocab('Origin')}</dt><dd>{intent.originProtocol}:{intent.originPort}</dd></div>
            <div><dt>{vocab('Connector')}</dt><dd>{intent.connectorMode}</dd></div>
            <div><dt>{vocab('Access')}</dt><dd>{intent.accessPolicyMode}</dd></div>
            <div className="tunnel-state-panel__portable-note">
              <dt>{vocab('Portable note')}</dt>
              <dd>{vocab('Credentials, provider sessions, machine paths, process state, host identifiers, and live observations stay on this computer. Import is side-effect free and needs Configure or Rebind here.')}</dd>
            </div>
          </dl>
        ) : null}
      </div>
    </section>
  )
}
