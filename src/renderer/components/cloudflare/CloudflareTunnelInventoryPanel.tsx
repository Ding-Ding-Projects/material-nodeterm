import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CloudflareAdoptionAction,
  CloudflareDnsAdoptionInput,
  CloudflareTunnelInventory,
  CloudflareTunnelRouteInput,
  CloudflareZoneSummary
} from '@shared/cloudflare-tunnels'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { openDestructiveGate } from '../../state/destructiveGate'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import type { CloudflareCredentialSummary } from '@shared/cloudflare-core-managers'
import { Checkbox, Chip } from '@renderer/ui/md3'
import { Select } from '@renderer/ui/Select'

function rowCorpus(row: unknown): string {
  if (!row || typeof row !== 'object') return ''
  return Object.values(row as Record<string, unknown>).flatMap((value) => Array.isArray(value) ? value : [value]).filter((value) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean').join(' ')
}

/**
 * Cloudflare Tunnel inventory and route adoption surface.
 *
 * Account, zone, tunnel, and DNS choices are selected from bounded provider data. The only free
 * text fields are the hostname and origin values that Cloudflare itself requires; both are
 * validated again by the host service. There is no raw request editor or shell path.
 */
export function CloudflareTunnelInventoryPanel({ nodeId, onPortableIntent }: { nodeId: string; onPortableIntent?: (route: CloudflareTunnelRouteInput) => void }): React.JSX.Element {
  const api = window.nodeTerminal.cloudflareTunnels
  const [accountId, setAccountId] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [zones, setZones] = useState<CloudflareZoneSummary[]>([])
  const [credentials, setCredentials] = useState<CloudflareCredentialSummary[]>([])
  const [inventory, setInventory] = useState<CloudflareTunnelInventory | null>(null)
  const [selectedTunnelId, setSelectedTunnelId] = useState('')
  const [hostname, setHostname] = useState('')
  const [routePath, setRoutePath] = useState('/')
  const [service, setService] = useState('https://127.0.0.1:8080')
  const [protocol, setProtocol] = useState<'http' | 'https' | 'tcp' | 'ssh'>('https')
  const [selectedRecordId, setSelectedRecordId] = useState('')
  const [adoptionAction, setAdoptionAction] = useState<CloudflareAdoptionAction>('adopt-existing')
  const [reviewText, setReviewText] = useState('')
  const [message, setMessage] = useState('')
  const [operationId, setOperationId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [routePlan, setRoutePlan] = useState<Awaited<ReturnType<typeof api.planRoute>> | null>(null)
  const [adoptionPlan, setAdoptionPlan] = useState<Awaited<ReturnType<typeof api.planDnsAdoption>> | null>(null)
  const tunnelSearch = useRegexSearchField()
  const routeSearch = useRegexSearchField()
  const dnsSearch = useRegexSearchField()
  const zoneSearch = useRegexSearchField()
  const tunnelSearchRef = useRef<HTMLInputElement>(null)
  const routeSearchRef = useRef<HTMLInputElement>(null)
  const dnsSearchRef = useRef<HTMLInputElement>(null)
  const zoneSearchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const core = window.nodeTerminal.cloudflareCoreManagers
    if (!core) { setMessage('Cloudflare credentials are unavailable. Configure one in the Cloudflare manager first.'); return }
    void core.credentials().then((items) => {
      setCredentials(items)
      const account = items.find((item) => item.accountId)?.accountId ?? ''
      setAccountId((current) => current || account || '')
    }).catch(() => setMessage('Cloudflare credentials are unavailable. Configure one in the Cloudflare manager first.'))
  }, [])

  useEffect(() => {
    if (!accountId) { setZones([]); setZoneId(''); return }
    void api.zones(accountId).then((items) => {
      setZones(items)
      setZoneId((current) => items.some((item) => item.id === current) ? current : items[0]?.id ?? '')
    }).catch((error) => setMessage(error instanceof Error ? error.message : 'Cloudflare zones could not be read.'))
  }, [accountId, api])

  const refresh = async (): Promise<void> => {
    if (!accountId || !zoneId) { setMessage('Choose the Cloudflare account and zone ids before refreshing the inventory.'); return }
    setBusy(true); setMessage('Reading a bounded Cloudflare inventory…')
    try {
      const next = await api.inventory(accountId, zoneId)
      setInventory(next)
      setSelectedTunnelId((current) => next.tunnels.some((tunnel) => tunnel.id === current) ? current : next.tunnels[0]?.id ?? '')
      setMessage(next.reason ?? `Read ${next.tunnels.length} tunnels, ${next.routes.length} routes, and ${next.dnsRecords.length} DNS records.`)
    } catch (error) { setInventory(null); setMessage(error instanceof Error ? error.message : 'Cloudflare inventory could not be read.') }
    finally { setBusy(false) }
  }

  useEffect(() => api.onProgress((progress) => {
    setOperationId(progress.phase === 'completed' || progress.phase === 'failed' || progress.phase === 'cancelled' ? null : progress.operationId)
    setMessage(progress.message)
  }), [api])

  const selectedTunnel = inventory?.tunnels.find((tunnel) => tunnel.id === selectedTunnelId) ?? null
  const tunnels = useMemo(() => (inventory?.tunnels ?? []).filter((item) => tunnelSearch.test(rowCorpus(item))), [inventory, tunnelSearch])
  const routes = useMemo(() => (inventory?.routes ?? []).filter((item) => routeSearch.test(rowCorpus(item))), [inventory, routeSearch])
  const dnsRecords = useMemo(() => (inventory?.dnsRecords ?? []).filter((item) => dnsSearch.test(rowCorpus(item))), [inventory, dnsSearch])
  const selectedRecord = inventory?.dnsRecords.find((record) => record.id === selectedRecordId) ?? null
  const input = (): CloudflareTunnelRouteInput => ({ accountId, zoneId, tunnelId: selectedTunnelId, hostname, path: routePath, service, protocol, preserveExistingRoutes: true })
  const adoptionInput = (): CloudflareDnsAdoptionInput => ({ route: input(), recordId: selectedRecordId, action: adoptionAction, reviewText })

  const plan = async (): Promise<void> => {
    setBusy(true); setRoutePlan(null); setAdoptionPlan(null)
    try { setRoutePlan(await api.planRoute(input())); setMessage('Route plan is ready for review. Existing routes remain preserved.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Route details could not be planned.') }
    finally { setBusy(false) }
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const saved = await api.saveRoute(input())
      onPortableIntent?.(input())
      setMessage(`Saved ${saved.hostname}${saved.path} without replacing existing routes.`)
      await refresh()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The route could not be saved.') }
    finally { setBusy(false) }
  }

  const planAdoption = async (): Promise<void> => {
    setBusy(true)
    try { setAdoptionPlan(await api.planDnsAdoption(adoptionInput())); setMessage('DNS adoption plan is ready for review.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'DNS adoption could not be planned.') }
    finally { setBusy(false) }
  }

  const adopt = async (): Promise<void> => {
    const action = adoptionInput()
    const run = async (): Promise<void> => {
      setBusy(true)
      try { const saved = await api.adoptDnsRecord(action); setMessage(`Adopted ${saved.hostname}${saved.path}; unrelated DNS records were preserved.`); await refresh() }
      catch (error) { setMessage(error instanceof Error ? error.message : 'DNS adoption failed.') }
      finally { setBusy(false) }
    }
    if (adoptionAction === 'replace-after-confirmation') {
      openDestructiveGate({ title: 'Replace one DNS record', description: `Replace only ${selectedRecord?.name ?? hostname} after the two-key confirmation. Every other record remains unchanged.`, affected: [selectedRecord?.name ?? hostname], confirmLabel: 'Replace DNS record', onConfirm: () => void run() })
    } else await run()
  }

  return <section id={`${nodeId}-cloudflare-tunnel-manager`} className="cloudflare-tunnel-manager nodrag" aria-label="Cloudflare Tunnel inventory and route manager">
    <div className="cloudflare-tunnel-manager__status" role="status" aria-live="polite"><strong>{selectedTunnel?.name ?? 'No tunnel selected'}</strong><span>{message || 'Choose an account and zone, then refresh.'}</span></div>

    <div className="cloudflare-tunnel-manager__guided-form" aria-label="Cloudflare account and zone selection">
      <label>Cloudflare account<Select vocabularyMode="factual" value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Choose a configured account</option>{credentials.filter((item) => item.accountId).map((item) => <option key={item.id} value={item.accountId!}>{item.label} · {item.accountId}</option>)}</Select></label>
      <label>Cloudflare zone<Select vocabularyMode="factual" value={zoneId} onChange={(event) => setZoneId(event.target.value)} disabled={!zones.length}><option value="">Choose a zone from the account</option>{zones.filter((item) => zoneSearch.test(`${item.name} ${item.status}`)).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}</Select></label>
      <div className="cloudflare-tunnel-manager__search-row"><Input ref={zoneSearchRef} type="search" value={zoneSearch.value} onChange={(event) => zoneSearch.setValue(event.target.value)} placeholder="Search zones" aria-label="Search zones" /><AnchoredRegexBuilder search={zoneSearch} fieldRef={zoneSearchRef} label="Regex builder for zone search" /></div>
      <Button disabled={busy || !accountId || !zoneId} title={!accountId || !zoneId ? 'Choose a configured account and a discovered zone first.' : 'Read the current bounded inventory.'} onClick={() => void refresh()}>{busy ? 'Refreshing…' : 'Refresh inventory'}</Button>
      <Button disabled={!operationId} title={!operationId ? 'No inventory request is running.' : 'Cancel the current inventory request.'} onClick={() => { if (operationId) api.cancel(operationId) }}>Cancel inventory</Button>
      <p className="service-node__note">Choose a configured Cloudflare credential from the existing Cloudflare manager. The token remains in the host credential store and is never returned to this surface.</p>
    </div>

    <div className="cloudflare-tunnel-manager__search-row"><Input ref={tunnelSearchRef} type="search" value={tunnelSearch.value} onChange={(event) => tunnelSearch.setValue(event.target.value)} placeholder="Search tunnels" aria-label="Search tunnels" /><AnchoredRegexBuilder search={tunnelSearch} fieldRef={tunnelSearchRef} label="Regex builder for tunnel search" /></div>
    <div className="cloudflare-tunnel-manager__pills" role="listbox" aria-label="Cloudflare tunnels">{tunnels.length ? tunnels.map((tunnel) => <Chip vocabularyMode="factual" selected={tunnel.id === selectedTunnelId} role="option" aria-selected={tunnel.id === selectedTunnelId} key={tunnel.id} onClick={() => setSelectedTunnelId(tunnel.id)}>{tunnel.name}<small>{tunnel.health} · {tunnel.connectorCount} connectors</small></Chip>) : <p>No tunnels match the current filter. Refresh or clear the search.</p>}</div>

    <fieldset className="cloudflare-tunnel-manager__route-form" disabled={!selectedTunnel || busy}>
      <legend>Configure a hostname route</legend>
      <label>Hostname<Input value={hostname} onChange={(event) => setHostname(event.target.value)} placeholder="app.example.com" spellCheck={false} /></label>
      <label>Path<Input value={routePath} onChange={(event) => setRoutePath(event.target.value)} placeholder="/" spellCheck={false} /></label>
      <label>Origin service<Input value={service} onChange={(event) => setService(event.target.value)} placeholder="https://127.0.0.1:8080" spellCheck={false} /></label>
      <label>Protocol<Select vocabularyMode="factual" value={protocol} onChange={(event) => setProtocol(event.target.value as typeof protocol)}><option value="https">HTTPS</option><option value="http">HTTP</option><option value="tcp">TCP</option><option value="ssh">SSH</option></Select></label>
      <label><Checkbox vocabularyMode="factual" checked readOnly /> Preserve existing routes</label>
      <div className="cloudflare-tunnel-manager__actions"><Button onClick={() => void plan()} disabled={!selectedTunnel || !hostname || !service}>Review route</Button><Button onClick={() => void save()} disabled={routePlan?.status !== 'ready'} title={routePlan?.status !== 'ready' ? 'Review a conflict-free route plan first.' : 'Save this route while preserving existing routes.'}>Save route</Button></div>
      {routePlan?.conflict && <p className="cloudflare-tunnel-manager__warning" role="alert">{routePlan.conflict.reason}</p>}
    </fieldset>

    <div className="cloudflare-tunnel-manager__search-row"><Input ref={routeSearchRef} type="search" value={routeSearch.value} onChange={(event) => routeSearch.setValue(event.target.value)} placeholder="Search routes" aria-label="Search routes" /><AnchoredRegexBuilder search={routeSearch} fieldRef={routeSearchRef} label="Regex builder for route search" /></div>
    <div className="cloudflare-tunnel-manager__rows" role="list" aria-label="Cloudflare routes">{routes.length ? routes.map((route) => <article role="listitem" key={route.id}><strong>{route.hostname}{route.path}</strong><span>{route.origin.service} · {route.ownership}</span></article>) : <p>No route records match the current filter.</p>}</div>

    <section className="cloudflare-tunnel-manager__dns" aria-label="DNS record adoption"><h3>DNS record adoption</h3><div className="cloudflare-tunnel-manager__search-row"><Input ref={dnsSearchRef} type="search" value={dnsSearch.value} onChange={(event) => dnsSearch.setValue(event.target.value)} placeholder="Search DNS records" aria-label="Search DNS records" /><AnchoredRegexBuilder search={dnsSearch} fieldRef={dnsSearchRef} label="Regex builder for DNS record search" /></div><div className="cloudflare-tunnel-manager__rows" role="listbox" aria-label="DNS records">{dnsRecords.length ? dnsRecords.map((record) => <Chip vocabularyMode="factual" selected={record.id === selectedRecordId} role="option" aria-selected={record.id === selectedRecordId} key={record.id} onClick={() => setSelectedRecordId(record.id)}>{record.name}<small>{record.type} · {record.content}</small></Chip>) : <p>No DNS records match the current filter.</p>}</div><label>Adoption action<Select vocabularyMode="factual" value={adoptionAction} onChange={(event) => setAdoptionAction(event.target.value as CloudflareAdoptionAction)}><option value="adopt-existing">Adopt existing CNAME after review</option><option value="leave-unmanaged">Leave the record unmanaged</option><option value="replace-after-confirmation">Replace one record after confirmation</option></Select></label><label>Review text<Input value={reviewText} onChange={(event) => setReviewText(event.target.value)} placeholder={adoptionAction === 'replace-after-confirmation' ? `ADOPT ${hostname || 'hostname'}` : 'Required only for replacement'} /></label><div className="cloudflare-tunnel-manager__actions"><Button disabled={!selectedRecord || !selectedTunnel || !hostname} onClick={() => void planAdoption()}>Review DNS adoption</Button><Button disabled={adoptionPlan?.status !== 'review-required'} onClick={() => void adopt()} title={adoptionPlan?.status !== 'review-required' ? 'Review the selected record and route before adoption.' : 'Apply only the reviewed DNS adoption action.'}>Adopt selected record</Button></div>{adoptionPlan?.changes.length ? <ul>{adoptionPlan.changes.map((change) => <li key={change}>{change}</li>)}</ul> : null}</section>
  </section>
}
