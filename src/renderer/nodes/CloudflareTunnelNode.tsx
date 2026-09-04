import { useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { CloudflareAccount, CloudflareOriginTarget, CloudflarePreflightCheck, CloudflareTunnelPlan, CloudflareTunnelSpec, CloudflareTunnelStatus, CloudflareZone } from '@shared/cloudflare-tunnel'
import { validCloudflareHostname, validCloudflarePort } from '@shared/cloudflare-tunnel'
import type { CanvasNode } from '../state/workspace'
import { useSession } from '../session/session'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { Select } from '../ui/Select'
import { Input } from '../ui/Input'
import { Button } from '../ui/md3'
import { nodeBorderStyle, nodeHeaderFillStyle } from '../lib/nodeColor'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import type { CloudflareTunnelLocalBinding } from '@shared/cloudflare-tunnel'

const DEFAULT_SPEC: CloudflareTunnelSpec = { hostname: '', tunnelName: 'nodeterm tunnel', accessMode: 'deny-first' }

function checkIcon(check: CloudflarePreflightCheck): string {
  return check.state === 'pass' ? '✅' : check.state === 'warn' ? '⚠️' : '❌'
}

function targetLabel(target: CloudflareOriginTarget): string {
  const container = target.containerName ?? target.containerId ?? 'discovered container'
  const network = target.networkName ? ` · ${target.networkName}` : ''
  return `${container}${network} · ${target.originUrl}`
}

/** One-click Tunnel setup with typed discovery and deny-first Access policy. */
export default function CloudflareTunnelNode({ id, data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const { api } = useSession()
  const { updateNodeData } = useReactFlow()
  const spec = (data.cloudflareTunnelSpec as CloudflareTunnelSpec | undefined) ?? DEFAULT_SPEC
  const binding = data.cloudflareTunnelLocalBinding as CloudflareTunnelLocalBinding | undefined
  const [token, setToken] = useState('')
  const [tokenConfigured, setTokenConfigured] = useState(false)
  const [accounts, setAccounts] = useState<CloudflareAccount[]>([])
  const [zones, setZones] = useState<CloudflareZone[]>([])
  const [targets, setTargets] = useState<CloudflareOriginTarget[]>([])
  const [accountId, setAccountId] = useState(binding?.accountId ?? '')
  const [zoneId, setZoneId] = useState(binding?.zoneId ?? '')
  const [hostId, setHostId] = useState(binding?.hostId ?? '')
  const [targetId, setTargetId] = useState(binding?.targetId ?? '')
  const [hostname, setHostname] = useState(spec.hostname)
  const [tunnelName, setTunnelName] = useState(spec.tunnelName)
  const [checks, setChecks] = useState<CloudflarePreflightCheck[]>([])
  const [status, setStatus] = useState<CloudflareTunnelStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const accountSearch = useRegexSearchField()
  const zoneSearch = useRegexSearchField()
  const targetSearch = useRegexSearchField()
  const hostSearch = useRegexSearchField()
  const accountInput = useRef<HTMLInputElement>(null)
  const zoneInput = useRef<HTMLInputElement>(null)
  const targetInput = useRef<HTMLInputElement>(null)
  const hostInput = useRef<HTMLInputElement>(null)

  const selectedTarget = targets.find((target) => target.id === targetId) ?? null
  const filteredAccounts = useMemo(() => accounts.filter((item) => accountSearch.test(`${item.name} ${item.id}`)), [accounts, accountSearch])
  const filteredZones = useMemo(() => zones.filter((item) => zoneSearch.test(`${item.name} ${item.status}`)), [zones, zoneSearch])
  const filteredTargets = useMemo(() => targets.filter((item) => targetSearch.test(targetLabel(item))), [targets, targetSearch])
  const hosts = useMemo(() => [...new Map(targets.map((target) => [target.hostId, { id: target.hostId, label: target.hostLabel }])).values()], [targets])
  const filteredHosts = useMemo(() => hosts.filter((item) => hostSearch.test(`${item.label} ${item.id}`)), [hosts, hostSearch])
  const hostTargets = useMemo(() => targets.filter((item) => item.hostId === hostId), [targets, hostId])
  const containerChoices = useMemo(() => [...new Map(hostTargets.filter((item) => item.containerId).map((item) => [item.containerId!, item.containerName ?? item.containerId!])).entries()], [hostTargets])
  const networkChoices = useMemo(() => [...new Map(hostTargets.filter((item) => item.networkId).map((item) => [item.networkId!, item.networkName ?? item.networkId!])).entries()], [hostTargets])
  const portChoices = useMemo(() => [...new Set(hostTargets.map((item) => item.port))].sort((a, b) => a - b), [hostTargets])

  const chooseTarget = (predicate: (target: CloudflareOriginTarget) => boolean): void => {
    const next = hostTargets.find(predicate)
    if (next) setTargetId(next.id)
  }

  useEffect(() => {
    let cancelled = false
    void api.cloudflareTunnel.tokenStatus().then((result) => { if (!cancelled) setTokenConfigured(result.configured) }).catch(() => {})
    void api.cloudflareTunnel.targets().then((result) => { if (!cancelled) setTargets(result) }).catch(() => {})
    void api.cloudflareTunnel.status().then((result) => { if (!cancelled) setStatus(result) }).catch(() => {})
    return () => { cancelled = true }
  }, [api.cloudflareTunnel])

  useEffect(() => {
    if (!accountId) { setAccounts([]); setZones([]); return }
    let cancelled = false
    void api.cloudflareTunnel.zones(accountId).then((result) => { if (!cancelled) setZones(result) }).catch((error: unknown) => { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Cloudflare zones could not be read.') })
    return () => { cancelled = true }
  }, [accountId, api.cloudflareTunnel])

  const saveSpec = (patch: Partial<CloudflareTunnelSpec>): void => {
    updateNodeData(id, { cloudflareTunnelSpec: { ...spec, ...patch } })
  }

  const loadAccounts = async (): Promise<void> => {
    setBusy(true); setMessage('')
    try {
      if (token.trim()) { await api.cloudflareTunnel.setToken(token); setToken(''); setTokenConfigured(true) }
      const result = await api.cloudflareTunnel.accounts()
      setAccounts(result)
      if (!accountId && result[0]) setAccountId(result[0].id)
      if (!result.length) setMessage('No Cloudflare accounts were returned for this token.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Cloudflare account discovery failed.') }
    finally { setBusy(false) }
  }

  const buildPlan = (): CloudflareTunnelPlan | null => {
    if (!accountId || !zoneId || !hostId || !selectedTarget || selectedTarget.hostId !== hostId || !validCloudflareHostname(hostname) || !validCloudflarePort(selectedTarget.port)) return null
    return { accountId, zoneId, hostname: hostname.trim().toLowerCase(), hostId, targetId: selectedTarget.id, port: selectedTarget.port, originUrl: selectedTarget.originUrl, tunnelName: tunnelName.trim() || 'nodeterm tunnel', accessMode: 'deny-first' }
  }

  const runPreflight = async (): Promise<void> => {
    const plan = buildPlan()
    if (!plan) { setMessage('Choose an account, zone, valid hostname, and discovered running origin first.'); return }
    setBusy(true); setMessage('')
    try { setChecks(await api.cloudflareTunnel.preflight(plan)) } catch (error) { setMessage(error instanceof Error ? error.message : 'Preflight could not complete.') }
    finally { setBusy(false) }
  }

  const apply = async (): Promise<void> => {
    const plan = buildPlan()
    if (!plan || checks.some((check) => check.state === 'fail')) return
    setBusy(true); setMessage('Applying tunnel, Access deny-first policy, DNS route, and token-file connector…')
    try {
      const next = await api.cloudflareTunnel.apply(plan)
      setStatus(next)
      if (next.phase === 'active') {
        updateNodeData(id, { cloudflareTunnelSpec: { hostname: plan.hostname, tunnelName: plan.tunnelName, accessMode: 'deny-first' }, cloudflareTunnelLocalBinding: { accountId: plan.accountId, zoneId: plan.zoneId, hostId: plan.hostId, targetId: plan.targetId, port: plan.port, originUrl: plan.originUrl, tunnelId: next.tunnelId ?? undefined, dnsRecordId: next.dnsRecordId ?? undefined, connectorContainerId: next.connectorContainerId ?? undefined, tokenFilePath: next.tokenFilePath ?? undefined } })
        setMessage(next.detail ?? 'Tunnel is active.')
      } else setMessage(next.detail ?? 'Tunnel was not activated.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Tunnel apply failed; rollback was attempted.') }
    finally { setBusy(false) }
  }

  const rollback = async (): Promise<void> => {
    setBusy(true); setMessage('Rolling back connector, DNS, Access, and tunnel resources…')
    try { const next = await api.cloudflareTunnel.rollback(); setStatus(next); updateNodeData(id, { cloudflareTunnelLocalBinding: undefined }); setMessage(next.detail ?? 'Rollback completed.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Rollback status is unavailable.') }
    finally { setBusy(false) }
  }

  const border = nodeBorderStyle(data.color)
  const header = nodeHeaderFillStyle(data.color)
  return (
    <>
      <div className={`service-node cloudflare-tunnel-node${selected ? ' selected' : ''}`} style={border.style} role="group" aria-label="Cloudflare Tunnel manager">
        <NodeResizer minWidth={430} minHeight={560} isVisible={selected} color={data.color} />
        <div className="service-node__header" style={header.style}>
          <span className="service-node__product">Cloudflare Tunnel</span>
          <EditableNodeTitle value={data.serviceLabel ?? ''} onChange={(value) => updateNodeData(id, { serviceLabel: value })} ariaLabel="Name for this Cloudflare Tunnel" title="Rename" baseTriggerClassName="" triggerClassName="service-node__label-text" emptyLabel={<span className="service-node__label-empty">Name this tunnel…</span>} rejectEmpty={false} />
        </div>
        <div className="service-node__body cloudflare-tunnel-node__body">
          <p className="service-node__hint">Guided exposure only: the wizard selects discovered resources and creates a deny-first Access policy. It never accepts arbitrary ingress, shell, image, or environment text.</p>
          <label className="service-node__field"><span className="service-node__field-label">Cloudflare API token</span><div className="service-node__field-row"><Input className="service-node__input nodrag" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={tokenConfigured ? 'Token saved locally' : 'Paste once, then save locally'} autoComplete="off" /><Button variant="outlined" size="small" className="service-node__local-btn nodrag" disabled={busy || !token.trim()} onClick={() => void loadAccounts()}>Save and discover</Button></div></label>
          <p className="service-node__note">{tokenConfigured ? 'A token is configured in protected local storage. It is never written to the project, logs, or connector arguments.' : 'No token is configured. Enter it only in this protected field; it is not shown again after saving.'}</p>
          <label className="service-node__field"><span className="service-node__field-label">Account</span><div className="cloudflare-tunnel-node__search-row"><Input ref={accountInput} className="service-node__input nodrag" value={accountSearch.value} onChange={(event) => accountSearch.setValue(event.target.value)} placeholder="Search accounts" aria-label="Search Cloudflare accounts" /><AnchoredRegexBuilder search={accountSearch} fieldRef={accountInput} label="Regex for Cloudflare account search" /></div><Select className="service-node__input nodrag" value={accountId} onChange={(event) => { setAccountId(event.target.value); setZoneId('') }} disabled={!accounts.length}><option value="">Choose an account…</option>{filteredAccounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
          <label className="service-node__field"><span className="service-node__field-label">Zone</span><div className="cloudflare-tunnel-node__search-row"><Input ref={zoneInput} className="service-node__input nodrag" value={zoneSearch.value} onChange={(event) => zoneSearch.setValue(event.target.value)} placeholder="Search zones" aria-label="Search Cloudflare zones" /><AnchoredRegexBuilder search={zoneSearch} fieldRef={zoneInput} label="Regex for Cloudflare zone search" /></div><Select className="service-node__input nodrag" value={zoneId} onChange={(event) => setZoneId(event.target.value)} disabled={!zones.length}><option value="">Choose a zone…</option>{filteredZones.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}</Select></label>
          <label className="service-node__field"><span className="service-node__field-label">Host</span><div className="cloudflare-tunnel-node__search-row"><Input ref={hostInput} className="service-node__input nodrag" value={hostSearch.value} onChange={(event) => hostSearch.setValue(event.target.value)} placeholder="Search hosts" aria-label="Search tunnel hosts" /><AnchoredRegexBuilder search={hostSearch} fieldRef={hostInput} label="Regex for tunnel host search" /></div><Select className="service-node__input nodrag" value={hostId} onChange={(event) => { setHostId(event.target.value); setTargetId('') }} disabled={!hosts.length}><option value="">Choose a host…</option>{filteredHosts.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select>{!hosts.length && <span className="service-node__note">No host with a discovered container is available.</span>}</label>
          <label className="service-node__field"><span className="service-node__field-label">Discovered container, network, port, and origin</span><div className="cloudflare-tunnel-node__search-row"><Input ref={targetInput} className="service-node__input nodrag" value={targetSearch.value} onChange={(event) => targetSearch.setValue(event.target.value)} placeholder="Search discovered origins" aria-label="Search discovered origins" /><AnchoredRegexBuilder search={targetSearch} fieldRef={targetInput} label="Regex for discovered origin search" /></div><Select className="service-node__input nodrag" value={targetId} onChange={(event) => setTargetId(event.target.value)} disabled={!hostId || !filteredTargets.length}><option value="">Choose a discovered origin…</option>{filteredTargets.filter((item) => item.hostId === hostId).map((item) => <option key={item.id} value={item.id}>{targetLabel(item)}</option>)}</Select>{!targets.length && <span className="service-node__note">No running container origin was discovered on this host. Refresh the node after starting a bounded local container.</span>}</label>
          <div className="cloudflare-tunnel-node__details" aria-label="Selected container network port and origin">
            <label className="service-node__field"><span className="service-node__field-label">Container</span><Select className="service-node__input nodrag" value={selectedTarget?.containerId ?? ''} onChange={(event) => chooseTarget((target) => target.containerId === event.target.value)} disabled={!containerChoices.length}><option value="">Choose a discovered container…</option>{containerChoices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
            <label className="service-node__field"><span className="service-node__field-label">Network</span><Select className="service-node__input nodrag" value={selectedTarget?.networkId ?? ''} onChange={(event) => chooseTarget((target) => target.networkId === event.target.value)} disabled={!networkChoices.length}><option value="">Choose a discovered network…</option>{networkChoices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
            <label className="service-node__field"><span className="service-node__field-label">Port</span><Select className="service-node__input nodrag" value={selectedTarget?.port ? String(selectedTarget.port) : ''} onChange={(event) => chooseTarget((target) => String(target.port) === event.target.value)} disabled={!portChoices.length}><option value="">Choose a discovered port…</option>{portChoices.map((port) => <option key={port} value={port}>{port}</option>)}</Select></label>
            <label className="service-node__field"><span className="service-node__field-label">Origin</span><Select className="service-node__input nodrag" value={selectedTarget?.originUrl ?? ''} onChange={(event) => chooseTarget((target) => target.originUrl === event.target.value)} disabled={!hostTargets.length}><option value="">Choose a private origin…</option>{hostTargets.map((target) => <option key={`${target.id}-origin`} value={target.originUrl}>{target.originUrl}</option>)}</Select></label>
          </div>
          <label className="service-node__field"><span className="service-node__field-label">Hostname</span><Input className="service-node__input nodrag" value={hostname} onChange={(event) => { setHostname(event.target.value); saveSpec({ hostname: event.target.value }) }} placeholder="app.example.com" aria-invalid={hostname !== '' && !validCloudflareHostname(hostname)} /><span className="service-node__note">Must be a lowercase hostname inside the selected zone. Public or malformed origins are refused.</span></label>
          <label className="service-node__field"><span className="service-node__field-label">Tunnel name</span><Input className="service-node__input nodrag" value={tunnelName} onChange={(event) => { setTunnelName(event.target.value); saveSpec({ tunnelName: event.target.value }) }} /></label>
          <div className="cloudflare-tunnel-node__policy"><strong>Access policy: deny-first</strong><span>Everyone is denied before any later allow rule. DNS is not created until this policy is in place.</span></div>
          <div className="cloudflare-tunnel-node__actions"><Button variant="outlined" className="mc-button nodrag" disabled={busy || !tokenConfigured} onClick={() => void loadAccounts()}>Refresh accounts</Button><Button variant="outlined" className="mc-button nodrag" disabled={busy} onClick={() => void runPreflight()}>Run preflight</Button><Button variant="filled" className="mc-button mc-button--primary nodrag" disabled={busy || !checks.length || checks.some((check) => check.state === 'fail')} onClick={() => void apply()}>Create tunnel</Button><Button variant="outlined" className="mc-button nodrag" disabled={busy || !status || status.phase === 'idle'} onClick={() => void rollback()}>Rollback</Button></div>
          {!!checks.length && <div className="cloudflare-tunnel-node__checks" aria-live="polite"><strong>Preflight</strong>{checks.map((check) => <div key={check.id}><span aria-hidden="true">{checkIcon(check)}</span> <b>{check.label}</b>: {check.detail}{check.recovery ? <small> Recovery: {check.recovery}</small> : null}</div>)}</div>}
          {status && <p className="service-node__state" aria-live="polite">Status: {status.phase}{status.tunnelId ? ` · tunnel ${status.tunnelId}` : ''}{status.connectorContainerId ? ` · connector ${status.connectorContainerId}` : ''}</p>}
          {selectedTarget && <p className="service-node__note">Origin selected: {selectedTarget.originUrl} on {selectedTarget.hostLabel}. Token handoff uses a protected token file and a read-only, no-socket connector.</p>}
          {message && <p className="service-node__note mc-note--warn" role="status">{message}</p>}
        </div>
      </div>
    </>
  )
}
