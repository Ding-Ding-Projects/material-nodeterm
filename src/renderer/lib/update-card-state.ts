import type { UpdateInfo } from '@shared/types'

export type UpdateAvailableStatus = {
  kind: 'available'
  version?: string
  /** `null` means the updater protocol cannot report trustworthy byte progress. */
  percent: number | null
}

export type UpdateManualStatus = { kind: 'manual'; version?: string }

export type UpdateDownloadedStatus = { kind: 'downloaded'; version?: string; error?: string }

export type UpdateBodyKind =
  UpdateAvailableStatus['kind'] | UpdateManualStatus['kind'] | UpdateDownloadedStatus['kind']

export type UpdateCardKind =
  | 'idle'
  | 'checking'
  | UpdateBodyKind
  | 'upToDate'
  | 'required'
  | 'error'

export type UpdateBodyCopy = {
  id: string
  fallback: string
  params?: Record<string, string>
}

export function statusFromAvailable(info: UpdateInfo): UpdateAvailableStatus | UpdateManualStatus {
  if (info.manual) return { kind: 'manual', version: info.version }

  return {
    kind: 'available',
    version: info.version,
    // Electron's Squirrel updater does not expose byte progress. Rendering `0%` would assert a
    // measurement the protocol never made, so its explicit signal maps to an indeterminate bar.
    percent: info.indeterminateProgress ? null : 0
  }
}

export function statusFromDownloaded(info: UpdateInfo): UpdateDownloadedStatus {
  return { kind: 'downloaded', version: info.version }
}

/** Keep an indeterminate transfer indeterminate even if a stale/different backend emits progress. */
export function progressPercent(current: number | null, reported: number): number | null {
  return current === null ? null : reported
}

/** A staged update must retain its only install action; it can be minimized, never dismissed. */
export function updateCardControls(kind: UpdateCardKind): {
  canMinimize: boolean
  canDismiss: boolean
} {
  return {
    canMinimize: kind === 'available' || kind === 'downloaded',
    canDismiss: kind === 'manual' || kind === 'upToDate' || kind === 'error'
  }
}

/** A Settings check must not replace an active/staged update with a checking spinner. */
export function preservesStatusDuringManualCheck(kind: UpdateCardKind): boolean {
  return (
    kind === 'available' ||
    kind === 'manual' ||
    kind === 'downloaded' ||
    kind === 'required'
  )
}

/** Keep non-dismissible policy/install actions while attaching a transient failure message. */
export function annotatesStatusDuringUpdateError(kind: UpdateCardKind): boolean {
  return kind === 'required' || kind === 'downloaded'
}

/** A stale no-update timer may clear only the exact up-to-date state that created it. */
export function clearsAfterUpToDateTimeout(kind: UpdateCardKind): boolean {
  return kind === 'upToDate'
}

/** Select factual copy without ever formatting an absent version as `vundefined`. */
export function updateBodyCopy(kind: UpdateBodyKind, version?: string): UpdateBodyCopy {
  const knownVersion = version?.trim()

  if (knownVersion) {
    switch (kind) {
      case 'available':
        return {
          id: 'update.body.downloading',
          fallback: 'nodeterm v{version} is downloading.',
          params: { version: knownVersion }
        }
      case 'manual':
        return {
          id: 'update.body.manual',
          fallback: 'nodeterm v{version} is available. Download it to update.',
          params: { version: knownVersion }
        }
      case 'downloaded':
        return {
          id: 'update.body.ready',
          fallback: 'nodeterm v{version} is ready to install.',
          params: { version: knownVersion }
        }
    }
  }

  switch (kind) {
    case 'available':
      return {
        id: 'update.body.downloadingUnknown',
        fallback: 'A newer nodeterm version is downloading.'
      }
    case 'manual':
      return {
        id: 'update.body.manualUnknown',
        fallback: 'A newer nodeterm version is available. Download it to update.'
      }
    case 'downloaded':
      return {
        id: 'update.body.readyUnknown',
        fallback: 'A nodeterm update is ready to install.'
      }
  }
}
