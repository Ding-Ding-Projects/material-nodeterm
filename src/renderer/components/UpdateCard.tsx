import { useEffect, useRef, useState } from 'react'
import type { UpdateProgress } from '@shared/types'
import { useI18n } from '@renderer/lib/i18n'

// The full updater lifecycle as one status union, driving a fixed bottom-right card.
// `checking` is only ever shown for a user-initiated manual check; automatic checks stay
// silent until they produce an `available` (or, for a manual check, `upToDate`/`error`).
type Status =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string; percent: number }
  // A .deb/.rpm Linux install can't self-install — show a manual download link, no progress/restart.
  | { kind: 'manual'; version: string }
  | { kind: 'downloaded'; version: string }
  | { kind: 'upToDate' }
  | { kind: 'required'; minSupported: string | null }
  | { kind: 'error'; message: string }

const RELEASES_URL = 'https://nodeterm.dev/releases'

export function UpdateCard(): JSX.Element | null {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [minimized, setMinimized] = useState(false)
  const upToDateTimer = useRef<number | null>(null)
  const { t, ts } = useI18n()

  useEffect(() => {
    const offAvailable = window.nodeTerminal.updates.onAvailable((info) => {
      setStatus(
        info.manual
          ? { kind: 'manual', version: info.version }
          : { kind: 'available', version: info.version, percent: 0 }
      )
      setMinimized(false)
    })
    const offProgress = window.nodeTerminal.updates.onProgress((p: UpdateProgress) => {
      setStatus((s) => (s.kind === 'available' ? { ...s, percent: p.percent } : s))
    })
    const offDownloaded = window.nodeTerminal.updates.onDownloaded((info) => {
      setStatus({ kind: 'downloaded', version: info.version })
      setMinimized(false)
    })
    const offNotAvailable = window.nodeTerminal.updates.onNotAvailable(() => {
      setStatus((s) => (s.kind === 'required' ? s : { kind: 'upToDate' }))
      setMinimized(false)
      if (upToDateTimer.current) window.clearTimeout(upToDateTimer.current)
      upToDateTimer.current = window.setTimeout(
        () => setStatus((s) => (s.kind === 'required' ? s : { kind: 'idle' })),
        4000
      )
    })
    const offError = window.nodeTerminal.updates.onError((message) => {
      setStatus({ kind: 'error', message })
      setMinimized(false)
    })
    return () => {
      offAvailable()
      offProgress()
      offDownloaded()
      offNotAvailable()
      offError()
      if (upToDateTimer.current) window.clearTimeout(upToDateTimer.current)
    }
  }, [])

  // A manual check was triggered from Settings → show the checking state (unless an update
  // is already downloading or staged, which must not be overwritten).
  useEffect(() => {
    const onChecking = () => {
      setStatus((s) =>
        s.kind === 'available' ||
        s.kind === 'manual' ||
        s.kind === 'downloaded' ||
        s.kind === 'required'
          ? s
          : { kind: 'checking' }
      )
      setMinimized(false)
    }
    window.addEventListener('nodeterm:update-checking', onChecking)
    return () => window.removeEventListener('nodeterm:update-checking', onChecking)
  }, [])

  // Mandatory-update policy (from /v1/check via main). If the running version is below the
  // channel minimum, show a non-dismissible "required" card. Don't override an in-progress
  // download/ready state.
  useEffect(() => {
    void window.nodeTerminal.updates.getPolicy().then((p) => {
      if (!p.mandatory) return
      setStatus((s) =>
        s.kind === 'available' || s.kind === 'manual' || s.kind === 'downloaded'
          ? s
          : { kind: 'required', minSupported: p.minSupported }
      )
    })
  }, [])

  // Dev-only: drive the card through its states from the console without packaging, e.g.
  //   __simulateUpdate({ kind: 'available', version: '0.3.0', percent: 42 })
  useEffect(() => {
    ;(window as unknown as { __simulateUpdate?: (s: Status) => void }).__simulateUpdate = (s) =>
      setStatus(s)
    return () => {
      delete (window as unknown as { __simulateUpdate?: unknown }).__simulateUpdate
    }
  }, [])

  if (status.kind === 'idle') return null

  const openReleases = () => window.open(RELEASES_URL, '_blank', 'noopener')
  const dismiss = () => setStatus({ kind: 'idle' })

  if (minimized) {
    const label =
      status.kind === 'available'
        ? `${Math.round(status.percent)}%`
        : status.kind === 'downloaded'
          ? ts('update.pill.ready', 'Ready')
          : status.kind === 'error'
            ? '!'
            : '…'
    return (
      <button
        className="update-card update-card--pill"
        title={ts('update.title.manual', 'Update available')}
        onClick={() => setMinimized(false)}
      >
        <span className="update-card__dot" />
        {label}
      </button>
    )
  }

  const title =
    status.kind === 'checking'
      ? ts('update.title.checking', 'Checking for updates…')
      : status.kind === 'available'
        ? ts('update.title.downloading', 'Downloading Update')
        : status.kind === 'manual'
          ? ts('update.title.manual', 'Update available')
          : status.kind === 'downloaded'
            ? ts('update.title.ready', 'Update ready')
            : status.kind === 'upToDate'
              ? ts('update.title.upToDate', "You're up to date")
              : status.kind === 'required'
                ? ts('update.title.required', 'Update required')
                : ts('update.title.error', 'Update failed')

  const canMinimize = status.kind === 'available' || status.kind === 'downloaded'
  const canDismiss =
    status.kind === 'manual' ||
    status.kind === 'downloaded' ||
    status.kind === 'upToDate' ||
    status.kind === 'error'

  const minSupportedClause =
    status.kind === 'required' && status.minSupported
      ? t('update.minSupportedClause', ' (minimum {minSupported})', {
          minSupported: status.minSupported
        }).primary
      : ''

  return (
    <div className="update-card">
      <div className="update-card__head">
        <span className="update-card__title">{title}</span>
        {canMinimize && (
          <button
            className="update-card__icon"
            title={ts('update.minimize', 'Minimize')}
            onClick={() => setMinimized(true)}
          >
            —
          </button>
        )}
        {canDismiss && (
          <button
            className="update-card__icon"
            title={ts('announce.dismiss', 'Dismiss')}
            onClick={dismiss}
          >
            ✕
          </button>
        )}
      </div>

      {status.kind === 'checking' && (
        <p className="update-card__body">
          {ts('update.body.checking', 'Looking for a newer version…')}
        </p>
      )}

      {status.kind === 'available' && (
        <>
          <p className="update-card__body">
            {t('update.body.downloading', 'nodeterm v{version} is downloading.', {
              version: status.version
            }).primary}
          </p>
          <button className="update-card__link" onClick={openReleases}>
            {ts('update.releaseNotes', 'Release notes')}
          </button>
          <div className="update-card__bar">
            <div className="update-card__bar-fill" style={{ width: `${status.percent}%` }} />
          </div>
          <p className="update-card__pct">
            {
              t('update.downloadingPct', 'Downloading… {percent}%', {
                percent: String(Math.round(status.percent))
              }).primary
            }
          </p>
        </>
      )}

      {status.kind === 'manual' && (
        <>
          <p className="update-card__body">
            {
              t(
                'update.body.manual',
                'nodeterm v{version} is available. Download it to update.',
                { version: status.version }
              ).primary
            }
          </p>
          <button className="update-card__btn" onClick={openReleases}>
            {ts('update.download', 'Download')}
          </button>
        </>
      )}

      {status.kind === 'downloaded' && (
        <>
          <p className="update-card__body">
            {t('update.body.ready', 'nodeterm v{version} is ready to install.', {
              version: status.version
            }).primary}
          </p>
          <button className="update-card__link" onClick={openReleases}>
            {ts('update.releaseNotes', 'Release notes')}
          </button>
          <button
            className="update-card__btn"
            onClick={() => window.nodeTerminal.updates.restart()}
          >
            {ts('update.restart', 'Restart to update')}
          </button>
        </>
      )}

      {status.kind === 'upToDate' && (
        <p className="update-card__body">
          {ts('update.body.upToDate', 'nodeterm is on the latest version.')}
        </p>
      )}

      {status.kind === 'required' && (
        <>
          <p className="update-card__body">
            {
              t(
                'update.body.required',
                'This version is no longer supported{minSupportedClause}. Please update to continue.',
                { minSupportedClause }
              ).primary
            }
          </p>
          <button className="update-card__btn" onClick={() => window.nodeTerminal.updates.check()}>
            {ts('update.updateNow', 'Update now')}
          </button>
        </>
      )}

      {status.kind === 'error' && (
        <>
          <p className="update-card__body">{status.message}</p>
          <button className="update-card__link" onClick={openReleases}>
            {ts('update.downloadManually', 'Download manually')}
          </button>
        </>
      )}
    </div>
  )
}
