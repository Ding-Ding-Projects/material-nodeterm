import { useEffect, useMemo, useRef, useState } from 'react'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Input } from '@renderer/ui/Input'
import { Select } from '@renderer/ui/Select'
import { Button } from '@renderer/ui/Button'
import { AnchoredRegexBuilder } from '../../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../../lib/regex/useRegexSearchField'
import type { CloudflareConfigurationPreview, CloudflareDnsAdoptionPreview, CloudflareTunnelInventory } from '@shared/cloudflare'

const ROWS = {
  auth: { title: 'Cloudflare account access', keywords: ['cloudflare', 'token', 'account', 'access'] },
  inventory: { title: 'Tunnel inventory and status', keywords: ['tunnel', 'inventory', 'status', 'connections', 'routes'] },
  configuration: { title: 'Tunnel configuration', keywords: ['configuration', 'route', 'hostname', 'preserve', 'preview'] },
  dns: { title: 'DNS adoption', keywords: ['dns', 'adopt', 'ownership', 'zone', 'hostname'] }
}
const ENTRIES = Object.values(ROWS)

type ManagerTab = 'inventory' | 'configuration' | 'dns'

function emptyInventory(): CloudflareTunnelInventory {
  return {
    checkedAt: 0,
    availability: 'not-configured',
    tokenPresent: false,
    accounts: [],
    zones: [],
    tunnels: [],
    connections: [],
    routes: [],
    dnsRecords: [],
    errors: [],
    binding: null,
    connectorRuntime: 'not-included'
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function CloudflareSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const [inventory, setInventory] = useState<CloudflareTunnelInventory>(emptyInventory)
  const [tab, setTab] = useState<ManagerTab>('inventory')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [routeHostname, setRouteHostname] = useState('')
  const [routeService, setRouteService] = useState('http://127.0.0.1:3000')
  const [routes, setRoutes] = useState<Array<{ hostname: string; service: string }>>([])
  const [configurationPreview, setConfigurationPreview] = useState<CloudflareConfigurationPreview | null>(null)
  const [dnsPreview, setDnsPreview] = useState<CloudflareDnsAdoptionPreview | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [selectedZoneId, setSelectedZoneId] = useState('')
  const [selectedTunnelId, setSelectedTunnelId] = useState('')
  const search = useRegexSearchField({})
  const searchRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setBusy(true)
    try { setInventory(await window.nodeTerminal.cloudflare.status()); setMessage('Cloudflare inventory refreshed.') }
    catch (error) { setMessage(errorMessage(error)) }
    finally { setBusy(false) }
  }
  useEffect(() => { if (isActive) void load() }, [isActive])

  const filteredRoutes = useMemo(() => {
    const needle = search.query.trim().toLocaleLowerCase()
    if (!needle || search.error) return inventory.routes
    return inventory.routes.filter((route) => `${route.hostname} ${route.service}`.toLocaleLowerCase().includes(needle))
  }, [inventory.routes, search.error, search.query])
  const accountId = selectedAccountId || inventory.binding?.accountId || inventory.accounts[0]?.id || ''
  const zoneId = selectedZoneId || inventory.binding?.zoneId || inventory.zones[0]?.id || ''
  const tunnelId = selectedTunnelId || inventory.binding?.tunnelId || inventory.tunnels[0]?.id || ''

  const saveToken = async () => {
    if (!token.trim()) return
    setBusy(true)
    try { setInventory(await window.nodeTerminal.cloudflare.saveToken(token.trim())); setToken(''); setMessage('Cloudflare token saved. Only token presence is shown here.') }
    catch (error) { setMessage(errorMessage(error)) }
    finally { setBusy(false) }
  }
  const previewConfig = async () => {
    if (!accountId || !tunnelId) return
    setBusy(true)
    try { setConfigurationPreview(await window.nodeTerminal.cloudflare.previewConfiguration({ accountId, tunnelId, routes })); setMessage('Configuration preview ready. No Cloudflare mutation has happened.') }
    catch (error) { setMessage(errorMessage(error)) }
    finally { setBusy(false) }
  }
  const applyConfig = async () => {
    if (!configurationPreview?.allowed) return
    setBusy(true)
    try { const result = await window.nodeTerminal.cloudflare.applyConfiguration(configurationPreview.previewId); setMessage(result.message); if (result.ok) { setConfigurationPreview(null); await load() } }
    catch (error) { setMessage(errorMessage(error)) }
    finally { setBusy(false) }
  }
  const previewDns = async () => {
    if (!accountId || !tunnelId || !zoneId || !routeHostname) return
    setBusy(true)
    try { setDnsPreview(await window.nodeTerminal.cloudflare.previewDnsAdoption({ accountId, tunnelId, zoneId, hostname: routeHostname })); setMessage('DNS ownership preview ready. Existing records will not be replaced.') }
    catch (error) { setMessage(errorMessage(error)) }
    finally { setBusy(false) }
  }
  const adoptDns = async () => {
    if (!dnsPreview?.allowed) return
    setBusy(true)
    try { const result = await window.nodeTerminal.cloudflare.adoptDnsRecord(dnsPreview.previewId); setMessage(result.message); if (result.ok) { setDnsPreview(null); await load() } }
    catch (error) { setMessage(errorMessage(error)) }
    finally { setBusy(false) }
  }

  return (
    <SettingsSection id="cloudflare" title="Cloudflare tunnels" description="Inspect Cloudflare tunnels, preserve unmanaged routes, detect hostname conflicts, and adopt DNS only after an ownership proof. This lane controls Cloudflare configuration only and does not run a connector." isActive={isActive} searchEntries={ENTRIES}>
      <SearchableRow {...ROWS.auth}>
        <div className="space-y-3">
          <FieldRow label="API token" description="Write-only credential input. The manager reports token presence, never the token value, length, or fingerprint." control={<div className="flex items-center gap-2"><Input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder={inventory.tokenPresent ? 'Token saved' : 'Paste a Cloudflare API token'} /><Button disabled={busy || !token.trim()} onClick={() => void saveToken()}>Save token</Button>{inventory.tokenPresent ? <Button disabled={busy} onClick={() => void window.nodeTerminal.cloudflare.clearToken().then(setInventory).then(() => setMessage('Cloudflare token cleared.'))}>Clear</Button> : null}</div>} />
          <p className="text-sm text-muted" role="status">{inventory.tokenPresent ? 'Token present. Its value is never returned to the renderer.' : 'No token is configured. Add one to inspect Cloudflare.'}</p>
          <p className="text-xs text-muted">Connector runtime: not included in this lane. Cloudflare API calls stay in the privileged core and are bound to this computer.</p>
        </div>
      </SearchableRow>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Cloudflare tunnel manager tabs">
        {(['inventory', 'configuration', 'dns'] as ManagerTab[]).map((value) => <Button key={value} variant={tab === value ? 'primary' : 'ghost'} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{value === 'dns' ? 'DNS adoption' : value[0].toUpperCase() + value.slice(1)}</Button>)}
        <Button disabled={busy} onClick={() => void load()}>Refresh</Button>
      </div>

      {tab === 'inventory' ? <SearchableRow {...ROWS.inventory}>
        <div className="space-y-4">
          <p className="text-sm text-muted" role="status">Status: <strong>{inventory.availability}</strong>. Checked {inventory.checkedAt ? new Date(inventory.checkedAt).toLocaleString() : 'not yet'}.</p>
          <div className="grid gap-3 sm:grid-cols-3"><FieldRow label="Account" control={<Select value={accountId} onChange={(event) => setSelectedAccountId(event.target.value)}><option value="">Choose an account</option>{inventory.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select>} /><FieldRow label="Zone" control={<Select value={zoneId} onChange={(event) => setSelectedZoneId(event.target.value)}><option value="">Choose a zone</option>{inventory.zones.filter((zone) => !accountId || !zone.accountId || zone.accountId === accountId).map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</Select>} /><FieldRow label="Tunnel" control={<Select value={tunnelId} onChange={(event) => setSelectedTunnelId(event.target.value)}><option value="">Choose a tunnel</option>{inventory.tunnels.map((tunnel) => <option key={tunnel.id} value={tunnel.id}>{tunnel.name} ({tunnel.status ?? 'unknown'})</option>)}</Select>} /></div>
          <Button disabled={busy || !accountId || !tunnelId} onClick={() => void window.nodeTerminal.cloudflare.bind({ accountId, zoneId: zoneId || null, tunnelId, hostname: inventory.binding?.hostname ?? null }).then(setInventory).then(() => setMessage('Cloudflare selection bound to this computer.')))}>Bind selection to this computer</Button>
          {inventory.binding ? <Button disabled={busy} onClick={() => void window.nodeTerminal.cloudflare.unbind().then(setInventory).then(() => setMessage('Cloudflare binding cleared from this computer.'))}>Clear machine binding</Button> : null}
          <p className="text-sm text-muted">Connections: {inventory.connections.length}. Routes: {inventory.routes.length}. DNS records in the bound zone: {inventory.dnsRecords.length}.</p>
          {inventory.errors.length ? <ul className="text-sm text-warn">{inventory.errors.map((error, index) => <li key={index}>{error.operation}: {error.message}{error.status === 403 ? ' Partial permissions. Grant only the missing Cloudflare scope and refresh.' : error.status === 429 ? ` Rate limited${error.retryAfterSeconds ? `, retry in ${error.retryAfterSeconds}s` : ''}.` : ''}</li>)}</ul> : null}
          <ul className="space-y-1 text-sm">{filteredRoutes.length ? filteredRoutes.map((route) => <li key={`${route.hostname}-${route.service}`} className="flex justify-between gap-2"><span>{route.hostname}</span><code>{route.service}</code><span>{route.managed ? 'managed' : 'unmanaged, preserved'}</span></li>) : <li>No tunnel routes match this filter.</li>}</ul>
        </div>
      </SearchableRow> : null}

      {tab === 'configuration' ? <SearchableRow {...ROWS.configuration}>
        <div className="space-y-3">
          <div className="md3-settings-search"><Input ref={searchRef} value={search.value} onChange={(event) => search.setValue(event.target.value)} placeholder="Search tunnel routes" aria-label="Search tunnel routes" /><AnchoredRegexBuilder search={search} fieldRef={searchRef} label="Regex, tunnel route search" /></div>
          <div className="flex flex-wrap items-end gap-2"><FieldRow label="Hostname" control={<Input value={routeHostname} onChange={(event) => setRouteHostname(event.target.value)} placeholder="app.example.com" />} /><FieldRow label="Service URL" control={<Input value={routeService} onChange={(event) => setRouteService(event.target.value)} placeholder="http://127.0.0.1:3000" />} /><Button onClick={() => { if (routeHostname.trim() && routeService.trim()) { setRoutes((current) => [...current, { hostname: routeHostname.trim(), service: routeService.trim() }]); setRouteHostname('') } }}>Add route</Button></div>
          <Button disabled={busy || !accountId || !tunnelId} onClick={() => void previewConfig()}>Preview configuration</Button>
          {configurationPreview ? <div className="rounded-md border border-outline/30 p-3 space-y-2"><ul className="text-sm">{configurationPreview.summary.map((line) => <li key={line}>{line}</li>)}</ul>{configurationPreview.conflicts.length ? <ul className="text-sm text-warn">{configurationPreview.conflicts.map((conflict) => <li key={`${conflict.kind}-${conflict.hostname}`}>{conflict.hostname}: {conflict.detail}</li>)}</ul> : null}<Button disabled={busy || !configurationPreview.allowed} onClick={() => void applyConfig()}>{configurationPreview.allowed ? 'Apply reviewed configuration' : 'Resolve conflicts before applying'}</Button></div> : null}
          <p className="text-xs text-muted">Every configuration write is typed and previewed. Unmanaged routes are carried forward unchanged; a hostname conflict blocks the write.</p>
        </div>
      </SearchableRow> : null}

      {tab === 'dns' ? <SearchableRow {...ROWS.dns}>
        <div className="space-y-3"><FieldRow label="Hostname" description="The selected zone must prove ownership through an existing CNAME pointing at a Cloudflare tunnel hostname." control={<Input value={routeHostname} onChange={(event) => setRouteHostname(event.target.value)} placeholder="app.example.com" />} /><Button disabled={busy || !accountId || !zoneId || !tunnelId || !routeHostname.trim()} onClick={() => void previewDns()}>Preview DNS adoption</Button>{dnsPreview ? <div className="rounded-md border border-outline/30 p-3 space-y-2"><ul className="text-sm">{dnsPreview.summary.map((line) => <li key={line}>{line}</li>)}</ul>{dnsPreview.ownershipProof ? <p className="text-sm">Ownership proof: {dnsPreview.ownershipProof.zoneName} owns {dnsPreview.ownershipProof.recordName} ({dnsPreview.ownershipProof.recordType}).</p> : null}{dnsPreview.conflicts.length ? <ul className="text-sm text-warn">{dnsPreview.conflicts.map((conflict) => <li key={`${conflict.kind}-${conflict.hostname}`}>{conflict.hostname}: {conflict.detail}</li>)}</ul> : null}<Button disabled={busy || !dnsPreview.allowed} onClick={() => void adoptDns()}>{dnsPreview.allowed ? 'Adopt reviewed DNS record' : 'Ownership proof required'}</Button></div> : null}<p className="text-xs text-muted">Adoption records the existing DNS relationship locally after proof. It does not replace or delete an unmanaged DNS record.</p></div>
      </SearchableRow> : null}
      {message ? <p className="text-sm text-muted" role="status">{message}</p> : null}
    </SettingsSection>
  )
}
