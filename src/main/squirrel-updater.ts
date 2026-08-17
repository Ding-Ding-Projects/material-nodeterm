import type { UpdateInfo } from '../shared/types'

/**
 * Windows is packaged as Squirrel.Windows, so it must use Electron's built-in autoUpdater.
 * `electron-updater` always selects its NSIS backend on Windows and cannot consume the RELEASES
 * plus full `.nupkg` set this repository publishes.
 */
export const WINDOWS_UPDATER_PROTOCOL = 'squirrel-windows' as const
export const NON_WINDOWS_UPDATER_PROTOCOL = 'electron-builder' as const
export type UpdaterProtocol = typeof WINDOWS_UPDATER_PROTOCOL | typeof NON_WINDOWS_UPDATER_PROTOCOL

export const WINDOWS_STABLE_FEED_URL =
  'https://github.com/Ding-Ding-Projects/material-nodeterm/releases/latest/download'

const IDENTIFIER = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)'
const VERSION_SOURCE = `(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-${IDENTIFIER}(?:\\.${IDENTIFIER})*)?`
const VERSION_RE = new RegExp(`^(${VERSION_SOURCE})$`)
const FULL_PACKAGE_RE = new RegExp(`^.+-(${VERSION_SOURCE})-full\\.nupkg$`, 'i')

interface ParsedVersion {
  major: bigint
  minor: bigint
  patch: bigint
  prerelease: string[]
}

export interface SquirrelBackend {
  setFeedURL(url: string): void
  checkForUpdates(): void
  quitAndInstall(): void
  onAvailable(listener: () => void): void
  onNotAvailable(listener: () => void): void
  onDownloaded(listener: (releaseName: string) => void): void
  onError(listener: (error: Error) => void): void
}

export interface SquirrelUpdateSink {
  available(info: UpdateInfo): void
  downloaded(info: UpdateInfo): void
  notAvailable(): void
  error(message: string): void
  logError(message: string): void
}

export interface InstallGate {
  markReady(version?: string): void
  /** Replay retained ready state after a renderer reload without starting another update check. */
  replayReady(listener: (version?: string) => void): boolean
  /** Release a failed in-flight install attempt while retaining the staged update for retry. */
  installFailed(error: unknown): boolean
  restart(): boolean
  readonly ready: boolean
  readonly readyVersion: string | undefined
  readonly installing: boolean
}

/**
 * Set the app's quitting lifecycle only after Electron confirms an updater-triggered quit.
 * Registering before `quitAndInstall()` would leave hide-on-close disabled when Update.exe throws.
 */
export function registerBeforeQuitForUpdate(
  registerOnce: (listener: () => void) => void,
  listener?: () => void
): void {
  if (listener) registerOnce(listener)
}

export function updaterProtocolFor(platform: NodeJS.Platform | string): UpdaterProtocol {
  return platform === 'win32' ? WINDOWS_UPDATER_PROTOCOL : NON_WINDOWS_UPDATER_PROTOCOL
}

function parseVersion(version: string): ParsedVersion | null {
  if (!VERSION_RE.test(version)) return null
  const prereleaseSeparator = version.indexOf('-')
  const core = prereleaseSeparator === -1 ? version : version.slice(0, prereleaseSeparator)
  const prereleaseRaw =
    prereleaseSeparator === -1 ? undefined : version.slice(prereleaseSeparator + 1)
  const [major, minor, patch] = core.split('.')
  return {
    major: BigInt(major),
    minor: BigInt(minor),
    patch: BigInt(patch),
    prerelease: prereleaseRaw?.split('.') ?? []
  }
}

function compareIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) {
    const a = BigInt(left)
    const b = BigInt(right)
    return a < b ? -1 : a > b ? 1 : 0
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
  return left < right ? -1 : left > right ? 1 : 0
}

/** Strict SemVer precedence (without build metadata, which NuGet/Squirrel does not preserve). */
export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return null
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < length; i++) {
    if (a.prerelease[i] == null) return -1
    if (b.prerelease[i] == null) return 1
    const compared = compareIdentifier(a.prerelease[i], b.prerelease[i])
    if (compared !== 0) return compared
  }
  return 0
}

type UpdateChannel = 'stable' | 'fixture'

function updateChannel(version: string): UpdateChannel | null {
  const parsed = parseVersion(version)
  if (!parsed) return null
  if (parsed.prerelease.length === 0) return 'stable'
  return parsed.prerelease[0] === 'fixture' ? 'fixture' : null
}

function normalizedLoopbackFeed(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLowerCase())) return null
    if (url.username || url.password || url.search || url.hash) return null
    url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

/**
 * Stable builds cannot be redirected by process environment. A loopback override exists only for
 * explicit `-fixture.*` package versions, so a production install never trusts a hand-edited feed.
 */
export function windowsFeedURL(appVersion: string, fixtureURL?: string): string | null {
  const channel = updateChannel(appVersion)
  if (channel === 'stable') return WINDOWS_STABLE_FEED_URL
  if (channel === 'fixture' && fixtureURL) return normalizedLoopbackFeed(fixtureURL)
  return null
}

export function versionFromSquirrelReleaseName(releaseName: string): string | null {
  if (parseVersion(releaseName)) return releaseName
  return FULL_PACKAGE_RE.exec(releaseName)?.[1] ?? null
}

/**
 * electron-winstaller removes dots from NuGet prerelease identifiers, so the fixture package
 * `0.4.0-fixture.2` is reported by Squirrel as `0.4.0-fixture2`. Reconcile only that deliberately
 * isolated channel; stable and arbitrary prerelease builds must never gain a guessed identity.
 */
export function versionForAppChannel(candidate: string, appVersion: string): string {
  if (updateChannel(appVersion) !== 'fixture') return candidate
  const parsed = parseVersion(candidate)
  const convertedFixture = parsed?.prerelease.length === 1
    ? /^fixture(0|[1-9]\d*)$/.exec(parsed.prerelease[0])
    : null
  if (!parsed || !convertedFixture) return candidate
  return `${parsed.major}.${parsed.minor}.${parsed.patch}-fixture.${convertedFixture[1]}`
}

export function createInstallGate(options: {
  quitAndInstall: () => void
  onError: (message: string) => void
}): InstallGate {
  let ready = false
  let readyVersion: string | undefined
  let installing = false
  const reportInstallFailure = (error: unknown): void => {
    installing = false
    const label = readyVersion ? `nodeterm ${readyVersion}` : 'the nodeterm update'
    options.onError(
      `Could not restart to install ${label}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
  return {
    markReady(version) {
      if (installing) return
      ready = true
      readyVersion = version
    },
    replayReady(listener) {
      if (!ready || installing) return false
      listener(readyVersion)
      return true
    },
    installFailed(error) {
      if (!ready || !installing) return false
      reportInstallFailure(error)
      return true
    },
    restart() {
      if (!ready || installing) return false
      installing = true
      try {
        options.quitAndInstall()
        // electron-updater can synchronously emit `error` instead of throwing. Its listener
        // releases `installing` through installFailed(), making this attempt observably false.
        return installing
      } catch (error) {
        reportInstallFailure(error)
        return false
      }
    },
    get ready() {
      return ready
    },
    get readyVersion() {
      return readyVersion
    },
    get installing() {
      return installing
    }
  }
}

export interface WindowsSquirrelController {
  check(manual: boolean): boolean
  restart(): boolean
  readonly feedURL: string | null
}

/**
 * Own the event-only Windows updater without inventing metadata Electron does not provide.
 * `update-available` has no version or bytes, so the renderer gets an explicitly indeterminate
 * update. The release feed and Squirrel remain the single update authority—there is no racy
 * application-side prefetch of RELEASES before Update.exe reads it again.
 */
export function createWindowsSquirrelController(options: {
  appVersion: string
  fixtureURL?: string
  backend: SquirrelBackend
  sink: SquirrelUpdateSink
}): WindowsSquirrelController {
  const { appVersion, backend, sink } = options
  const feedURL = windowsFeedURL(appVersion, options.fixtureURL)
  let configured = false
  let active: { manual: boolean; announced: boolean } | null = null

  const gate = createInstallGate({
    quitAndInstall: () => backend.quitAndInstall(),
    onError: (message) => sink.error(message)
  })

  backend.onAvailable(() => {
    if (!active) {
      sink.logError('Squirrel emitted update-available without an owned update check')
      return
    }
    active.announced = true
    sink.available({ indeterminateProgress: true })
  })

  backend.onNotAvailable(() => {
    const manual = active?.manual ?? false
    active = null
    if (manual) sink.notAvailable()
  })

  backend.onDownloaded((releaseName) => {
    if (!active) {
      sink.logError('Squirrel emitted update-downloaded without an owned update check')
      return
    }
    const reportedVersion = versionFromSquirrelReleaseName(releaseName) ?? undefined
    const version = reportedVersion
      ? versionForAppChannel(reportedVersion, appVersion)
      : undefined
    if (
      version &&
      (updateChannel(version) !== updateChannel(appVersion) ||
        compareVersions(version, appVersion) !== 1)
    ) {
      // Diagnostic/UI gate only. Squirrel owns the staged package and may apply it on the next
      // launch; the immutable production feed plus main-only publisher are the channel boundary.
      active = null
      sink.error(
        "The downloaded update did not match this app's channel. Restart here is disabled, but Windows may still apply the staged update on the next launch."
      )
      return
    }
    active = null
    gate.markReady(version)
    sink.downloaded({ version })
  })

  backend.onError((error) => {
    if (gate.installFailed(error)) {
      sink.logError(error?.message ?? String(error))
      return
    }
    const visible = active?.manual === true || active?.announced === true
    const downloading = active?.announced === true
    active = null
    if (visible) {
      sink.error(
        downloading
          ? `Could not finish downloading the update. You can keep using nodeterm ${appVersion} and try again later.`
          : `Could not check for updates. You can keep using nodeterm ${appVersion} and try again later.`
      )
    }
    sink.logError(error?.message ?? String(error))
  })

  if (feedURL) {
    try {
      backend.setFeedURL(feedURL)
      configured = true
    } catch (error) {
      sink.logError(error instanceof Error ? error.message : String(error))
    }
  }

  return {
    check(manual) {
      if (active) {
        // The renderer has already entered its manual "checking" state. Join the owned request
        // and upgrade its result visibility without issuing Squirrel's duplicate download.
        if (manual) active.manual = true
        return false
      }
      if (gate.ready || gate.installing) {
        // The renderer can reload after main has staged an update. Replaying retained truth on a
        // manual check restores its Restart action without asking Update.exe to download again.
        if (manual) gate.replayReady((version) => sink.downloaded({ version }))
        return false
      }
      if (!configured) {
        if (manual) sink.error('This build has no eligible update channel.')
        return false
      }
      active = { manual, announced: false }
      try {
        backend.checkForUpdates()
        return true
      } catch (error) {
        active = null
        if (manual) {
          sink.error(
            `Could not check for updates. You can keep using nodeterm ${appVersion} and try again later.`
          )
        }
        sink.logError(error instanceof Error ? error.message : String(error))
        return false
      }
    },
    restart: () => gate.restart(),
    get feedURL() {
      return feedURL
    }
  }
}
