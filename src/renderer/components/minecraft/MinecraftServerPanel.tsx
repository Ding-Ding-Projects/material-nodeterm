import { useEffect, useRef, useState } from 'react'
import type {
  MinecraftConsoleLine,
  MinecraftServerStatus,
  MinecraftVersionList
} from '@shared/minecraft'
import { useSession } from '../../session/session'
import { openDestructiveGate } from '../../state/destructiveGate'

const CONSOLE_CAP = 400

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Java's own state, distinguished the way it actually needs to be: "nothing installed" and
 *  "installed but not new enough" are different problems with different fixes, and collapsing
 *  them into one grey "unavailable" line sends the user to fix the wrong thing. */
function JavaLine({ status }: { status: MinecraftServerStatus }): React.JSX.Element {
  if (status.installedJavaMajor === null) {
    return (
      <p className="service-node__note mc-note--warn">
        No Java runtime is installed yet
        {status.requiredJavaMajor ? ` — Java ${status.requiredJavaMajor} will be installed automatically when needed` : ''}.
      </p>
    )
  }
  if (!status.javaOk) {
    return <p className="service-node__note mc-note--warn">{status.javaReason}</p>
  }
  return (
    <p className="service-node__note">
      Java {status.installedJavaMajor} detected
      {status.requiredJavaMajor ? ` (this version needs Java ${status.requiredJavaMajor}).` : '.'}
    </p>
  )
}

function VersionPicker({
  versions,
  selected,
  onSelect,
  showAll,
  onShowAllChange,
  idPrefix
}: {
  versions: MinecraftVersionList
  selected: string
  onSelect: (id: string) => void
  showAll: boolean
  onShowAllChange: (v: boolean) => void
  idPrefix: string
}): React.JSX.Element {
  const visible = showAll ? versions.versions : versions.versions.filter((v) => v.type === 'release')
  return (
    <>
      <label className="service-node__field" htmlFor={`${idPrefix}-version`}>
        <span className="service-node__field-label">Version</span>
        <select
          id={`${idPrefix}-version`}
          className="service-node__input nodrag"
          value={selected}
          onChange={(e) => onSelect(e.target.value)}
        >
          {visible.map((v) => (
            <option key={v.id} value={v.id}>
              {v.id}
              {v.type !== 'release' ? ` (${v.type})` : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="mc-checkbox nodrag">
        <input type="checkbox" checked={showAll} onChange={(e) => onShowAllChange(e.target.checked)} />
        Show snapshots and old versions
      </label>
    </>
  )
}

export function MinecraftServerPanel({ nodeId }: { nodeId: string }): React.JSX.Element {
  const { api } = useSession()
  const [status, setStatus] = useState<MinecraftServerStatus | null>(null)
  const [versions, setVersions] = useState<MinecraftVersionList | null>(null)
  const [showAllVersions, setShowAllVersions] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState('')
  const [selectedDir, setSelectedDir] = useState('')
  const [showInstallForm, setShowInstallForm] = useState(false)
  const [eulaChecked, setEulaChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [consoleLines, setConsoleLines] = useState<MinecraftConsoleLine[]>([])
  const [commandDraft, setCommandDraft] = useState('')
  const consoleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void api.minecraft.status(nodeId).then((s) => {
      if (!cancelled) setStatus(s)
    })
    void api.minecraft.versions().then((v) => {
      if (cancelled) return
      setVersions(v)
      setSelectedVersion((cur) => cur || v.latestRelease || v.versions[0]?.id || '')
    })
    void api.minecraft.recentConsole(nodeId).then((lines) => {
      if (!cancelled) setConsoleLines(lines)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  useEffect(() => {
    return api.minecraft.onEvent((event) => {
      if (event.id !== nodeId) return
      if (event.kind === 'status') {
        setStatus(event.status)
        if (event.status.phase === 'needs-eula') setEulaChecked(false)
      } else {
        setConsoleLines((prev) => {
          const next = [...prev, event.line]
          return next.length > CONSOLE_CAP ? next.slice(next.length - CONSOLE_CAP) : next
        })
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  useEffect(() => {
    const el = consoleRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [consoleLines])

  useEffect(() => {
    if (status?.versionId && !showInstallForm) setSelectedVersion(status.versionId)
  }, [status?.versionId, showInstallForm])

  const pickDirectory = async (): Promise<void> => {
    const dir = await api.dialog.selectFolder()
    if (dir) setSelectedDir(dir)
  }

  const handleCreate = async (): Promise<void> => {
    if (!selectedVersion || !selectedDir) return
    setBusy(true)
    try {
      await api.minecraft.create({ id: nodeId, dir: selectedDir, versionId: selectedVersion })
      setShowInstallForm(false)
    } finally {
      setBusy(false)
    }
  }

  const handleAcceptEula = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.minecraft.acceptEula(nodeId)
    } finally {
      setBusy(false)
    }
  }

  const handleStart = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.minecraft.start(nodeId)
    } finally {
      setBusy(false)
    }
  }

  const requestStop = (e: React.MouseEvent<HTMLButtonElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    openDestructiveGate({
      title: 'Stop the Minecraft server',
      description:
        'Sends the server its normal shutdown command. It saves the world and disconnects any connected players before it exits.',
      affected: status?.dir ? [status.dir] : undefined,
      confirmLabel: 'Stop server',
      anchor: { x: rect.left, y: rect.bottom },
      restoreFocusEl: e.currentTarget,
      onConfirm: () => {
        void api.minecraft.stop(nodeId)
      }
    })
  }

  const requestDelete = (e: React.MouseEvent<HTMLButtonElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    openDestructiveGate({
      title: 'Delete this Minecraft server',
      description:
        'Permanently removes the server jar, its configuration and its world from disk. This cannot be undone.',
      affected: status?.dir ? [status.dir] : undefined,
      confirmLabel: 'Delete permanently',
      anchor: { x: rect.left, y: rect.bottom },
      restoreFocusEl: e.currentTarget,
      onConfirm: () => {
        void api.minecraft.remove(nodeId, true)
      }
    })
  }

  const handleSendCommand = async (): Promise<void> => {
    const cmd = commandDraft.trim()
    if (!cmd) return
    const ok = await api.minecraft.sendCommand(nodeId, cmd)
    if (ok) setCommandDraft('')
  }

  if (!status) {
    return (
      <div className="service-node__body">
        <p className="service-node__note">Loading…</p>
      </div>
    )
  }

  const configured = !!status.dir && !!status.versionId
  const idPrefix = `${nodeId}-mc`

  const installForm = versions ? (
    <>
      <VersionPicker
        versions={versions}
        selected={selectedVersion}
        onSelect={setSelectedVersion}
        showAll={showAllVersions}
        onShowAllChange={setShowAllVersions}
        idPrefix={idPrefix}
      />
      <div className="service-node__field">
        <span className="service-node__field-label">Server folder</span>
        <div className="mc-row">
          <button type="button" className="mc-button nodrag" onClick={() => void pickDirectory()}>
            Choose folder…
          </button>
          <span className="mc-path" title={selectedDir || undefined}>
            {selectedDir || 'No folder chosen yet'}
          </span>
        </div>
      </div>
      <JavaLine status={status} />
      <div className="mc-row">
        <button
          type="button"
          className="mc-button mc-button--primary nodrag"
          disabled={busy || !selectedVersion || !selectedDir}
          onClick={() => void handleCreate()}
        >
          {configured ? 'Reinstall server' : 'Create server'}
        </button>
        {configured && (
          <button
            type="button"
            className="mc-button nodrag"
            disabled={busy}
            onClick={() => setShowInstallForm(false)}
          >
            Cancel
          </button>
        )}
      </div>
      <p className="service-node__note">
        Installs the required Java runtime automatically, then downloads the real server jar for this version from Mojang's own metadata and verifies it
        against the checksum that metadata publishes. Nothing runs until you accept the Minecraft
        EULA yourself.
      </p>
    </>
  ) : (
    <p className="service-node__note">Loading the version list…</p>
  )

  return (
    <div className="service-node__body mc-body">
      {status.phase === 'error' && status.error && <p className="mc-note--error">{status.error}</p>}

      {(status.phase === 'unconfigured' || status.phase === 'not-installed' || (!configured && status.phase === 'error') || showInstallForm) &&
        status.phase !== 'downloading' &&
        installForm}

      {status.phase === 'downloading' && (
        <>
          <p className="service-node__state">Downloading {status.versionId}…</p>
          <div className={`mc-progress${status.downloadPercent === null ? ' mc-progress--indeterminate' : ''}`}>
            <div
              className="mc-progress__fill"
              style={status.downloadPercent !== null ? { width: `${status.downloadPercent}%` } : undefined}
            />
          </div>
          <p className="service-node__note">
            {status.downloadPercent !== null && status.totalBytes
              ? `${status.downloadPercent}% — ${formatBytes(status.downloadedBytes ?? 0)} of ${formatBytes(status.totalBytes)}`
              : `${formatBytes(status.downloadedBytes ?? 0)} downloaded — Mojang did not publish a total size for this version, so this cannot show a percentage.`}
          </p>
        </>
      )}

      {status.phase === 'needs-eula' && (
        <>
          <p className="service-node__state">Accept the Minecraft EULA to continue</p>
          <p className="service-node__note">
            Mojang requires accepting the End User License Agreement before a server can run.
            nodeterm has not accepted it for you — only you can.
          </p>
          <button
            type="button"
            className="mc-link nodrag"
            onClick={() => window.nodeTerminal.shell.openExternal('https://www.minecraft.net/en-us/eula')}
          >
            Read the Minecraft EULA ↗
          </button>
          <label className="mc-checkbox nodrag">
            <input type="checkbox" checked={eulaChecked} onChange={(e) => setEulaChecked(e.target.checked)} />
            I have read and accept the Minecraft EULA
          </label>
          <button
            type="button"
            className="mc-button mc-button--primary nodrag"
            disabled={busy || !eulaChecked}
            onClick={() => void handleAcceptEula()}
          >
            Accept and continue
          </button>
        </>
      )}

      {(status.phase === 'stopped' || (status.phase === 'error' && configured)) && !showInstallForm && (
        <>
          <p className="service-node__state">
            {status.phase === 'error' ? `Not running — ${status.versionId}` : `Stopped — ${status.versionId}`}
          </p>
          <JavaLine status={status} />
          <div className="mc-row">
            <button
              type="button"
              className="mc-button mc-button--primary nodrag"
              disabled={busy || !status.javaOk}
              onClick={() => void handleStart()}
            >
              Start server
            </button>
            <button type="button" className="mc-button nodrag" disabled={busy} onClick={() => setShowInstallForm(true)}>
              Install a different version
            </button>
          </div>
          <button type="button" className="mc-link mc-link--danger nodrag" onClick={requestDelete}>
            Delete this server…
          </button>
        </>
      )}

      {(status.phase === 'starting' || status.phase === 'running' || status.phase === 'stopping') && (
        <>
          <p className="service-node__state">
            {status.phase === 'starting' && 'Starting…'}
            {status.phase === 'running' && `Running — ${status.versionId}`}
            {status.phase === 'stopping' && 'Stopping…'}
          </p>
          <div className="mc-console nodrag nowheel" ref={consoleRef} role="log" aria-label="Server console output">
            {consoleLines.length === 0 && <p className="mc-console__empty">No console output yet.</p>}
            {consoleLines.map((line) => (
              <div key={line.seq} className={`mc-console__line mc-console__line--${line.stream}`}>
                {line.text}
              </div>
            ))}
          </div>
          <form
            className="mc-row"
            onSubmit={(e) => {
              e.preventDefault()
              void handleSendCommand()
            }}
          >
            <input
              className="service-node__input nodrag"
              value={commandDraft}
              disabled={status.phase !== 'running'}
              onChange={(e) => setCommandDraft(e.target.value)}
              placeholder="Type a server command…"
              aria-label="Server console command"
            />
            <button
              type="submit"
              className="mc-button nodrag"
              disabled={status.phase !== 'running' || !commandDraft.trim()}
            >
              Send
            </button>
          </form>
          <button
            type="button"
            className="mc-button nodrag"
            disabled={status.phase !== 'running'}
            onClick={requestStop}
          >
            Stop server
          </button>
        </>
      )}
    </div>
  )
}
