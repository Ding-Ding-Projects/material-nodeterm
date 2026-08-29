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
import { useLocalizedVocabularyText } from '../lib/personalVocabulary/useLocalizedVocabularyText'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'

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
  const [snapshotName, setSnapshotName] = useState('install-state')
  const fill = nodeHeaderFillStyle(data.color)
  const text = useLocalizedVocabularyText()
  const modeSearch = useRegexSearchField()
  const modeSearchRef = useRef<HTMLInputElement>(null)
  const diskFormatSearch = useRegexSearchField()
  const diskFormatSearchRef = useRef<HTMLInputElement>(null)
  const modeOptions = useMemo(() => [
    { value: 'disposable-live', label: text('virtualMachine.mode.disposable', 'Disposable live, changes are discarded') },
    { value: 'persistent-install', label: text('virtualMachine.mode.persistent', 'Persistent install, keep the selected disk') }
  ].filter((option) => modeSearch.test(option.label)), [modeSearch.mode, modeSearch.query, modeSearch.pattern, modeSearch.flags, modeSearch.test, text])
  const diskFormatOptions = useMemo(() => [
    { value: 'unknown', label: text('virtualMachine.diskFormat.auto', 'Detect qcow2') },
    { value: 'qcow2', label: text('virtualMachine.diskFormat.qcow2', 'qcow2') },
    { value: 'raw', label: text('virtualMachine.diskFormat.raw', 'raw, explicitly confirmed') }
  ].filter((option) => diskFormatSearch.test(option.label)), [diskFormatSearch.mode, diskFormatSearch.query, diskFormatSearch.pattern, diskFormatSearch.flags, diskFormatSearch.test, text])

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
  const phase = status?.phase ?? 'unconfigured'
  const running = phase === 'running' || phase === 'starting'
  const modeLabel = config.mode === 'persistent-install'
    ? text('virtualMachine.mode.persistent', 'Persistent install, keep the selected disk')
    : text('virtualMachine.mode.disposable', 'Disposable live, changes are discarded')
  const readiness = useMemo(() => {
    if (!tools) return text('virtualMachine.status.checking', 'Checking bundled QEMU…')
    if (!tools.available) return tools.reason ?? text('virtualMachine.status.toolsMissing', 'Bundled QEMU is unavailable.')
    if (!local.isoPath) return text('virtualMachine.status.chooseIso', 'Choose a Linux ISO to continue.')
    if (config.mode === 'persistent-install' && !local.diskPath) return text('virtualMachine.status.chooseDisk', 'Persistent install mode needs a disk image.')
    return text('virtualMachine.status.networkOff', 'Ready. Network is off unless you explicitly enable it.')
  }, [tools, local.isoPath, local.diskPath, config.mode, text])
  const statusCopy = error || status?.error
    ? error || status?.error || ''
    : status?.message
      ? text(status.messageKey ?? 'virtualMachine.status.generic', status.message)
      : text('virtualMachine.status.configure', readiness)

  return (
    <div className={`term-node virtual-machine-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }}>
      <NodeResizer minWidth={430} minHeight={420} isVisible={selected} color={data.color} />
      <div className={`term-node__header ${fill.className}${fill.filled ? ' term-node__header--filled' : ''}`} style={fill.style}>
        <MaterialSymbol name="computer" />
        <EditableNodeTitle value={data.title} onChange={(next) => updateNodeData(id, { title: next })} emptyLabel={text('virtualMachine.title', 'Linux ISO VM')} title={text('virtualMachine.rename', 'Rename')} ariaLabel={text('virtualMachine.title', 'Linux ISO VM')} rejectEmpty={false} />
        <span className="term-node__spacer" />
        <button className="term-node__close" title={text('virtualMachine.close', 'Close')} aria-label={text('virtualMachine.close', 'Close')} onClick={() => deleteElements({ nodes: [{ id }] })}>×</button>
      </div>
      <div className="virtual-machine-node__body nodrag nowheel">
        <p className="virtual-machine-node__note">{text('virtualMachine.note', 'Linux ISO VM is separate from WSL. It runs one isolated QEMU machine with a loopback-only display.')}</p>
        <label className="virtual-machine-node__field"><span>{text('virtualMachine.iso', 'Linux ISO')}</span><div className="virtual-machine-node__path"><Input value={local.isoPath ?? ''} onChange={(event) => patchLocal({ isoPath: event.target.value || undefined })} placeholder="Choose an ISO file" aria-label={text('virtualMachine.iso', 'Linux ISO')} /><button type="button" onClick={() => void choose('isoPath')}>{text('virtualMachine.browse', 'Browse')}</button></div></label>
        <label className="virtual-machine-node__field"><span>{text('virtualMachine.expectedHash', 'Expected ISO SHA-256 (optional)')}</span><Input value={config.isoSha256 ?? ''} onChange={(event) => patchConfig({ isoSha256: event.target.value.trim().toLowerCase() || undefined })} placeholder="64 hexadecimal characters" aria-label={text('virtualMachine.expectedHash', 'Expected ISO SHA-256 (optional)')} /></label>
        <label className="virtual-machine-node__field"><span>{text('virtualMachine.mode', 'Mode')}</span><div className="menu-filter"><div className="menu-filter__row"><input ref={modeSearchRef} className="menu-filter__input" value={modeSearch.value} onChange={(event) => modeSearch.setValue(event.target.value)} placeholder={text('virtualMachine.searchMode', 'Search modes')} aria-label={text('virtualMachine.searchMode', 'Search modes')} /><AnchoredRegexBuilder search={modeSearch} fieldRef={modeSearchRef} label={text('virtualMachine.regexMode', 'Regex, mode search')} /></div></div><Select value={config.mode} onChange={(event) => patchConfig({ mode: event.target.value as VirtualMachineConfig['mode'] })} aria-label={text('virtualMachine.mode', 'Mode')}>{modeOptions.length ? modeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>) : <option value={config.mode}>{text('virtualMachine.noMatches', 'No modes match this filter.')}</option>}</Select></label>
        {config.mode === 'persistent-install' && <><label className="virtual-machine-node__field"><span>{text('virtualMachine.disk', 'Persistent disk')}</span><div className="virtual-machine-node__path"><Input value={local.diskPath ?? ''} onChange={(event) => patchLocal({ diskPath: event.target.value || undefined })} placeholder={text('virtualMachine.chooseDisk', 'Choose a qcow2 or raw disk')} aria-label={text('virtualMachine.disk', 'Persistent disk')} /><button type="button" onClick={() => void choose('diskPath')}>{text('virtualMachine.browse', 'Browse')}</button><button type="button" onClick={() => void api.dialog.selectFolder().then((folder) => folder && run(async () => { const next = await api.virtualMachine.createDisk(id, folder); updateNodeData(id, { virtualMachineConfig: { ...config, mode: 'persistent-install' }, virtualMachineLocalPaths: { ...local, diskPath: next.diskPath ?? undefined } }); return next }))}>{text('virtualMachine.createDisk', 'Create disk')}</button></div></label><label className="virtual-machine-node__field"><span>{text('virtualMachine.diskFormat', 'Disk format')}</span><div className="menu-filter"><div className="menu-filter__row"><input ref={diskFormatSearchRef} className="menu-filter__input" value={diskFormatSearch.value} onChange={(event) => diskFormatSearch.setValue(event.target.value)} placeholder={text('virtualMachine.searchDiskFormat', 'Search disk formats')} aria-label={text('virtualMachine.searchDiskFormat', 'Search disk formats')} /><AnchoredRegexBuilder search={diskFormatSearch} fieldRef={diskFormatSearchRef} label={text('virtualMachine.regexDiskFormat', 'Regex, disk-format search')} /></div></div><Select value={local.diskFormat ?? 'unknown'} onChange={(event) => patchLocal({ diskFormat: event.target.value as VirtualMachineLocalPaths['diskFormat'] })} aria-label={text('virtualMachine.diskFormat', 'Disk format')}>{diskFormatOptions.length ? diskFormatOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>) : <option value={local.diskFormat ?? 'unknown'}>{text('virtualMachine.noMatches', 'No disk formats match this filter.')}</option>}</Select></label></>}
        <div className="virtual-machine-node__grid">
          <label><span>{text('virtualMachine.memory', 'Memory (MiB)')}</span><Input type="number" min={512} max={32768} step={256} value={config.memoryMiB} onChange={(event) => patchConfig({ memoryMiB: clamp(Number(event.target.value), 512, 32768) })} aria-label={text('virtualMachine.memory', 'Memory (MiB)')} /></label>
          <label><span>{text('virtualMachine.cpus', 'CPUs')}</span><Input type="number" min={1} max={16} value={config.cpus} onChange={(event) => patchConfig({ cpus: clamp(Number(event.target.value), 1, 16) })} aria-label={text('virtualMachine.cpus', 'CPUs')} /></label>
        </div>
        <div className="virtual-machine-node__row"><span>{text('virtualMachine.network', 'Enable user-mode network')}</span><Switch checked={config.networkEnabled} onChange={(value) => patchConfig({ networkEnabled: value })} ariaLabel={text('virtualMachine.network', 'Enable user-mode network')} /></div>
        <div className="virtual-machine-node__row"><span>{text('virtualMachine.whpx', 'Prefer WHPX acceleration')}</span><Switch checked={config.whpxPreferred} onChange={(value) => patchConfig({ whpxPreferred: value })} ariaLabel={text('virtualMachine.whpx', 'Prefer WHPX acceleration')} /></div>
        <p className={`virtual-machine-node__status${error || status?.error ? ' is-error' : ''}`} role={error || status?.error ? 'alert' : 'status'}>{statusCopy}</p>
        {(busy || status?.phase === 'starting' || status?.phase === 'stopping') && <div className="virtual-machine-node__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={status?.progress ?? 0} aria-label={text('virtualMachine.progress', 'VM operation progress')}><span style={{ width: `${status?.progress ?? 0}%` }} /><strong>{status?.progress ?? 0}%</strong></div>}
        <p className="virtual-machine-node__hint">{readiness} {tools?.available ? `${text('virtualMachine.toolsBundled', 'Tools: bundled QEMU')}${tools.whpxAvailable ? `, ${text('virtualMachine.whpxAvailable', 'WHPX available')}.` : '.'}` : ''}</p>
        {status?.isoSha256Actual && <p className="virtual-machine-node__hint">{text('virtualMachine.isoActual', 'ISO SHA-256 actual:')} <code>{status.isoSha256Actual}</code>{status.isoSha256Expected ? `, ${text('virtualMachine.isoExpected', 'expected')} ${status.isoSha256Expected}` : ''}</p>}
        {status?.diskPath && <p className="virtual-machine-node__hint">{text('virtualMachine.diskSummary', 'Disk format:')} {status.diskFormat}; {text('virtualMachine.freeSpace', 'free space:')} {status.diskFreeBytes === null ? text('virtualMachine.unavailable', 'unavailable') : `${(status.diskFreeBytes / (1024 ** 3)).toFixed(1)} GiB`}</p>}
        <div className="virtual-machine-node__actions"><button type="button" disabled={busy || running} onClick={() => void configure()}>{text('virtualMachine.save', 'Save configuration')}</button><button type="button" disabled={busy || !status?.configured || running} onClick={() => void run(() => api.virtualMachine.start(id))}>{text('virtualMachine.start', 'Start')}</button><button type="button" disabled={busy || !running} onClick={() => void run(() => api.virtualMachine.stop(id))}>{text('virtualMachine.stop', 'Stop')}</button>{busy && <button type="button" onClick={() => void api.virtualMachine.cancel(id).then(() => setBusy(false)).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))}>{text('virtualMachine.cancel', 'Cancel')}</button>}</div>
        {status?.displayUrl && <div className="virtual-machine-node__display"><p>Loopback display: <code>{status.displayUrl}</code></p><button type="button" disabled={busy || !running} onClick={() => void api.virtualMachine.openDisplay(id).then((result) => { if (!result.ok) setError(result.error) })}>{text('virtualMachine.openDisplay', 'Open display')}</button></div>}
        {running && <div className="virtual-machine-node__snapshot"><Input value={snapshotName} onChange={(event) => setSnapshotName(event.target.value)} aria-label={text('virtualMachine.snapshotName', 'Snapshot name')} placeholder={text('virtualMachine.snapshotName', 'Snapshot name')} /><button type="button" disabled={busy || !SAFE_SNAPSHOT.test(snapshotName)} onClick={() => void run(() => api.virtualMachine.snapshot(id, snapshotName))}>{text('virtualMachine.snapshot', 'Snapshot')}</button><button type="button" disabled={busy || !SAFE_SNAPSHOT.test(snapshotName)} onClick={() => void run(() => api.virtualMachine.restore(id, snapshotName))}>{text('virtualMachine.restore', 'Restore')}</button></div>}
        <span className="virtual-machine-node__mode" aria-label={text('virtualMachine.mode', 'Mode')}>{modeLabel}</span>
      </div>
    </div>
  )
}

const SAFE_SNAPSHOT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
