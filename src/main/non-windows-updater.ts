export interface NonWindowsUpdateRequestArbiter {
  /** Start a backend check, or join/block it without issuing a duplicate request. */
  check(manual: boolean): boolean
  /** Complete a request after an available/downloaded event owns the remaining UI state. */
  finish(): void
  /** Preserve the established automatic and manual no-update event visibility. */
  notAvailable(): void
  /** Backend events are authoritative and visible verbatim on macOS/Linux. */
  backendError(error: unknown, visible?: boolean): void
  readonly active: boolean
}

export interface NonWindowsInstallGate {
  markReady(version?: string): void
  installFailed(error: unknown): boolean
  readonly ready: boolean
  readonly installing: boolean
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Coordinate electron-updater's event and promise surfaces without importing Electron.
 *
 * electron-updater emits `error` before rejecting the promise for the same check. Clearing the
 * owned request in `backendError` makes the later rejection a no-op, so one failure cannot create
 * duplicate cards. A rejection with no event remains a fallback: it is logged for every request
 * and shown only when a person explicitly asked for the check.
 */
export function createNonWindowsUpdateRequestArbiter(options: {
  checkForUpdates: () => PromiseLike<unknown>
  isCheckBlocked: () => boolean
  replayReadyUpdate?: () => boolean
  sendNotAvailable: () => void
  sendError: (detail: string) => void
  logError: (detail: string) => void
}): NonWindowsUpdateRequestArbiter {
  let active: { manual: boolean } | null = null

  const finish = (): void => {
    active = null
  }

  return {
    check(manual) {
      if (active) {
        // A manual click joins the owned automatic request and upgrades its rejection fallback.
        // Issuing another backend check can download the same update twice.
        if (manual) active.manual = true
        return false
      }
      if (options.isCheckBlocked()) {
        // A renderer reload loses its card while main retains the install gate. Let an explicit
        // Settings check replay that truth, but keep background checks silent and duplicate-free.
        if (manual) options.replayReadyUpdate?.()
        return false
      }

      const request = { manual }
      active = request
      let pending: PromiseLike<unknown>
      try {
        pending = options.checkForUpdates()
      } catch (error) {
        active = null
        const detail = errorDetail(error)
        options.logError(detail)
        if (request.manual) options.sendError(detail)
        return false
      }

      void Promise.resolve(pending).catch((error: unknown) => {
        // A backend `error` event normally consumed the same failure first. It cleared ownership,
        // so do not duplicate either the visible card or its diagnostic log.
        if (active !== request) return
        active = null
        const detail = errorDetail(error)
        options.logError(detail)
        if (request.manual) options.sendError(detail)
      })
      return true
    },
    finish,
    notAvailable() {
      finish()
      options.sendNotAvailable()
    },
    backendError(error, visible = true) {
      finish()
      const detail = errorDetail(error)
      options.logError(detail)
      if (visible) options.sendError(detail)
    },
    get active() {
      return active !== null
    }
  }
}

/**
 * Register the terminal electron-updater events through a pure, behavior-testable seam. Keeping
 * request release and `markReady` here prevents one platform listener from silently drifting away
 * from the duplicate-check and restart gates.
 */
export function wireNonWindowsUpdateLifecycle<AvailableInfo, DownloadedInfo>(options: {
  manualUpdates: boolean
  requests: NonWindowsUpdateRequestArbiter
  installGate: NonWindowsInstallGate
  onAvailable: (listener: (info: AvailableInfo) => void) => void
  onDownloaded: (listener: (info: DownloadedInfo) => void) => void
  onNotAvailable: (listener: () => void) => void
  onError: (listener: (error: unknown) => void) => void
  downloadedVersion: (info: DownloadedInfo) => string | undefined
  forwardAvailable: (info: AvailableInfo) => void
  forwardDownloaded: (info: DownloadedInfo) => void
}): void {
  options.onAvailable((info) => {
    options.forwardAvailable(info)
    if (options.manualUpdates) options.requests.finish()
  })
  options.onDownloaded((info) => {
    options.requests.finish()
    options.installGate.markReady(options.downloadedVersion(info))
    options.forwardDownloaded(info)
  })
  options.onNotAvailable(() => options.requests.notAvailable())
  options.onError((error) => {
    const installFailure = options.installGate.installFailed(error)
    options.requests.backendError(error, !installFailure)
  })
}
