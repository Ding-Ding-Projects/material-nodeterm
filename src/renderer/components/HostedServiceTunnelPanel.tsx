import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type {
  HostedServiceKind,
  HostedServiceOriginCandidate,
  HostedServiceTunnelBinding,
  HostedServiceTunnelHandoffInput,
  HostedServiceTunnelStatus
} from '@shared/hosted-service-tunnel'
import {
  formatHostedServiceOrigin,
  discoverHostedServiceOrigins,
  handoffStatusFor,
  parseHostedServiceOrigin,
  validateHostedServiceHostname,
  validateHostedServiceTunnelBinding,
  verifyHostedServiceHealth
} from '@shared/hosted-service-tunnel'
import { Button, SearchField, TextField } from '@renderer/ui/md3'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import type { RegexBuilderBinding } from '../lib/regex/useRegexSearchField'

export interface HostedServicePickerOption {
  id: string
  label: string
  detail?: string
}

export type HostedServiceTunnelHandoff = (
  input: HostedServiceTunnelHandoffInput
) => Promise<{ ok: true; binding: HostedServiceTunnelBinding } | { ok: false; error: string }>

export interface HostedServiceTunnelPanelProps {
  serviceKind?: HostedServiceKind
  endpoint?: string
  intentHealthPath?: string
  initialBinding?: HostedServiceTunnelBinding
  onIntentChange: (healthPath: string) => void
  onBindingChange?: (binding: HostedServiceTunnelBinding | undefined) => void
  accounts?: HostedServicePickerOption[]
  zones?: HostedServicePickerOption[]
  onHandoff?: HostedServiceTunnelHandoff
  onRollback?: (binding: HostedServiceTunnelBinding) => Promise<{ ok: true } | { ok: false; error: string }>
}

type PickerProps = {
  label: string
  options: HostedServicePickerOption[]
  value: string
  onChange: (id: string) => void
  search: ReturnType<typeof useRegexSearchField>
  inputRef: RefObject<HTMLInputElement>
  regexLabel: string
}

function Picker({ label, options, value, onChange, search, inputRef, regexLabel }: PickerProps): React.JSX.Element {
  const visible = useMemo(() => options.filter((option) => search.test(`${option.label} ${option.detail ?? ''}`)), [options, search])
  return (
    <div className="hosted-tunnel__picker">
      <span className="service-node__field-label">{label}</span>
      <SearchField
        ref={inputRef}
        dense
        className="hosted-tunnel__search-row"
        vocabularyMode="factual"
        value={search.value}
        onChange={(event) => search.setValue(event.target.value)}
        placeholder={search.mode === 'regex' ? `Filter ${label.toLowerCase()} (regex)…` : `Filter ${label.toLowerCase()}…`}
        aria-label={`Filter ${label.toLowerCase()}`}
        aria-describedby={`${label.toLowerCase()}-picker-help`}
        trailingSlot={<AnchoredRegexBuilder search={search as RegexBuilderBinding} fieldRef={inputRef} label={regexLabel} />}
      />
      <div id={`${label.toLowerCase()}-picker-help`} className="hosted-tunnel__picker-help">
        {options.length === 0
          ? `No ${label.toLowerCase()} catalog is available. Configure Cloudflare to populate this picker.`
          : `${visible.length} of ${options.length} ${label.toLowerCase()} options`}
      </div>
      <div className="hosted-tunnel__option-list" role="listbox" aria-label={label}>
        {visible.map((option) => (
          <Button
            key={option.id}
            variant="text"
            size="small"
            vocabularyMode="factual"
            role="option"
            aria-selected={value === option.id}
            className={`hosted-tunnel__option${value === option.id ? ' is-selected' : ''}`}
            onClick={() => onChange(option.id)}
            title={option.detail ?? option.label}
          >
            <span>{option.label}</span>
            {option.detail && <small>{option.detail}</small>}
          </Button>
        ))}
        {options.length > 0 && visible.length === 0 && <p className="service-node__note">No matches. Adjust this picker filter.</p>}
      </div>
    </div>
  )
}

/**
 * Private-first handoff for a hosted service. The panel discovers only typed origins, performs a
 * real local health request before enabling handoff, requires Access, and delegates provider
 * mutation to the Cloudflare manager seam. When that manager is not present, the action is
 * visibly unavailable rather than pretending a tunnel was created.
 */
export function HostedServiceTunnelPanel({
  serviceKind = 'gitlab',
  endpoint,
  intentHealthPath,
  initialBinding,
  onIntentChange,
  onBindingChange,
  accounts = [],
  zones = [],
  onHandoff,
  onRollback
}: HostedServiceTunnelPanelProps): React.JSX.Element {
  const originSearch = useRegexSearchField({ mode: 'text' })
  const accountSearch = useRegexSearchField({ mode: 'text' })
  const zoneSearch = useRegexSearchField({ mode: 'text' })
  const originInputRef = useRef<HTMLInputElement>(null)
  const accountInputRef = useRef<HTMLInputElement>(null)
  const zoneInputRef = useRef<HTMLInputElement>(null)
  const [candidates, setCandidates] = useState<HostedServiceOriginCandidate[]>([])
  const [selectedOriginId, setSelectedOriginId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [hostname, setHostname] = useState('')
  const [status, setStatus] = useState<HostedServiceTunnelStatus>(() => initialBinding
    ? { ...handoffStatusFor('connected', initialBinding.origin, initialBinding.hostname), checkedAt: initialBinding.updatedAt }
    : handoffStatusFor('unbound'))
  const [binding, setBinding] = useState<HostedServiceTunnelBinding | undefined>(initialBinding)
  const [busy, setBusy] = useState(false)

  const discover = (): void => {
    const origin = parseHostedServiceOrigin(endpoint)
    if (!origin) {
      setCandidates([])
      setSelectedOriginId('')
      setStatus(handoffStatusFor('failed', undefined, undefined, 'The configured service address is not a typed HTTP(S) origin.', 'origin-invalid'))
      return
    }
    const next = discoverHostedServiceOrigins({ configuredEndpoint: endpoint })
    setCandidates(next)
    setSelectedOriginId(next[0]?.id ?? '')
    onIntentChange(intentHealthPath && /^\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]{0,1023}$/.test(intentHealthPath) ? intentHealthPath : origin.path)
    setStatus(handoffStatusFor('discovering-origin', origin))
  }

  useEffect(() => {
    if (endpoint) discover()
    else setStatus(handoffStatusFor('unbound', undefined, undefined, 'Enter and save a local service address before discovering an origin.'))
    // Discovery is explicit in the UI, but an already saved endpoint should be visible immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint])

  useEffect(() => {
    setBinding(initialBinding)
    if (initialBinding) setStatus({ ...handoffStatusFor('connected', initialBinding.origin, initialBinding.hostname), checkedAt: initialBinding.updatedAt })
  }, [initialBinding])

  const selected = candidates.find((candidate) => candidate.id === selectedOriginId)
  const visibleOrigins = candidates.filter((candidate) => originSearch.test(`${candidate.label} ${formatHostedServiceOrigin(candidate.origin)}`))
  const validHostname = validateHostedServiceHostname(hostname)
  const hasSelection = !!selected && !!accountId && !!zoneId && validHostname
  const providerReady = !!onHandoff
  const canVerify = !!selected && !busy
  const canHandoff = hasSelection && status.state === 'ready' && providerReady && !busy

  const verify = async (): Promise<void> => {
    if (!selected) return
    setBusy(true)
    setStatus(handoffStatusFor('checking-local-health', selected.origin, hostname || undefined))
    const result = await verifyHostedServiceHealth(selected.origin, async (origin, signal) => {
      const response = await fetch(formatHostedServiceOrigin(origin), { method: 'GET', signal, credentials: 'omit', redirect: 'manual' })
      return { ok: response.ok, status: response.status, detail: response.ok ? undefined : `Local health returned HTTP ${response.status}.` }
    })
    const nextCandidate = { ...selected, health: result.state === 'ready' ? 'healthy' : 'unhealthy', checkedAt: result.checkedAt, detail: result.message }
    setCandidates((items) => items.map((item) => item.id === selected.id ? nextCandidate : item))
    setStatus(result)
    setBusy(false)
  }

  const handoff = async (): Promise<void> => {
    if (!selected || !canHandoff || !onHandoff) return
    setBusy(true)
    setStatus(handoffStatusFor('handing-off', selected.origin, hostname))
    const result = await onHandoff({ serviceKind, origin: selected.origin, accountId, zoneId, hostname: hostname.trim().toLowerCase(), access: 'required' })
    if (result.ok) {
      const safeBinding = validateHostedServiceTunnelBinding(result.binding)
      if (!safeBinding) {
        setStatus(handoffStatusFor('failed', selected.origin, hostname, 'The provider returned an invalid handoff binding. The local service remains unchanged.', 'handoff-failed'))
      } else {
        setBinding(safeBinding)
        onBindingChange?.(safeBinding)
        setStatus({ ...handoffStatusFor('connected', safeBinding.origin, safeBinding.hostname), checkedAt: safeBinding.updatedAt })
      }
    } else {
      setStatus(handoffStatusFor('failed', selected.origin, hostname, result.error, 'handoff-failed'))
    }
    setBusy(false)
  }

  const rollback = async (): Promise<void> => {
    if (!binding || !onRollback || busy) return
    setBusy(true)
    const result = await onRollback(binding)
    if (result.ok) {
      setBinding(undefined)
      onBindingChange?.(undefined)
      setStatus(handoffStatusFor('rolled-back', binding.origin, binding.hostname))
    } else setStatus(handoffStatusFor('failed', binding.origin, binding.hostname, result.error, 'handoff-failed'))
    setBusy(false)
  }

  return (
    <section className="hosted-tunnel" aria-labelledby="hosted-tunnel-title">
      <div className="hosted-tunnel__heading">
        <h3 id="hosted-tunnel-title">Private Cloudflare Tunnel handoff</h3>
        <span className={`hosted-tunnel__state hosted-tunnel__state--${status.state}`} role="status">{status.state}</span>
      </div>
      <p className="service-node__hint">
        Verify the local {serviceKind} origin first. Only a verified origin can be handed off, and Cloudflare Access is always required.
      </p>
      <div className="hosted-tunnel__origins">
        <div className="service-node__field-label">Typed local origin</div>
        <SearchField
          ref={originInputRef}
          dense
          className="hosted-tunnel__search-row"
          value={originSearch.value}
          onChange={(event) => originSearch.setValue(event.target.value)}
          placeholder={originSearch.mode === 'regex' ? 'Filter origins (regex)…' : 'Filter origins…'}
          aria-label="Filter typed local origins"
          trailingSlot={<AnchoredRegexBuilder search={originSearch} fieldRef={originInputRef} label="Regex - typed local origins" />}
        />
        <div className="hosted-tunnel__option-list" role="listbox" aria-label="Typed local origins">
          {visibleOrigins.map((candidate) => (
            <Button key={candidate.id} variant="text" size="small" vocabularyMode="factual" role="option" aria-selected={candidate.id === selectedOriginId} className={`hosted-tunnel__option${candidate.id === selectedOriginId ? ' is-selected' : ''}`} onClick={() => setSelectedOriginId(candidate.id)}>
              <span>{candidate.label}</span><small>{formatHostedServiceOrigin(candidate.origin)} · {candidate.health}</small>
            </Button>
          ))}
          {visibleOrigins.length === 0 && <p className="service-node__note">No typed origin discovered yet. Save the local address, then choose Discover.</p>}
        </div>
        <Button variant="outlined" size="small" className="service-node__local-btn" onClick={discover} disabled={!endpoint || busy} title={!endpoint ? 'Save a local service address first' : 'Discover the typed local service origin'}>Discover local origin</Button>
      </div>

      <div className="hosted-tunnel__grid">
        <Picker label="Cloudflare account" options={accounts} value={accountId} onChange={setAccountId} search={accountSearch} inputRef={accountInputRef} regexLabel="Regex - Cloudflare account picker" />
        <Picker label="Cloudflare zone" options={zones} value={zoneId} onChange={setZoneId} search={zoneSearch} inputRef={zoneInputRef} regexLabel="Regex - Cloudflare zone picker" />
      </div>

      <TextField
        id="hosted-tunnel-hostname"
        className="service-node__field"
        label="Public hostname"
        value={hostname}
        onChange={(event) => setHostname(event.target.value)}
        placeholder="service.example.com"
        invalid={hostname !== '' && !validHostname}
        supportText={hostname === '' ? 'Choose a verified account and zone, then enter the hostname to route.' : validHostname ? 'Hostname shape is valid. Availability is checked by the Cloudflare handoff.' : 'Use a DNS hostname with letters, numbers, dots, and hyphens.'}
      />

      <div className="hosted-tunnel__actions">
        <Button variant="outlined" size="small" className="service-node__local-btn" onClick={() => void verify()} disabled={!canVerify} title={!selected ? 'Discover and select a local origin first' : 'Verify the local origin health'}>Verify local health</Button>
        <Button variant="filled" size="small" className="service-node__local-btn" onClick={() => void handoff()} disabled={!canHandoff} title={!providerReady ? 'Cloudflare account and zone manager is not connected' : status.state !== 'ready' ? 'Verify local health before handoff' : !hasSelection ? 'Choose account, zone, hostname, and origin' : 'Hand off the verified origin with Access required'}>Hand off with Access</Button>
        {binding && <Button variant="outlined" size="small" danger className="service-node__local-btn" onClick={() => void rollback()} disabled={!onRollback || busy} title={!onRollback ? 'Cloudflare rollback manager is not connected' : 'Remove only this handoff binding'}>Rollback handoff</Button>}
      </div>
      <p className="service-node__note" role="status">{status.message}</p>
      {!providerReady && <p className="hosted-tunnel__availability">Cloudflare account and zone pickers are ready for the Cloudflare manager. Handoff stays disabled until that manager supplies a verified catalog and mutation callback.</p>}
      <p className="hosted-tunnel__privacy">Portable projects carry only private-first intent and the health path. Account, zone, hostname, origin, tunnel, connector, and credentials remain local to this computer.</p>
    </section>
  )
}
