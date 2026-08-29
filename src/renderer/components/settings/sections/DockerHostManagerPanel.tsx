import { useEffect, useMemo, useState } from 'react'
import type {
  DockerContainerSummary,
  DockerContainerStats,
  DockerHostTarget,
  DockerHostVerification,
  DockerImageSummary,
  DockerNetworkSummary,
  DockerVolumeSummary
} from '@shared/docker-host'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'
import { Select } from '@renderer/ui/Select'
import { FieldRow } from '../FieldRow'
import { openDestructiveGate } from '../../../state/destructiveGate'

type InventoryTab = 'containers' | 'images' | 'volumes' | 'networks'

/** A typed Docker inventory and lifecycle surface. All values are selected or validated before
 * entering the main-process manager; this component never constructs a shell command. */
export function DockerHostManagerPanel(): React.JSX.Element {
  const api = window.nodeTerminal.dockerHost
  const [hosts, setHosts] = useState<DockerHostTarget[]>([])
  const [sshServers, setSshServers] = useState<Array<{ id: string; label: string }>>([])
  const [hostId, setHostId] = useState('')
  const [label, setLabel] = useState('Local Docker')
  const [kind, setKind] = useState<'local' | 'ssh'>('local')
  const [context, setContext] = useState('')
  const [serverId, setServerId] = useState('')
  const [localContexts, setLocalContexts] = useState<Array<{ name: string; current: boolean; endpoint: string }>>([])
  const [tab, setTab] = useState<InventoryTab>('containers')
  const [query, setQuery] = useState('')
  const [regexOpen, setRegexOpen] = useState(false)
  const [regex, setRegex] = useState('')
  const [regexMode, setRegexMode] = useState(false)
  const [verification, setVerification] = useState<DockerHostVerification | null>(null)
  const [containers, setContainers] = useState<DockerContainerSummary[]>([])
  const [images, setImages] = useState<DockerImageSummary[]>([])
  const [volumes, setVolumes] = useState<DockerVolumeSummary[]>([])
  const [networks, setNetworks] = useState<DockerNetworkSummary[]>([])
  const [status, setStatus] = useState('No Docker host selected.')
  const [busy, setBusy] = useState(false)
  const [statsById, setStatsById] = useState<Record<string, DockerContainerStats>>({})
  const [logs, setLogs] = useState('')
  const [execProgram, setExecProgram] = useState<'sh' | 'bash' | 'node' | 'python' | 'env'>('env')
  const [execArgs, setExecArgs] = useState('')
  const [execContainer, setExecContainer] = useState('')

  useEffect(() => {
    let active = true
    void Promise.all([api.listHosts(), window.nodeTerminal.ssh.list()]).then(([found, servers]) => {
      if (!active) return
      setHosts(found)
      setSshServers(servers.map((server) => ({ id: server.id, label: server.label })))
      if (found[0]) setHostId(found[0].id)
      if (servers[0]) setServerId(servers[0].id)
    }).catch((error) => active && setStatus(error instanceof Error ? error.message : String(error)))
    return () => { active = false }
  }, [api])

  useEffect(() => {
    if (!hostId) { setLocalContexts([]); return }
    void api.listContexts(hostId).then(setLocalContexts).catch(() => setLocalContexts([]))
  }, [api, hostId])

  const selected = hosts.find((host) => host.id === hostId)
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const pattern = regexMode && regex ? (() => { try { return new RegExp(regex, 'i') } catch { return null } })() : null
    const matches = (value: string) => pattern ? pattern.test(value) : !needle || value.toLowerCase().includes(needle)
    if (tab === 'containers') return containers.filter((row) => matches(`${row.name} ${row.image} ${row.status}`))
    if (tab === 'images') return images.filter((row) => matches(`${row.repository}:${row.tag} ${row.id}`))
    if (tab === 'volumes') return volumes.filter((row) => matches(`${row.name} ${row.driver}`))
    return networks.filter((row) => matches(`${row.name} ${row.driver}`))
  }, [containers, images, networks, query, regex, regexMode, tab, volumes])

  const refresh = async (id = hostId) => {
    if (!id) return
    setBusy(true)
    setStatus('Reading Docker inventory…')
    try {
      const snapshot = await api.inventory(id)
      setVerification(snapshot.verification)
      setContainers(snapshot.containers)
      setImages(snapshot.images)
      setVolumes(snapshot.volumes)
      setNetworks(snapshot.networks)
      setStatus(snapshot.verification
        ? (snapshot.verification.reachable ? `Connected to ${snapshot.host.label}.` : snapshot.verification.error ?? 'Docker host is unavailable.')
        : 'Docker host verification is unavailable.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally { setBusy(false) }
  }

  const save = async () => {
    setBusy(true)
    try {
      const host = await api.saveHost({ label, transport: kind === 'local' ? { kind, ...(context.trim() ? { context: context.trim() } : {}) } : { kind, serverId } })
      setHosts(await api.listHosts())
      setHostId(host.id)
      setStatus(`Saved ${host.label}. Verify it before starting an operation.`)
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  const removeContainer = async (id: string) => {
    if (!hostId) return
    try {
      const preview = await api.previewDestructive({ hostId, kind: 'container-remove', ids: [id] })
      openDestructiveGate({
        title: preview.title,
        description: preview.detail,
        affected: preview.targetIds,
        confirmLabel: 'Remove container',
        onConfirm: () => void api.removeContainers(hostId, [id], true).then(() => refresh()).catch((error) => setStatus(error instanceof Error ? error.message : String(error)))
      })
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
  }

  const loadStats = async (id: string) => {
    try {
      const found = await api.stats(hostId, [id])
      if (found[0]) setStatsById((current) => ({ ...current, [id]: found[0] }))
      setStatus(found[0] ? `Stats refreshed for ${id}.` : 'Docker returned no stats for that container.')
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
  }

  const loadLogs = async (id: string) => {
    try { setLogs(await api.logs(hostId, { containerId: id, tail: 200, timestamps: true })); setStatus(`Showing the latest 200 lines for ${id}.`) }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
  }

  const runTypedExec = async () => {
    if (!execContainer) return
    try {
      const result = await api.exec(hostId, { containerId: execContainer, program: execProgram, args: execArgs.trim() ? execArgs.trim().split(/\s+/) : [] })
      setLogs([result.stdout, result.stderr].filter(Boolean).join('\n'))
      setStatus(`Typed ${execProgram} exited with code ${result.exitCode}.`)
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
  }

  return (
    <div className="mt-5 space-y-4 rounded-xl border border-border bg-surface p-4" aria-label="Docker host manager">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-[15px] font-semibold text-text">Docker host manager</h4>
          <p className="text-sm text-muted">Local and saved SSH hosts, with typed inventory and lifecycle actions.</p>
        </div>
        <Button disabled={!hostId || busy} onClick={() => void refresh()}>Refresh inventory</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <FieldRow label="Configured host" control={<Select value={hostId} onChange={(event) => { setHostId(event.target.value); void refresh(event.target.value) }}><option value="">Choose a host</option>{hosts.map((host) => <option key={host.id} value={host.id}>{host.label} · {host.endpoint}</option>)}</Select>} />
        <FieldRow label="Transport" control={<Select value={kind} onChange={(event) => setKind(event.target.value as 'local' | 'ssh')}><option value="local">Local Docker CLI</option><option value="ssh">SSH Docker CLI</option></Select>} />
        <FieldRow label="Host label" control={<Input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={128} />} />
        {kind === 'local' ? <FieldRow label="Docker context" control={<Select value={context} onChange={(event) => setContext(event.target.value)}><option value="">Current context</option>{localContexts.map((item) => <option key={item.name} value={item.name}>{item.name}{item.current ? ' (current)' : ''}</option>)}</Select>} /> : <FieldRow label="Saved SSH host" control={<Select value={serverId} onChange={(event) => setServerId(event.target.value)}><option value="">Choose a saved SSH host</option>{sshServers.map((server) => <option key={server.id} value={server.id}>{server.label}</option>)}</Select>} />}
      </div>
      <div className="flex flex-wrap gap-2"><Button disabled={busy || !label.trim() || (kind === 'ssh' && !serverId)} onClick={() => void save()}>Save host</Button>{selected ? <Button disabled={busy} onClick={() => void api.verify(selected.id).then(setVerification).catch((error) => setStatus(error instanceof Error ? error.message : String(error)))}>Verify host</Button> : null}</div>
      <p className="text-sm text-muted" role="status">{status}</p>
      {verification ? <div className="grid gap-2 rounded-lg bg-surface-container p-3 text-sm sm:grid-cols-4"><span>State: {verification.reachable ? 'Reachable' : 'Unavailable'}</span><span>Engine: {verification.serverVersion ?? 'Unknown'}</span><span>Containers: {verification.containers ?? 'Unknown'}</span><span>Images: {verification.images ?? 'Unknown'}</span></div> : null}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Docker inventory types">{(['containers', 'images', 'volumes', 'networks'] as const).map((value) => <Button key={value} aria-selected={tab === value} onClick={() => setTab(value)}>{value[0].toUpperCase() + value.slice(1)}</Button>)}</div>
      <div className="flex flex-wrap items-center gap-2"><Input aria-label="Search Docker inventory" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this inventory" /><Button aria-expanded={regexOpen} onClick={() => setRegexOpen((open) => !open)}>Regex builder</Button>{regexMode ? <span className="text-xs text-muted">Regex enabled</span> : null}</div>
      {regexOpen ? <div className="rounded-lg border border-border bg-surface-container p-3"><label className="text-sm text-muted">Pattern<Input aria-label="Docker inventory regex pattern" value={regex} onChange={(event) => setRegex(event.target.value)} /></label><div className="mt-2 flex gap-2"><Button onClick={() => setRegexMode((enabled) => !enabled)}>{regexMode ? 'Use plain text' : 'Use regex'}</Button><span className="text-xs text-muted">JavaScript regex, invalid patterns stay in search until corrected.</span></div></div> : null}
      <div role="tabpanel" aria-label={`${tab} inventory`} className="max-h-72 overflow-auto rounded-lg border border-border">{tab === 'containers' ? (rows as DockerContainerSummary[]).map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3 text-sm"><span><strong>{row.name}</strong> · {row.image} · {row.state}{statsById[row.id] ? ` · CPU ${statsById[row.id].cpuPercent ?? 'unknown'}%` : ''}</span><span className="flex flex-wrap gap-2"><Button onClick={() => void (row.state === 'running' ? api.stopContainer(hostId, row.id) : api.startContainer(hostId, row.id)).then(() => refresh()).catch((error) => setStatus(error instanceof Error ? error.message : String(error)))}>{row.state === 'running' ? 'Stop' : 'Start'}</Button><Button onClick={() => void loadStats(row.id)}>Stats</Button><Button onClick={() => void loadLogs(row.id)}>Logs</Button><Button onClick={() => { setExecContainer(row.id); setTab('containers') }}>Exec</Button><Button onClick={() => void removeContainer(row.id)}>Remove</Button></span></div>) : null}{tab === 'images' ? (rows as DockerImageSummary[]).map((row) => <div key={row.id} className="border-b border-border p-3 text-sm"><strong>{row.repository}:{row.tag}</strong> · {row.sizeBytes ? `${Math.round(row.sizeBytes / 1024 / 1024)} MB` : 'size unknown'} · {row.id}</div>) : null}{tab === 'volumes' ? (rows as DockerVolumeSummary[]).map((row) => <div key={row.name} className="border-b border-border p-3 text-sm"><strong>{row.name}</strong> · {row.driver} · {row.mountpoint}</div>) : null}{tab === 'networks' ? (rows as DockerNetworkSummary[]).map((row) => <div key={row.id} className="border-b border-border p-3 text-sm"><strong>{row.name}</strong> · {row.driver} · {row.scope}</div>) : null}{rows.length === 0 ? <p className="p-4 text-sm text-muted">No matching inventory records.</p> : null}</div>
      {execContainer ? <div className="grid gap-2 rounded-lg bg-surface-container p-3 md:grid-cols-[12rem_1fr_auto]"><Select aria-label="Typed executable" value={execProgram} onChange={(event) => setExecProgram(event.target.value as typeof execProgram)}><option value="env">env</option><option value="sh">sh</option><option value="bash">bash</option><option value="node">node</option><option value="python">python</option></Select><Input aria-label="Typed executable arguments" value={execArgs} onChange={(event) => setExecArgs(event.target.value)} placeholder="Arguments, no inline shell" /><Button onClick={() => void runTypedExec()}>Run typed exec</Button></div> : null}
      {logs ? <pre className="max-h-48 overflow-auto rounded-lg bg-surface-container p-3 text-xs" aria-label="Docker output">{logs}</pre> : null}
    </div>
  )
}
