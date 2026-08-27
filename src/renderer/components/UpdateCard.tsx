import { useEffect, useRef, useState } from 'react'
import type { UpdateProgress } from '@shared/types'
import { useI18n } from '@renderer/lib/i18n'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import {
  annotatesStatusDuringUpdateError,
  clearsAfterUpToDateTimeout,
  progressPercent,
  preservesStatusDuringManualCheck,
  statusFromAvailable,
  statusFromDownloaded,
  updateCardControls,
  updateBodyCopy,
  type UpdateAvailableStatus,
  type UpdateBodyKind,
  type UpdateDownloadedStatus,
  type UpdateManualStatus
} from '@renderer/lib/update-card-state'

// The full updater lifecycle as one status union, driving a fixed bottom-right card.
// `checking` is only ever shown for a user-initiated manual check; automatic checks stay
// silent until they produce an `available` (or, for a manual check, `upToDate`/`error`).
type Status =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | UpdateAvailableStatus
  // A .deb/.rpm Linux install can't self-install — show a manual download link, no progress/restart.
  | UpdateManualStatus
  | UpdateDownloadedStatus
  | { kind: 'upToDate' }
  | { kind: 'required'; minSupported: string | null; error?: string }
  | { kind: 'error'; message: string }

const RELEASES_URL = 'https://github.com/Ding-Ding-Projects/material-nodeterm/releases'

/** Map only the authored template text. Values supplied by the updater remain factual and are
 * inserted untouched, so a vocabulary entry can never rewrite a version or progress number. */
export function mapTemplate(
  template: string,
  params: Record<string, string>,
  vocab: (text: string) => string
): string {
  const parts: string[] = []
  let cursor = 0
  const marker = /\{([A-Za-z][A-Za-z0-9_]*)\}/g
  let match: RegExpExecArray | null
  while ((match = marker.exec(template)) !== null) {
    parts.push(vocab(template.slice(cursor, match.index)))
    parts.push(params[match[1]] ?? match[0])
    cursor = match.index + match[0].length
  }
  parts.push(vocab(template.slice(cursor)))
  return parts.join('')
}

export function UpdateCard(): JSX.Element | null {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [minimized, setMinimized] = useState(false)
  const upToDateTimer = useRef<number | null>(null)
  const { t, ts } = useI18n()
  const vocab = useVocabularyMapper()
  const text = (id: string, fallback: string): string => vocab(ts(id, fallback))

  useEffect(() => {
    const offAvailable = window.nodeTerminal.updates.onAvailable((info) => {
      setStatus(statusFromAvailable(info))
      setMinimized(false)
    })
    const offProgress = window.nodeTerminal.updates.onProgress((p: UpdateProgress) => {
      setStatus((s) =>
        s.kind === 'available' ? { ...s, percent: progressPercent(s.percent, p.percent) } : s
      )
    })
    const offDownloaded = window.nodeTerminal.updates.onDownloaded((info) => {
      setStatus(statusFromDownloaded(info))
      setMinimized(false)
    })
    const offNotAvailable = window.nodeTerminal.updates.onNotAvailable(() => {
      setStatus((s) => (s.kind === 'required' ? s : { kind: 'upToDate' }))
      setMinimized(false)
      if (upToDateTimer.current) window.clearTimeout(upToDateTimer.current)
      upToDateTimer.current = window.setTimeout(
        () => setStatus((s) => (clearsAfterUpToDateTimeout(s.kind) ? { kind: 'idle' } : s)),
        4000
      )
    })
    const offError = window.nodeTerminal.updates.onError((message) => {
      setStatus((s) =>
        annotatesStatusDuringUpdateError(s.kind) ? { ...s, error: message } : { kind: 'error', message }
      )
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
        preservesStatusDuringManualCheck(s.kind) ? s : { kind: 'checking' }
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
        ? status.percent === null
          ? '…'
          : `${Math.round(status.percent)}%`
        : status.kind === 'downloaded'
          ? text('update.pill.ready', 'Ready')
          : status.kind === 'error'
            ? '!'
            : '…'
    return (
      <button
        className="update-card update-card--pill"
        title={text('update.title.manual', 'Update available')}
        onClick={() => setMinimized(false)}
      >
        <span className="update-card__dot" />
        {label}
      </button>
    )
  }

  const title =
    status.kind === 'checking'
      ? text('update.title.checking', 'Checking for updates…')
      : status.kind === 'available'
        ? text('update.title.downloading', 'Downloading Update')
        : status.kind === 'manual'
          ? text('update.title.manual', 'Update available')
          : status.kind === 'downloaded'
            ? text('update.title.ready', 'Update ready')
            : status.kind === 'upToDate'
              ? text('update.title.upToDate', "You're up to date")
              : status.kind === 'required'
                ? text('update.title.required', 'Update required')
                : text('update.title.error', 'Update failed')

  const { canMinimize, canDismiss } = updateCardControls(status.kind)

  const minSupportedClause =
    status.kind === 'required' && status.minSupported
      ? mapTemplate(
          t('update.minSupportedClause', ' (minimum {minSupported})').primary,
          { minSupported: status.minSupported },
          vocab
        )
      : ''

  const localizedUpdateBody = (kind: UpdateBodyKind, version?: string): string => {
    const copy = updateBodyCopy(kind, version)
    return mapTemplate(t(copy.id, copy.fallback).primary, copy.params ?? {}, vocab)
  }

  return (
    <div className="update-card">
      <div className="update-card__head">
        <span className="update-card__title">{title}</span>
        {canMinimize && (
          <button
            className="update-card__icon"
            title={text('update.minimize', 'Minimize')}
            onClick={() => setMinimized(true)}
          >
            —
          </button>
        )}
        {canDismiss && (
          <button
            className="update-card__icon"
            title={text('announce.dismiss', 'Dismiss')}
            onClick={dismiss}
          >
            ✕
          </button>
        )}
      </div>

      {status.kind === 'checking' && (
        <p className="update-card__body">
          {text('update.body.checking', 'Looking for a newer version…')}
        </p>
      )}

      {status.kind === 'available' && (
        <>
          <p className="update-card__body">{localizedUpdateBody(status.kind, status.version)}</p>
          <button className="update-card__link" onClick={openReleases}>
            {text('update.releaseNotes', 'Release notes')}
          </button>
          <div className="update-card__bar">
            <div
              className={`update-card__bar-fill${
                status.percent === null ? ' update-card__bar-fill--indeterminate' : ''
              }`}
              style={status.percent === null ? undefined : { width: `${status.percent}%` }}
            />
          </div>
          {status.percent !== null && (
            <p className="update-card__pct">
              {
                mapTemplate(
                  t('update.downloadingPct', 'Downloading… {percent}%').primary,
                  { percent: String(Math.round(status.percent)) },
                  vocab
                )
              }
            </p>
          )}
        </>
      )}

      {status.kind === 'manual' && (
        <>
          <p className="update-card__body">{localizedUpdateBody(status.kind, status.version)}</p>
          <button className="update-card__btn" onClick={openReleases}>
            {text('update.download', 'Download')}
          </button>
        </>
      )}

      {status.kind === 'downloaded' && (
        <>
          <p className="update-card__body">{localizedUpdateBody(status.kind, status.version)}</p>
          {status.error && (
            <p className="update-card__error" role="alert">{status.error}</p>
          )}
          <button className="update-card__link" onClick={openReleases}>
            {text('update.releaseNotes', 'Release notes')}
          </button>
          <button
            className="update-card__btn"
            onClick={() => window.nodeTerminal.updates.restart()}
          >
            {text('update.restart', 'Restart to update')}
          </button>
        </>
      )}

      {status.kind === 'upToDate' && (
        <p className="update-card__body">
          {text('update.body.upToDate', 'nodeterm is on the latest version.')}
        </p>
      )}

      {status.kind === 'required' && (
        <>
          <p className="update-card__body">
            {
              mapTemplate(
                t(
                  'update.body.required',
                  'This version is no longer supported{minSupportedClause}. Please update to continue.'
                ).primary,
                { minSupportedClause },
                vocab
              )
            }
          </p>
          {status.error && (
            <p className="update-card__error" role="alert">{status.error}</p>
          )}
          <button className="update-card__btn" onClick={() => window.nodeTerminal.updates.check()}>
            {text('update.updateNow', 'Update now')}
          </button>
        </>
      )}

      {status.kind === 'error' && (
        <>
          <p className="update-card__body">{status.message}</p>
          <button className="update-card__link" onClick={openReleases}>
            {text('update.downloadManually', 'Download manually')}
          </button>
        </>
      )}
    </div>
  )
}
