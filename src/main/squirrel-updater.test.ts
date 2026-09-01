import { describe, expect, it, vi } from 'vitest'
import type { UpdateInfo } from '../shared/types'
import {
  WINDOWS_STABLE_FEED_URL,
  WINDOWS_UPDATER_PROTOCOL,
  compareVersions,
  createInstallGate,
  createWindowsSquirrelController,
  registerBeforeQuitForUpdate,
  versionForAppChannel,
  versionFromSquirrelReleaseName,
  windowsFeedURL,
  type SquirrelBackend,
  type SquirrelUpdateSink
} from './squirrel-updater'

class FakeSquirrelBackend implements SquirrelBackend {
  readonly feedURLs: string[] = []
  checks = 0
  installs = 0
  setFeedError: Error | null = null
  checkError: Error | null = null

  private availableListener: (() => void) | undefined
  private notAvailableListener: (() => void) | undefined
  private downloadedListener: ((releaseName: string) => void) | undefined
  private errorListener: ((error: Error) => void) | undefined

  setFeedURL(url: string): void {
    if (this.setFeedError) throw this.setFeedError
    this.feedURLs.push(url)
  }

  checkForUpdates(): void {
    if (this.checkError) throw this.checkError
    this.checks++
  }

  quitAndInstall(): void {
    this.installs++
  }

  onAvailable(listener: () => void): void {
    this.availableListener = listener
  }

  onNotAvailable(listener: () => void): void {
    this.notAvailableListener = listener
  }

  onDownloaded(listener: (releaseName: string) => void): void {
    this.downloadedListener = listener
  }

  onError(listener: (error: Error) => void): void {
    this.errorListener = listener
  }

  emitAvailable(): void {
    this.availableListener?.()
  }

  emitNotAvailable(): void {
    this.notAvailableListener?.()
  }

  emitDownloaded(releaseName: string): void {
    this.downloadedListener?.(releaseName)
  }

  emitError(message: string): void {
    this.errorListener?.(new Error(message))
  }
}

function createSink(): SquirrelUpdateSink & {
  available: ReturnType<typeof vi.fn<(info: UpdateInfo) => void>>
  downloaded: ReturnType<typeof vi.fn<(info: UpdateInfo) => void>>
  notAvailable: ReturnType<typeof vi.fn<() => void>>
  error: ReturnType<typeof vi.fn<(message: string) => void>>
  logError: ReturnType<typeof vi.fn<(message: string) => void>>
} {
  return {
    available: vi.fn<(info: UpdateInfo) => void>(),
    downloaded: vi.fn<(info: UpdateInfo) => void>(),
    notAvailable: vi.fn<() => void>(),
    error: vi.fn<(message: string) => void>(),
    logError: vi.fn<(message: string) => void>()
  }
}

function createStableController(overrides?: {
  backend?: FakeSquirrelBackend
  sink?: ReturnType<typeof createSink>
}) {
  const backend = overrides?.backend ?? new FakeSquirrelBackend()
  const sink = overrides?.sink ?? createSink()
  const controller = createWindowsSquirrelController({
    appVersion: '1.2.3',
    backend,
    sink
  })
  return { backend, sink, controller }
}

describe('Squirrel updater protocol and feed selection', () => {
  it('exports the one supported updater protocol', () => {
    expect(WINDOWS_UPDATER_PROTOCOL).toBe('squirrel-windows')
  })

  it('pins stable builds to the official feed and ignores all fixture overrides', () => {
    expect(windowsFeedURL('1.2.3')).toBe(WINDOWS_STABLE_FEED_URL)
    expect(windowsFeedURL('1.2.3', 'http://127.0.0.1:4312/private')).toBe(
      WINDOWS_STABLE_FEED_URL
    )
    expect(windowsFeedURL('1.2.3', 'https://attacker.invalid/releases')).toBe(
      WINDOWS_STABLE_FEED_URL
    )
  })

  it('permits a normalized loopback feed only for explicit fixture builds', () => {
    expect(windowsFeedURL('1.2.3-fixture.1', 'http://127.0.0.1:4312/feed///')).toBe(
      'http://127.0.0.1:4312/feed'
    )
    expect(windowsFeedURL('1.2.3-fixture.1', 'https://localhost:4312/')).toBe(
      'https://localhost:4312'
    )
    expect(windowsFeedURL('1.2.3-fixture.1', 'http://[::1]:4312/feed')).toBe(
      'http://[::1]:4312/feed'
    )
  })

  it.each([
    ['1.2.3-fixture.1', undefined],
    ['1.2.3-fixture.1', 'https://example.test/feed'],
    ['1.2.3-fixture.1', 'file:///C:/updates'],
    ['1.2.3-fixture.1', 'http://user:secret@127.0.0.1:4312/feed'],
    ['1.2.3-fixture.1', 'http://127.0.0.1:4312/feed?channel=other'],
    ['1.2.3-fixture.1', 'http://127.0.0.1:4312/feed#other'],
    ['1.2.3-beta.1', 'http://127.0.0.1:4312/feed'],
    ['1.2.3-fixture-alpha', 'http://127.0.0.1:4312/feed'],
    ['01.2.3-fixture.1', 'http://127.0.0.1:4312/feed']
  ])('refuses an ineligible build/feed pair: %s / %s', (version, feed) => {
    expect(windowsFeedURL(version, feed)).toBeNull()
  })
})

describe('strict version advancement', () => {
  it.each([
    ['1.2.4', '1.2.3', 1],
    ['1.2.3', '1.2.3', 0],
    ['1.2.2', '1.2.3', -1],
    ['2.0.0-fixture.1', '2.0.0-fixture.0', 1],
    ['2.0.0', '2.0.0-rc.99', 1],
    ['2.0.0-fixture-alpha', '2.0.0-fixture-beta', -1],
    ['2.0.0-123alpha', '2.0.0-122alpha', 1],
    ['2.0.0-alpha.1', '2.0.0-alpha', 1]
  ])('compares %s against %s as %d', (candidate, current, expected) => {
    expect(compareVersions(candidate, current)).toBe(expected)
  })

  it('compares numeric fields and prerelease identifiers without Number precision loss', () => {
    expect(
      compareVersions(
        '999999999999999999999999999999.0.0',
        '999999999999999999999999999998.999999999999999999999.999999999999999999999'
      )
    ).toBe(1)
    expect(
      compareVersions(
        '1.0.0-fixture.999999999999999999999999999999',
        '1.0.0-fixture.999999999999999999999999999998'
      )
    ).toBe(1)
  })

  it.each([
    ['1.2', '1.2.3'],
    ['01.2.3', '1.2.3'],
    ['1.02.3', '1.2.3'],
    ['1.2.03', '1.2.3'],
    ['1.2.3-01', '1.2.3-1'],
    ['1.2.3+build.4', '1.2.3'],
    ['v1.2.3', '1.2.3']
  ])('returns null instead of guessing for invalid SemVer %s', (candidate, current) => {
    expect(compareVersions(candidate, current)).toBeNull()
  })

  it('extracts versions from Squirrel release names without inventing an opaque version', () => {
    expect(versionFromSquirrelReleaseName('1.4.0')).toBe('1.4.0')
    expect(versionFromSquirrelReleaseName('nodeterm-1.4.0-full.nupkg')).toBe('1.4.0')
    expect(versionFromSquirrelReleaseName('nodeterm-1.4.0-fixture.2-full.nupkg')).toBe(
      '1.4.0-fixture.2'
    )
    expect(versionFromSquirrelReleaseName('nodeterm update')).toBeNull()
  })

  it('reconciles electron-winstaller\'s real fixture NuGet version only for a fixture app', () => {
    const releaseName =
      'node-terminal-squirrel-fixture-0.4.0-fixture2-full.nupkg'
    const reported = versionFromSquirrelReleaseName(releaseName)

    expect(reported).toBe('0.4.0-fixture2')
    expect(versionForAppChannel(reported!, '0.4.0-fixture.1')).toBe('0.4.0-fixture.2')
    expect(versionForAppChannel(reported!, '0.4.0')).toBe('0.4.0-fixture2')
    expect(versionForAppChannel('0.4.0-beta2', '0.4.0-fixture.1')).toBe('0.4.0-beta2')
  })
})

describe('Windows Squirrel controller event truth', () => {
  it('configures before checking, coalesces duplicate checks, and reports indeterminate progress', () => {
    const { backend, sink, controller } = createStableController()

    expect(backend.feedURLs).toEqual([WINDOWS_STABLE_FEED_URL])
    expect(controller.feedURL).toBe(WINDOWS_STABLE_FEED_URL)
    expect(controller.check(false)).toBe(true)
    expect(backend.checks).toBe(1)
    expect(controller.check(true)).toBe(false)
    expect(backend.checks).toBe(1)

    backend.emitAvailable()
    expect(sink.available).toHaveBeenCalledOnce()
    expect(sink.available).toHaveBeenCalledWith({ indeterminateProgress: true })
    expect(sink.downloaded).not.toHaveBeenCalled()
  })

  it('shows no-update truth only for an explicitly manual check and then permits another check', () => {
    const { backend, sink, controller } = createStableController()

    expect(controller.check(false)).toBe(true)
    backend.emitNotAvailable()
    expect(sink.notAvailable).not.toHaveBeenCalled()

    expect(controller.check(true)).toBe(true)
    backend.emitNotAvailable()
    expect(sink.notAvailable).toHaveBeenCalledOnce()
    expect(controller.check(false)).toBe(true)
    expect(backend.checks).toBe(3)
  })

  it('joins a manual request to an active automatic check and makes its result visible', () => {
    const { backend, sink, controller } = createStableController()

    expect(controller.check(false)).toBe(true)
    expect(controller.check(true)).toBe(false)
    expect(backend.checks).toBe(1)

    backend.emitNotAvailable()
    expect(sink.notAvailable).toHaveBeenCalledOnce()

    expect(controller.check(false)).toBe(true)
    expect(controller.check(true)).toBe(false)
    backend.emitError('offline after manual joined')
    expect(sink.error).toHaveBeenCalledWith(
      'Could not check for updates. You can keep using nodeterm 1.2.3 and try again later.'
    )
    expect(backend.checks).toBe(2)
  })

  it('keeps an automatic offline/404 check quiet while logging its diagnostic and clearing the check', () => {
    const { backend, sink, controller } = createStableController()

    expect(controller.check(false)).toBe(true)
    backend.emitError('HTTP 404 while reading RELEASES')

    expect(sink.error).not.toHaveBeenCalled()
    expect(sink.logError).toHaveBeenCalledWith('HTTP 404 while reading RELEASES')
    expect(controller.check(false)).toBe(true)
    expect(backend.checks).toBe(2)
  })

  it('makes a manual 404 check visible without exposing backend details in the UI message', () => {
    const { backend, sink, controller } = createStableController()

    expect(controller.check(true)).toBe(true)
    backend.emitError('HTTP 404 while reading RELEASES')

    expect(sink.error).toHaveBeenCalledWith(
      'Could not check for updates. You can keep using nodeterm 1.2.3 and try again later.'
    )
    expect(sink.error.mock.calls[0][0]).not.toContain('404')
    expect(sink.logError).toHaveBeenCalledWith('HTTP 404 while reading RELEASES')
  })

  it('makes a download failure visible after an automatic available event', () => {
    const { backend, sink, controller } = createStableController()

    expect(controller.check(false)).toBe(true)
    backend.emitAvailable()
    backend.emitError('socket closed while downloading package')

    expect(sink.error).toHaveBeenCalledWith(
      'Could not finish downloading the update. You can keep using nodeterm 1.2.3 and try again later.'
    )
    expect(sink.logError).toHaveBeenCalledWith('socket closed while downloading package')
    expect(controller.check(false)).toBe(true)
  })

  it('handles synchronous check failures with the same manual/automatic visibility policy', () => {
    const automatic = createStableController()
    automatic.backend.checkError = new Error('offline before request')
    expect(automatic.controller.check(false)).toBe(false)
    expect(automatic.sink.error).not.toHaveBeenCalled()
    expect(automatic.sink.logError).toHaveBeenCalledWith('offline before request')

    const manual = createStableController()
    manual.backend.checkError = new Error('HTTP 404 before request')
    expect(manual.controller.check(true)).toBe(false)
    expect(manual.sink.error).toHaveBeenCalledWith(
      'Could not check for updates. You can keep using nodeterm 1.2.3 and try again later.'
    )
    expect(manual.sink.logError).toHaveBeenCalledWith('HTTP 404 before request')
  })

  it('refuses checks when feed setup fails and exposes eligibility only to manual checks', () => {
    const backend = new FakeSquirrelBackend()
    backend.setFeedError = new Error('setFeedURL failed')
    const sink = createSink()
    const controller = createWindowsSquirrelController({
      appVersion: '1.2.3',
      backend,
      sink
    })

    expect(sink.logError).toHaveBeenCalledWith('setFeedURL failed')
    expect(controller.check(false)).toBe(false)
    expect(sink.error).not.toHaveBeenCalled()
    expect(controller.check(true)).toBe(false)
    expect(sink.error).toHaveBeenCalledWith('This build has no eligible update channel.')
    expect(backend.checks).toBe(0)
  })

  it('logs unowned backend events and never turns them into update UI state', () => {
    const { backend, sink } = createStableController()

    backend.emitAvailable()
    backend.emitDownloaded('1.3.0')

    expect(sink.logError).toHaveBeenNthCalledWith(
      1,
      'Squirrel emitted update-available without an owned update check'
    )
    expect(sink.logError).toHaveBeenNthCalledWith(
      2,
      'Squirrel emitted update-downloaded without an owned update check'
    )
    expect(sink.available).not.toHaveBeenCalled()
    expect(sink.downloaded).not.toHaveBeenCalled()
  })
})

describe('download channel and install gates', () => {
  it('offers a strictly newer stable download and permits exactly one install', () => {
    const { backend, sink, controller } = createStableController()

    expect(controller.restart()).toBe(false)
    expect(controller.check(true)).toBe(true)
    backend.emitDownloaded('nodeterm-1.3.0-full.nupkg')

    expect(sink.downloaded).toHaveBeenCalledWith({ version: '1.3.0' })
    expect(controller.check(false)).toBe(false)
    expect(controller.restart()).toBe(true)
    expect(controller.restart()).toBe(false)
    expect(backend.installs).toBe(1)
  })

  it('changes quit lifecycle only after Electron confirms the updater quit', () => {
    const listeners: Array<() => void> = []
    const markQuitting = vi.fn<() => void>()

    registerBeforeQuitForUpdate((listener) => listeners.push(listener), markQuitting)
    expect(markQuitting).not.toHaveBeenCalled()
    expect(listeners).toHaveLength(1)

    listeners[0]()
    expect(markQuitting).toHaveBeenCalledOnce()
  })

  it('replays a retained ready update to a reloaded renderer without another download', () => {
    const { backend, sink, controller } = createStableController()

    expect(controller.check(true)).toBe(true)
    backend.emitDownloaded('nodeterm-1.3.0-full.nupkg')
    expect(backend.checks).toBe(1)

    sink.downloaded.mockClear()
    expect(controller.check(false)).toBe(false)
    expect(sink.downloaded).not.toHaveBeenCalled()
    expect(controller.check(true)).toBe(false)
    expect(sink.downloaded).toHaveBeenCalledOnce()
    expect(sink.downloaded).toHaveBeenCalledWith({ version: '1.3.0' })
    expect(backend.checks).toBe(1)

    expect(controller.restart()).toBe(true)
    sink.downloaded.mockClear()
    expect(controller.check(true)).toBe(false)
    expect(sink.downloaded).not.toHaveBeenCalled()
    expect(backend.checks).toBe(1)
  })

  it('retains the staged update and permits retry after an asynchronous installer error', () => {
    const { backend, sink, controller } = createStableController()

    expect(controller.check(true)).toBe(true)
    backend.emitDownloaded('nodeterm-1.3.0-full.nupkg')
    expect(controller.restart()).toBe(true)
    expect(backend.installs).toBe(1)

    backend.emitError('Update.exe launch failed asynchronously')
    expect(sink.error).toHaveBeenCalledWith(
      'Could not restart to install nodeterm 1.3.0: Update.exe launch failed asynchronously'
    )
    expect(sink.logError).toHaveBeenCalledWith('Update.exe launch failed asynchronously')
    expect(controller.restart()).toBe(true)
    expect(backend.installs).toBe(2)
  })

  it.each(['1.2.3', '1.2.2', '1.3.0-fixture.1'])
  ('refuses parseable same, older, or wrong-channel download %s as a diagnostic/UI guard', (version) => {
    const { backend, sink, controller } = createStableController()

    expect(controller.check(false)).toBe(true)
    backend.emitDownloaded(version)

    expect(sink.downloaded).not.toHaveBeenCalled()
    expect(sink.error).toHaveBeenCalledWith(
      "The downloaded update did not match this app's channel. Restart here is disabled, but Windows may still apply the staged update on the next launch."
    )
    expect(controller.restart()).toBe(false)
    expect(backend.installs).toBe(0)
  })

  it('allows advancement inside the fixture channel but refuses a stable package', () => {
    const fixtureBackend = new FakeSquirrelBackend()
    const fixtureSink = createSink()
    const fixture = createWindowsSquirrelController({
      appVersion: '1.2.3-fixture.1',
      fixtureURL: 'http://127.0.0.1:4312/feed',
      backend: fixtureBackend,
      sink: fixtureSink
    })

    expect(fixture.check(true)).toBe(true)
    fixtureBackend.emitDownloaded(
      'node-terminal-squirrel-fixture-1.2.3-fixture2-full.nupkg'
    )
    expect(fixtureSink.downloaded).toHaveBeenCalledWith({ version: '1.2.3-fixture.2' })

    const stableBackend = new FakeSquirrelBackend()
    const stableSink = createSink()
    const wrongChannel = createWindowsSquirrelController({
      appVersion: '1.2.3-fixture.1',
      fixtureURL: 'http://localhost:4312/feed',
      backend: stableBackend,
      sink: stableSink
    })
    expect(wrongChannel.check(true)).toBe(true)
    stableBackend.emitDownloaded('1.3.0')
    expect(stableSink.downloaded).not.toHaveBeenCalled()
    expect(wrongChannel.restart()).toBe(false)
  })

  it('does not invent a version for an opaque release name but preserves Squirrel install truth', () => {
    const { backend, sink, controller } = createStableController()

    expect(controller.check(true)).toBe(true)
    backend.emitDownloaded('nodeterm stable update')

    expect(sink.downloaded).toHaveBeenCalledWith({ version: undefined })
    expect(controller.restart()).toBe(true)
    expect(backend.installs).toBe(1)
  })

  it('keeps a ready update retryable when restart throws, then prevents duplicate installs', () => {
    const quitAndInstall = vi
      .fn<() => void>()
      .mockImplementationOnce(() => {
        throw new Error('Update.exe is busy')
      })
      .mockImplementationOnce(() => undefined)
    const onError = vi.fn<(message: string) => void>()
    const gate = createInstallGate({ quitAndInstall, onError })

    expect(gate.restart()).toBe(false)
    gate.markReady('1.3.0')
    expect(gate.ready).toBe(true)
    expect(gate.readyVersion).toBe('1.3.0')

    expect(gate.restart()).toBe(false)
    expect(gate.ready).toBe(true)
    expect(gate.installing).toBe(false)
    expect(onError).toHaveBeenCalledWith(
      'Could not restart to install nodeterm 1.3.0: Update.exe is busy'
    )

    expect(gate.restart()).toBe(true)
    expect(gate.installing).toBe(true)
    expect(gate.restart()).toBe(false)
    gate.markReady('9.9.9')
    expect(gate.readyVersion).toBe('1.3.0')
    expect(quitAndInstall).toHaveBeenCalledTimes(2)
  })

  it('handles a non-throwing synchronous installer error as a retryable failed attempt', () => {
    const onError = vi.fn<(message: string) => void>()
    let gate: ReturnType<typeof createInstallGate>
    const quitAndInstall = vi
      .fn<() => void>()
      .mockImplementationOnce(() => {
        gate.installFailed(new Error('backend emitted failure'))
      })
      .mockImplementationOnce(() => undefined)
    gate = createInstallGate({ quitAndInstall, onError })
    gate.markReady('1.3.0')

    expect(gate.restart()).toBe(false)
    expect(gate.ready).toBe(true)
    expect(gate.installing).toBe(false)
    expect(onError).toHaveBeenCalledWith(
      'Could not restart to install nodeterm 1.3.0: backend emitted failure'
    )

    expect(gate.restart()).toBe(true)
    expect(gate.installing).toBe(true)
    expect(quitAndInstall).toHaveBeenCalledTimes(2)
  })
})
