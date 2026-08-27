import { useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import { DEFAULT_VIRTUAL_MACHINE_CONFIG, type VirtualMachineConfig, type VirtualMachineLocalPaths, type VirtualMachineStatus, type VirtualMachineToolStatus } from '@shared/virtual-machine'
import { useSession } from '../session/session'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { Switch } from '../ui/Switch'
import { MaterialSymbol } from '../components/MaterialSymbol'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import { useI18n } from '../lib/i18n'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(value)))

/** A guided one-shot VM surface. Paths are selected on this machine and the portable config is
 * kept separately, so cloning the project never launches a VM or points at another user's disk. */
export default function VirtualMachineNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { api } = useSession()
  const { updateNodeData, deleteElements } = useReactFlow()
  const config: VirtualMachineConfig = (data.virtualMachineConfig as VirtualMachineConfig | undefined) ?? DEFAULT_VIRTUAL_MACHINE_CONFIG
  const local: VirtualMachineLocalPaths = (data.virtualMachineLocalPaths as VirtualMachineLocalPaths | undefined) ?? {}
  const [status, setStatus] = useState<VirtualMachineStatus | null>(null)
  const [tools, setTools] = useState<VirtualMachineToolStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [snapshotName, setSnapshotName] = useState('install-state')
  const [restoreSnapshotName, setRestoreSnapshotName] = useState('')
  const snapshotSearch = useRegexSearchField({ mode: 'text' })
  const snapshotSearchRef = useRef<HTMLInputElement>(null)
  const modeSearch = useRegexSearchField({ mode: 'text' })
  const modeSearchRef = useRef<HTMLInputElement>(null)
  const fill = nodeHeaderFillStyle(data.color)
  const { ts } = useI18n()

  useEffect(() => {
    let active = true
    void Promise.all([api.virtualMachine.status(id), api.virtualMachine.tools()]).then(([next, available]) => {
      if (!active) return
      setStatus(next)
      setTools(available)
    }).catch((cause) => active && setError(cause instanceof Error ? cause.message : 'Unable to read VM status.'))
    const off = api.virtualMachine.onEvent((event) => event.id === id && setStatus(event.status))
    return () => { active = false; off() }
  }, [api, id])

  const patchConfig = (patch: Partial<VirtualMachineConfig>): void => {
    const next = { ...config, ...patch }
    updateNodeData(id, { virtualMachineConfig: next })
  }
  const patchLocal = (patch: Partial<VirtualMachineLocalPaths>): void => {
    updateNodeData(id, { virtualMachineLocalPaths: { ...local, ...patch } })
  }
  const choose = async (kind: 'isoPath' | 'diskPath'): Promise<void> => {
    const selectedPath = await api.dialog.selectFile()
    if (selectedPath) patchLocal({ [kind]: selectedPath })
  }
  const run = async (operation: () => Promise<VirtualMachineStatus>): Promise<void> => {
    setBusy(true)
    setError('')
    try { setStatus(await operation()) } catch (cause) { setError(cause instanceof Error ? cause.message : 'The VM operation failed.') }
    finally { setBusy(false) }
  }
  const configure = (): Promise<void> => run(async () => {
    const next = await api.virtualMachine.configure(id, config, local)
    updateNodeData(id, { virtualMachineConfig: config, virtualMachineLocalPaths: local })
    return next
  })
  const stop = async (): Promise<void> => {
    setStopping(true)
    setError('')
    try { setStatus(await api.virtualMachine.stop(id)) } catch (cause) { setError(cause instanceof Error ? cause.message : 'The VM stop operation failed.') }
    finally { setStopping(false) }
  }
  const phase = status?.phase ?? 'unconfigured'
  const running = phase === 'running' || phase === 'starting'
  const modeLabel = config.mode === 'persistent-install' ? 'Persistent install' : 'Disposable live'
  const visibleSnapshots = useMemo(
    () => (status?.snapshotNames ?? []).filter((name) => snapshotSearch.test(name)),
    [status?.snapshotNames, snapshotSearch]
  )
  const selectedSnapshot = visibleSnapshots.includes(restoreSnapshotName)
    ? restoreSnapshotName
    : visibleSnapshots[0] ?? ''
  const modeOptions: Array<{ value: VirtualMachineConfig['mode']; label: string }> = [
    { value: 'disposable-live', label: ts('virtualMachine.mode.disposable', 'Disposable live, changes are discarded') },
    { value: 'persistent-install', label: ts('virtualMachine.mode.persistent', 'Persistent install, keep the selected disk') }
  ]
  const visibleModeOptions = modeOptions.filter((option) => option.value === config.mode || modeSearch.test(option.label))
  const readiness = useMemo(() => {
    if (!tools) return 'Checking bundled QEMU…'
    if (!tools.available) return tools.reason ?? 'Bundled QEMU is unavailable.'
    if (!local.isoPath) return 'Choose a Linux ISO to continue.'
    if (config.mode === 'persistent-install' && !local.diskPath) return 'Persistent install mode needs a disk image.'
    return 'Ready. Network is off unless you explicitly enable it.'
  }, [tools, local.isoPath, local.diskPath, config.mode])

  return (
    <div className={`term-node virtual-machine-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }}>
      <NodeResizer minWidth={430} minHeight={420} isVisible={selected} color={data.color} />
      <div className={`term-node__header ${fill.className}${fill.filled ? ' term-node__header--filled' : ''}`} style={fill.style}>
        <MaterialSymbol name="computer" />
        <EditableNodeTitle value={data.title} onChange={(next) => updateNodeData(id, { title: next })} emptyLabel={ts('virtualMachine.title', 'Linux ISO VM')} title="Rename" ariaLabel={ts('virtualMachine.title', 'Linux ISO VM')} rejectEmpty={false} />
        <span className="term-node__spacer" />
        <button className="term-node__close" title="Close" onClick={() => deleteElements({ nodes: [{ id }] })}>×</button>
      </div>
      <div className="virtual-machine-node__body nodrag nowheel">
        <p className="virtual-machine-node__note">{ts('virtualMachine.note', 'Linux ISO VM is separate from WSL. It runs one isolated QEMU machine with a loopback-only display.')}</p>
        <label className="virtual-machine-node__field"><span>{ts('virtualMachine.iso', 'Linux ISO')}</span><div className="virtual-machine-node__path"><Input value={local.isoPath ?? ''} onChange={(event) => patchLocal({ isoPath: event.target.value || undefined })} placeholder="Choose an ISO file" aria-label={ts('virtualMachine.iso', 'Linux ISO')} /><button type="button" onClick={() => void choose('isoPath')}>{ts('virtualMachine.browse', 'Browse')}</button></div></label>
        <label className="virtual-machine-node__field"><span>{ts('virtualMachine.expectedHash', 'Expected ISO SHA-256 (optional)')}</span><Input value={config.isoSha256 ?? ''} onChange={(event) => patchConfig({ isoSha256: event.target.value.trim().toLowerCase() || undefined })} placeholder="64 hexadecimal characters" aria-label={ts('virtualMachine.expectedHash', 'Expected ISO SHA-256 (optional)')} /></label>
        <label className="virtual-machine-node__field"><span>{ts('virtualMachine.mode', 'Mode')}</span><div className="virtual-machine-node__picker-search"><Input ref={modeSearchRef} value={modeSearch.value} onChange={(event) => modeSearch.setValue(event.target.value)} aria-label={ts('virtualMachine.mode.filter', 'Filter VM modes')} placeholder={modeSearch.mode === 'regex' ? ts('virtualMachine.mode.filterRegex', 'Filter VM modes with regex') : ts('virtualMachine.mode.filter', 'Filter VM modes')} /><AnchoredRegexBuilder search={modeSearch} fieldRef={modeSearchRef} label={ts('virtualMachine.mode.regex', 'Regex for VM modes')} /></div>{modeSearch.error && <span className="virtual-machine-node__hint" role="alert">{modeSearch.error}</span>}<Select value={config.mode} onChange={(event) => patchConfig({ mode: event.target.value as VirtualMachineConfig['mode'] })} aria-label={ts('virtualMachine.mode', 'Mode')}>{visibleModeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></label>
        {config.mode === 'persistent-install' && <label className="virtual-machine-node__field"><span>{ts('virtualMachine.disk', 'Persistent disk')}</span><div className="virtual-machine-node__path"><Input value={local.diskPath ?? ''} onChange={(event) => patchLocal({ diskPath: event.target.value || undefined })} placeholder="Choose a qcow2 or raw disk" aria-label={ts('virtualMachine.disk', 'Persistent disk')} /><button type="button" onClick={() => void choose('diskPath')}>{ts('virtualMachine.browse', 'Browse')}</button><button type="button" onClick={() => void api.dialog.selectFolder().then((folder) => folder && run(async () => { const next = await api.virtualMachine.createDisk(id, folder); updateNodeData(id, { virtualMachineConfig: { ...config, mode: 'persistent-install' }, virtualMachineLocalPaths: { ...local, diskPath: next.diskPath ?? undefined } }); return next }))}>{ts('virtualMachine.createDisk', 'Create disk')}</button></div></label>}
        <div className="virtual-machine-node__grid">
          <label><span>{ts('virtualMachine.memory', 'Memory (MiB)')}</span><Input type="number" min={512} max={32768} step={256} value={config.memoryMiB} onChange={(event) => patchConfig({ memoryMiB: clamp(Number(event.target.value), 512, 32768) })} aria-label={ts('virtualMachine.memory', 'Memory (MiB)')} /></label>
          <label><span>{ts('virtualMachine.cpus', 'CPUs')}</span><Input type="number" min={1} max={16} value={config.cpus} onChange={(event) => patchConfig({ cpus: clamp(Number(event.target.value), 1, 16) })} aria-label={ts('virtualMachine.cpus', 'CPUs')} /></label>
        </div>
        <div className="virtual-machine-node__row"><span>{ts('virtualMachine.network', 'Enable user-mode network')}</span><Switch checked={config.networkEnabled} onChange={(value) => patchConfig({ networkEnabled: value })} ariaLabel={ts('virtualMachine.network', 'Enable user-mode network')} /></div>
        <div className="virtual-machine-node__row"><span>{ts('virtualMachine.whpx', 'Prefer WHPX acceleration')}</span><Switch checked={config.whpxPreferred} onChange={(value) => patchConfig({ whpxPreferred: value })} ariaLabel={ts('virtualMachine.whpx', 'Prefer WHPX acceleration')} /></div>
        <p className={`virtual-machine-node__status${error || status?.error ? ' is-error' : ''}`} role={error || status?.error ? 'alert' : 'status'}>{error || status?.error || status?.message || readiness}</p>
        <p className="virtual-machine-node__hint">{readiness} {tools?.available ? `Tools: bundled QEMU${tools.whpxAvailable ? ', WHPX available.' : '.'}` : ''}</p>
        {status?.isoSha256Actual && <p className="virtual-machine-node__hint">ISO SHA-256 actual: <code>{status.isoSha256Actual}</code>{status.isoSha256Expected ? `, expected ${status.isoSha256Expected}` : ''}</p>}
        {status?.diskPath && <p className="virtual-machine-node__hint">Disk format: {status.diskFormat}; free space: {status.diskFreeBytes === null ? 'unavailable' : `${(status.diskFreeBytes / (1024 ** 3)).toFixed(1)} GiB`}</p>}
        <div className="virtual-machine-node__actions"><button type="button" disabled={busy || stopping || running} onClick={() => void configure()}>{ts('virtualMachine.save', 'Save configuration')}</button><button type="button" disabled={busy || stopping || !status?.configured || running} onClick={() => void run(() => api.virtualMachine.start(id))}>{ts('virtualMachine.start', 'Start')}</button><button type="button" disabled={stopping || !running} onClick={() => void stop()}>{ts('virtualMachine.stop', 'Stop')}</button></div>
        {status?.displayUrl && <div className="virtual-machine-node__display"><p>Loopback display: <code>{status.displayUrl}</code></p><button type="button" disabled={busy || stopping || !running} onClick={() => void api.virtualMachine.openDisplay(id).then((result) => { if (!result.ok) setError(result.error) })}>{ts('virtualMachine.openDisplay', 'Open display')}</button></div>}
        {running && <div className="virtual-machine-node__snapshot"><Input value={snapshotName} onChange={(event) => setSnapshotName(event.target.value)} aria-label={ts('virtualMachine.snapshot.newName', 'New snapshot name')} placeholder={ts('virtualMachine.snapshot.newName', 'New snapshot name')} /><button type="button" disabled={busy || stopping || !SAFE_SNAPSHOT.test(snapshotName)} onClick={() => void run(() => api.virtualMachine.snapshot(id, snapshotName))}>{ts('virtualMachine.snapshot', 'Snapshot')}</button><div className="virtual-machine-node__snapshot-search"><Input ref={snapshotSearchRef} value={snapshotSearch.value} onChange={(event) => snapshotSearch.setValue(event.target.value)} aria-label={ts('virtualMachine.snapshot.filter', 'Filter saved snapshots')} placeholder={snapshotSearch.mode === 'regex' ? ts('virtualMachine.snapshot.filterRegex', 'Filter snapshots with regex') : ts('virtualMachine.snapshot.filter', 'Filter saved snapshots')} /><AnchoredRegexBuilder search={snapshotSearch} fieldRef={snapshotSearchRef} label={ts('virtualMachine.snapshot.regex', 'Regex for saved snapshots')} /></div>{snapshotSearch.error && <p className="virtual-machine-node__hint" role="alert">{snapshotSearch.error}</p>}<Select value={selectedSnapshot} onChange={(event) => setRestoreSnapshotName(event.target.value)} aria-label={ts('virtualMachine.snapshot.restoreChoice', 'Saved snapshot to restore')} disabled={visibleSnapshots.length === 0}><option value="" disabled>{status?.snapshotNames.length ? ts('virtualMachine.snapshot.noMatch', 'No snapshots match the filter') : ts('virtualMachine.snapshot.none', 'Create a snapshot before restoring')}</option>{visibleSnapshots.map((name) => <option key={name} value={name}>{name}</option>)}</Select><button type="button" disabled={busy || stopping || !selectedSnapshot} onClick={() => void run(() => api.virtualMachine.restore(id, selectedSnapshot))}>{ts('virtualMachine.restore', 'Restore')}</button></div>}
        <span className="virtual-machine-node__mode" aria-label="VM mode">{modeLabel}</span>
      </div>
    </div>
  )
}

const SAFE_SNAPSHOT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

