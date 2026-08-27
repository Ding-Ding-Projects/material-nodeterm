import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CloudflareAdoptionAction,
  CloudflareDnsAdoptionInput,
  CloudflareTunnelInventory,
  CloudflareTunnelRouteInput
} from '@shared/cloudflare-tunnels'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { openDestructiveGate } from '../../state/destructiveGate'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'

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
  const [token, setToken] = useState('')
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
  const [busy, setBusy] = useState(false)
  const [routePlan, setRoutePlan] = useState<Awaited<ReturnType<typeof api.planRoute>> | null>(null)
  const [adoptionPlan, setAdoptionPlan] = useState<Awaited<ReturnType<typeof api.planDnsAdoption>> | null>(null)
  const tunnelSearch = useRegexSearchField()
  const routeSearch = useRegexSearchField()
  const dnsSearch = useRegexSearchField()
  const tunnelSearchRef = useRef<HTMLInputElement>(null)
  const routeSearchRef = useRef<HTMLInputElement>(null)
  const dnsSearchRef = useRef<HTMLInputElement>(null)

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

  const saveCredential = async (): Promise<void> => {
    if (!accountId || !token) { setMessage('Choose an account id and enter the token in the secure field first.'); return }
    setBusy(true)
    try { await api.saveCredential(accountId, token); setToken(''); setMessage('The Cloudflare token is stored locally. Its value is never returned.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'The Cloudflare token could not be stored.') }
    finally { setBusy(false) }
  }

  useEffect(() => api.onProgress((progress) => { if (progress.phase !== 'completed') setMessage(progress.message) }), [api])

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
      <label>Cloudflare account id<Input value={accountId} onChange={(event) => setAccountId(event.target.value.trim())} placeholder="32-character account id" spellCheck={false} /></label>
      <label>Zone id<Input value={zoneId} onChange={(event) => setZoneId(event.target.value.trim())} placeholder="32-character zone id" spellCheck={false} /></label>
      <label>API token<Input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Write-only secure field" /></label>
      <Button disabled={busy || !accountId || !token} title={!accountId || !token ? 'Choose an account id and enter a token first.' : 'Store the token in the host credential boundary.'} onClick={() => void saveCredential()}>Save token</Button>
      <Button disabled={busy || !accountId || !zoneId} title={!accountId || !zoneId ? 'Choose both an account id and a zone id first.' : 'Read the current bounded inventory.'} onClick={() => void refresh()}>{busy ? 'Refreshing…' : 'Refresh inventory'}</Button>
      <p className="service-node__note">Account and zone ids are used only for this local provider request. The token is saved through the host credential store and is never returned to this surface.</p>
    </div>

    <div className="cloudflare-tunnel-manager__search-row"><Input ref={tunnelSearchRef} type="search" value={tunnelSearch.value} onChange={(event) => tunnelSearch.setValue(event.target.value)} placeholder="Search tunnels" aria-label="Search tunnels" /><AnchoredRegexBuilder search={tunnelSearch} fieldRef={tunnelSearchRef} label="Regex builder for tunnel search" /></div>
    <div className="cloudflare-tunnel-manager__pills" role="listbox" aria-label="Cloudflare tunnels">{tunnels.length ? tunnels.map((tunnel) => <button type="button" role="option" aria-selected={tunnel.id === selectedTunnelId} key={tunnel.id} onClick={() => setSelectedTunnelId(tunnel.id)}>{tunnel.name}<small>{tunnel.health} · {tunnel.connectorCount} connectors</small></button>) : <p>No tunnels match the current filter. Refresh or clear the search.</p>}</div>

    <fieldset className="cloudflare-tunnel-manager__route-form" disabled={!selectedTunnel || busy}>
      <legend>Configure a hostname route</legend>
      <label>Hostname<Input value={hostname} onChange={(event) => setHostname(event.target.value)} placeholder="app.example.com" spellCheck={false} /></label>
      <label>Path<Input value={routePath} onChange={(event) => setRoutePath(event.target.value)} placeholder="/" spellCheck={false} /></label>
      <label>Origin service<Input value={service} onChange={(event) => setService(event.target.value)} placeholder="https://127.0.0.1:8080" spellCheck={false} /></label>
      <label>Protocol<select value={protocol} onChange={(event) => setProtocol(event.target.value as typeof protocol)}><option value="https">HTTPS</option><option value="http">HTTP</option><option value="tcp">TCP</option><option value="ssh">SSH</option></select></label>
      <label><input type="checkbox" checked readOnly /> Preserve existing routes</label>
      <div className="cloudflare-tunnel-manager__actions"><Button onClick={() => void plan()} disabled={!selectedTunnel || !hostname || !service}>Review route</Button><Button onClick={() => void save()} disabled={routePlan?.status !== 'ready'} title={routePlan?.status !== 'ready' ? 'Review a conflict-free route plan first.' : 'Save this route while preserving existing routes.'}>Save route</Button></div>
      {routePlan?.conflict && <p className="cloudflare-tunnel-manager__warning" role="alert">{routePlan.conflict.reason}</p>}
    </fieldset>

    <div className="cloudflare-tunnel-manager__search-row"><Input ref={routeSearchRef} type="search" value={routeSearch.value} onChange={(event) => routeSearch.setValue(event.target.value)} placeholder="Search routes" aria-label="Search routes" /><AnchoredRegexBuilder search={routeSearch} fieldRef={routeSearchRef} label="Regex builder for route search" /></div>
    <div className="cloudflare-tunnel-manager__rows" role="list" aria-label="Cloudflare routes">{routes.length ? routes.map((route) => <article role="listitem" key={route.id}><strong>{route.hostname}{route.path}</strong><span>{route.origin.service} · {route.ownership}</span></article>) : <p>No route records match the current filter.</p>}</div>

    <section className="cloudflare-tunnel-manager__dns" aria-label="DNS record adoption"><h3>DNS record adoption</h3><div className="cloudflare-tunnel-manager__search-row"><Input ref={dnsSearchRef} type="search" value={dnsSearch.value} onChange={(event) => dnsSearch.setValue(event.target.value)} placeholder="Search DNS records" aria-label="Search DNS records" /><AnchoredRegexBuilder search={dnsSearch} fieldRef={dnsSearchRef} label="Regex builder for DNS record search" /></div><div className="cloudflare-tunnel-manager__rows" role="listbox" aria-label="DNS records">{dnsRecords.length ? dnsRecords.map((record) => <button type="button" role="option" aria-selected={record.id === selectedRecordId} key={record.id} onClick={() => setSelectedRecordId(record.id)}>{record.name}<small>{record.type} · {record.content}</small></button>) : <p>No DNS records match the current filter.</p>}</div><label>Adoption action<select value={adoptionAction} onChange={(event) => setAdoptionAction(event.target.value as CloudflareAdoptionAction)}><option value="adopt-existing">Adopt existing CNAME after review</option><option value="leave-unmanaged">Leave the record unmanaged</option><option value="replace-after-confirmation">Replace one record after confirmation</option></select></label><label>Review text<Input value={reviewText} onChange={(event) => setReviewText(event.target.value)} placeholder={adoptionAction === 'replace-after-confirmation' ? `ADOPT ${hostname || 'hostname'}` : 'Required only for replacement'} /></label><div className="cloudflare-tunnel-manager__actions"><Button disabled={!selectedRecord || !selectedTunnel || !hostname} onClick={() => void planAdoption()}>Review DNS adoption</Button><Button disabled={adoptionPlan?.status !== 'review-required'} onClick={() => void adopt()} title={adoptionPlan?.status !== 'review-required' ? 'Review the selected record and route before adoption.' : 'Apply only the reviewed DNS adoption action.'}>Adopt selected record</Button></div>{adoptionPlan?.changes.length ? <ul>{adoptionPlan.changes.map((change) => <li key={change}>{change}</li>)}</ul> : null}</section>
  </section>
}
