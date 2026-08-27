import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CloudflareAccountSummary,
  CloudflareTunnelHandoffApi,
  CloudflareTunnelHandoffProgress,
  CloudflareTunnelCapabilities,
  CloudflareTunnelIntent,
  CloudflareZoneSummary,
  HostedServiceHealth,
  HostedServiceOrigin
} from '@shared/cloudflare-tunnel-handoff'
import { validateCloudflareTunnelIntent } from '@shared/cloudflare-tunnel-handoff'
import { AnchoredPopover } from '../ui/AnchoredPopover'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'

interface Props {
  nodeId: string
  serviceId: string
  intent: CloudflareTunnelIntent
  api: CloudflareTunnelHandoffApi
  onIntentChange: (intent: CloudflareTunnelIntent) => void
}

function textFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function originText(origin: HostedServiceOrigin): string {
  return `${origin.label} ${origin.endpoint}:${origin.port} ${origin.healthPath}`
}

function accountText(account: CloudflareAccountSummary): string {
  return `${account.label} ${account.id} ${account.reason ?? ''}`
}

function zoneText(zone: CloudflareZoneSummary): string {
  return `${zone.name} ${zone.id} ${zone.reason ?? ''}`
}

/**
 * Guided handoff surface for a hosted service. It has no credential field and no command field:
 * the provider adapter resolves the selected account's protected local credential only after the
 * local origin reports healthy and the user confirms external exposure.
 */
export function CloudflareTunnelHandoffPanel({ nodeId, serviceId, intent, api, onIntentChange }: Props): React.JSX.Element {
  const [origins, setOrigins] = useState<HostedServiceOrigin[]>([])
  const [accounts, setAccounts] = useState<CloudflareAccountSummary[]>([])
  const [zones, setZones] = useState<CloudflareZoneSummary[]>([])
  const [originId, setOriginId] = useState(intent.originId)
  const [accountId, setAccountId] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [health, setHealth] = useState<HostedServiceHealth | null>(null)
  const [capabilities, setCapabilities] = useState<CloudflareTunnelCapabilities | null>(null)
  const [progress, setProgress] = useState<CloudflareTunnelHandoffProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState(false)
  const [message, setMessage] = useState('Choose a discovered local origin, verify its health, then review the external exposure confirmation.')
  const [originOpen, setOriginOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [zoneOpen, setZoneOpen] = useState(false)
  const originAnchor = useRef<HTMLButtonElement>(null)
  const accountAnchor = useRef<HTMLButtonElement>(null)
  const zoneAnchor = useRef<HTMLButtonElement>(null)
  const originSearch = useRegexSearchField()
  const accountSearch = useRegexSearchField()
  const zoneSearch = useRegexSearchField()
  const originSearchRef = useRef<HTMLInputElement>(null)
  const accountSearchRef = useRef<HTMLInputElement>(null)
  const zoneSearchRef = useRef<HTMLInputElement>(null)

  const selectedOrigin = origins.find((origin) => origin.id === originId) ?? null
  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null
  const selectedZone = zones.find((zone) => zone.id === zoneId) ?? null
  let intentError: string | null = null
  try { validateCloudflareTunnelIntent({ ...intent, serviceId, originId }) } catch (error) { intentError = textFor(error) }
  const visibleOrigins = useMemo(() => origins.filter((origin) => originSearch.test(originText(origin))), [origins, originSearch.test, originSearch.query, originSearch.pattern, originSearch.flags, originSearch.mode])
  const visibleAccounts = useMemo(() => accounts.filter((account) => accountSearch.test(accountText(account))), [accounts, accountSearch.test, accountSearch.query, accountSearch.pattern, accountSearch.flags, accountSearch.mode])
  const visibleZones = useMemo(() => zones.filter((zone) => zoneSearch.test(zoneText(zone))), [zones, zoneSearch.test, zoneSearch.query, zoneSearch.pattern, zoneSearch.flags, zoneSearch.mode])

  useEffect(() => {
    let mounted = true
    void Promise.all([api.origins(nodeId), api.accounts(), api.capabilities()]).then(([nextOrigins, nextAccounts, nextCapabilities]) => {
      if (!mounted) return
      setOrigins(nextOrigins)
      setAccounts(nextAccounts)
      setCapabilities(nextCapabilities)
      setOriginId((current) => nextOrigins.some((origin) => origin.id === current) ? current : nextOrigins[0]?.id ?? '')
      setAccountId((current) => current && nextAccounts.some((account) => account.id === current) ? current : nextAccounts.find((account) => account.available)?.id ?? '')
    }).catch((error) => mounted && setMessage(textFor(error)))
    return () => { mounted = false }
  }, [api, nodeId])

  useEffect(() => {
    if (!accountId) { setZones([]); setZoneId(''); return }
    let mounted = true
    void api.zones(accountId).then((nextZones) => {
      if (!mounted) return
      setZones(nextZones)
      setZoneId((current) => nextZones.some((zone) => zone.id === current) ? current : nextZones.find((zone) => zone.available)?.id ?? '')
    }).catch((error) => mounted && setMessage(textFor(error)))
    return () => { mounted = false }
  }, [api, accountId])

  useEffect(() => api.onProgress((event) => {
    setProgress(event)
    setMessage(event.message)
  }), [api])

  const chooseOrigin = (next: HostedServiceOrigin): void => {
    setOriginId(next.id)
    setHealth(null)
    onIntentChange({ ...intent, serviceId, originId: next.id })
    setOriginOpen(false)
  }

  const verifyHealth = async (): Promise<void> => {
    if (!selectedOrigin) { setMessage('Choose a discovered local origin before verification.'); return }
    setBusy(true)
    try {
      const next = await api.health(nodeId, selectedOrigin.id)
      setHealth(next)
      setMessage(next.reason ?? (next.state === 'healthy' ? 'The local service is healthy and may be reviewed for explicit exposure.' : 'The local service is not healthy. No external change is available.'))
    } catch (error) { setMessage(textFor(error)) } finally { setBusy(false) }
  }

  const startHandoff = async (): Promise<void> => {
    if (!selectedOrigin || !selectedAccount || !selectedZone) { setMessage('Choose an available local origin, Cloudflare account, and Cloudflare zone.'); return }
    setBusy(true)
    try {
      const result = await api.handoff({
        nodeId,
        intent: { ...intent, serviceId, originId: selectedOrigin.id },
        originId: selectedOrigin.id,
        accountId: selectedAccount.id,
        zoneId: selectedZone.id,
        confirmExternalExposure: confirmation
      })
      setHealth(result.state.localHealth)
      setProgress(null)
      setMessage(result.error ?? result.state.reason ?? 'Cloudflare Tunnel handoff completed.')
    } catch (error) { setMessage(textFor(error)) } finally { setBusy(false) }
  }

  const cancel = (): void => {
    if (progress) api.cancel(progress.operationId)
  }

  return <section className="cloudflare-tunnel-handoff nodrag" aria-label="Cloudflare Tunnel handoff">
    <div className="service-node__status" role="status" aria-live="polite">
      <strong>{health?.state === 'healthy' ? 'Local service healthy' : 'External exposure is not verified'}</strong>
      <span>{message}</span>
      {progress && <progress max={1} value={progress.progress} aria-label={progress.message} />}
      {capabilities && !capabilities.available && <small>{capabilities.reason ?? 'The Cloudflare Tunnel adapter is unavailable on this computer.'}</small>}
    </div>

    <div className="service-node__picker">
      <label>Local origin
        <button ref={originAnchor} type="button" aria-haspopup="listbox" aria-expanded={originOpen} disabled={busy || !origins.length} title={!origins.length ? 'No local origins were discovered.' : 'Choose a verified local origin.'} onClick={() => setOriginOpen(true)}>
          {selectedOrigin ? `${selectedOrigin.label} · ${selectedOrigin.endpoint}${selectedOrigin.healthPath}` : 'Choose a local origin'}
        </button>
      </label>
      <div className="service-node__search-row"><input ref={originSearchRef} value={originSearch.value} onChange={(event) => originSearch.setValue(event.target.value)} placeholder="Filter local origins" aria-label="Filter local origins" /><AnchoredRegexBuilder search={originSearch} fieldRef={originSearchRef} label="Regex for local origin search" /></div>
      <AnchoredPopover anchorRef={originAnchor} open={originOpen} onClose={() => setOriginOpen(false)} width={420} className="service-node__option-popover">
        <div role="listbox" aria-label="Local origin choices">{visibleOrigins.length ? visibleOrigins.map((origin) => <button key={origin.id} type="button" role="option" aria-selected={origin.id === originId} onClick={() => chooseOrigin(origin)}><strong>{origin.label}</strong><span>{origin.endpoint}{origin.healthPath}</span></button>) : <p>No matching local origins. Clear the filter or refresh the hosted service.</p>}</div>
      </AnchoredPopover>
    </div>

    <div className="service-node__actions">
      <button type="button" onClick={() => void verifyHealth()} disabled={busy || !selectedOrigin} title={!selectedOrigin ? 'Choose a local origin first.' : 'Verify the local health endpoint before any external change.'}>Verify local health</button>
      {progress && <button type="button" onClick={cancel} disabled={!busy}>Cancel handoff</button>}
    </div>

    <div className="service-node__picker">
      <label>Cloudflare account
        <button ref={accountAnchor} type="button" aria-haspopup="listbox" aria-expanded={accountOpen} disabled={busy || !accounts.length} title={!accounts.length ? 'No Cloudflare accounts are configured on this computer.' : 'Choose an available Cloudflare account.'} onClick={() => setAccountOpen(true)}>
          {selectedAccount ? selectedAccount.label : 'Choose a Cloudflare account'}
        </button>
      </label>
      <div className="service-node__search-row"><input ref={accountSearchRef} value={accountSearch.value} onChange={(event) => accountSearch.setValue(event.target.value)} placeholder="Filter Cloudflare accounts" aria-label="Filter Cloudflare accounts" /><AnchoredRegexBuilder search={accountSearch} fieldRef={accountSearchRef} label="Regex for Cloudflare account search" /></div>
      <AnchoredPopover anchorRef={accountAnchor} open={accountOpen} onClose={() => setAccountOpen(false)} width={420} className="service-node__option-popover">
        <div role="listbox" aria-label="Cloudflare account choices">{visibleAccounts.length ? visibleAccounts.map((account) => <button key={account.id} type="button" role="option" aria-selected={account.id === accountId} disabled={!account.available} title={account.reason ?? 'Use this Cloudflare account.'} onClick={() => { setAccountId(account.id); setAccountOpen(false) }}><strong>{account.label}</strong><span>{account.available ? 'Available' : account.reason}</span></button>) : <p>No matching Cloudflare accounts. Clear the filter or configure an account.</p>}</div>
      </AnchoredPopover>
    </div>

    <div className="service-node__picker">
      <label>Cloudflare zone
        <button ref={zoneAnchor} type="button" aria-haspopup="listbox" aria-expanded={zoneOpen} disabled={busy || !accountId || !zones.length} title={!accountId ? 'Choose a Cloudflare account first.' : !zones.length ? 'No zones were discovered for this account.' : 'Choose an available Cloudflare zone.'} onClick={() => setZoneOpen(true)}>
          {selectedZone ? selectedZone.name : 'Choose a Cloudflare zone'}
        </button>
      </label>
      <div className="service-node__search-row"><input ref={zoneSearchRef} value={zoneSearch.value} onChange={(event) => zoneSearch.setValue(event.target.value)} placeholder="Filter Cloudflare zones" aria-label="Filter Cloudflare zones" /><AnchoredRegexBuilder search={zoneSearch} fieldRef={zoneSearchRef} label="Regex for Cloudflare zone search" /></div>
      <AnchoredPopover anchorRef={zoneAnchor} open={zoneOpen} onClose={() => setZoneOpen(false)} width={420} className="service-node__option-popover">
        <div role="listbox" aria-label="Cloudflare zone choices">{visibleZones.length ? visibleZones.map((zone) => <button key={zone.id} type="button" role="option" aria-selected={zone.id === zoneId} disabled={!zone.available} title={zone.reason ?? 'Use this Cloudflare zone.'} onClick={() => { setZoneId(zone.id); setZoneOpen(false) }}><strong>{zone.name}</strong><span>{zone.available ? 'Available' : zone.reason}</span></button>) : <p>No matching zones. Choose another account or clear the filter.</p>}</div>
      </AnchoredPopover>
    </div>

    <label className="service-node__field">Hostname hint<input value={intent.hostnameHint} onChange={(event) => onIntentChange({ ...intent, serviceId, originId, hostnameHint: event.target.value })} placeholder="app.example.com" spellCheck={false} /></label>
    <label className="service-node__field">Path prefix<input value={intent.pathPrefix} onChange={(event) => onIntentChange({ ...intent, serviceId, originId, pathPrefix: event.target.value })} placeholder="/" spellCheck={false} /></label>
    {intentError && <p className="service-node__error" role="alert">{intentError}</p>}
    <label className="service-node__check"><input type="checkbox" checked={confirmation} onChange={(event) => setConfirmation(event.target.checked)} /> I reviewed the healthy local origin and explicitly confirm external exposure.</label>
    <button type="button" onClick={() => void startHandoff()} disabled={busy || !!intentError || health?.state !== 'healthy' || !selectedAccount || !selectedZone || !confirmation || !capabilities?.available || !capabilities.canCreateTunnel || !capabilities.canStartConnector || !capabilities.canVerifyExternal} title={intentError ?? (health?.state !== 'healthy' ? 'Verify a healthy local origin first.' : !confirmation ? 'Confirm external exposure first.' : capabilities && !capabilities.available ? capabilities.reason ?? 'The Cloudflare Tunnel adapter is unavailable.' : 'Create and verify the Cloudflare Tunnel handoff.')}>Create and verify Tunnel route</button>
    <p className="service-node__note">The project carries only service and routing intent. Cloudflare account, zone, tunnel, connector, credential, endpoint, process, and host details stay on this computer. Import never starts a tunnel or contacts Cloudflare.</p>
  </section>
}
