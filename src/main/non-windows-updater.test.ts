import { describe, expect, it, vi } from 'vitest'
import { createInstallGate } from './squirrel-updater'
import {
  createNonWindowsUpdateRequestArbiter,
  wireNonWindowsUpdateLifecycle
} from './non-windows-updater'

function deferred() {
  let resolve!: () => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = () => resolvePromise()
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createHarness(blockedBy?: () => boolean, replayReadyUpdate?: () => boolean) {
  let blocked = false
  const checks: Array<ReturnType<typeof deferred>> = []
  const sendNotAvailable = vi.fn<() => void>()
  const sendError = vi.fn<(detail: string) => void>()
  const logError = vi.fn<(detail: string) => void>()
  const arbiter = createNonWindowsUpdateRequestArbiter({
    checkForUpdates: () => {
      const check = deferred()
      checks.push(check)
      return check.promise
    },
    isCheckBlocked: () => blocked || blockedBy?.() === true,
    replayReadyUpdate,
    sendNotAvailable,
    sendError,
    logError
  })
  return {
    arbiter,
    checks,
    sendNotAvailable,
    sendError,
    logError,
    setBlocked(value: boolean) {
      blocked = value
    }
  }
}

async function flushRejection(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('non-Windows updater request arbitration', () => {
  it('joins a manual click to one automatic backend check and upgrades its fallback visibility', async () => {
    const harness = createHarness()

    expect(harness.arbiter.check(false)).toBe(true)
    expect(harness.arbiter.check(true)).toBe(false)
    expect(harness.checks).toHaveLength(1)

    harness.checks[0].reject(new Error('joined request failed'))
    await flushRejection()

    expect(harness.logError).toHaveBeenCalledOnce()
    expect(harness.logError).toHaveBeenCalledWith('joined request failed')
    expect(harness.sendError).toHaveBeenCalledOnce()
    expect(harness.sendError).toHaveBeenCalledWith('joined request failed')
    expect(harness.arbiter.active).toBe(false)
  })

  it('lets the raw backend error event win once over its later promise rejection', async () => {
    const harness = createHarness()

    // Automatic event errors were already part of the macOS/Linux UI contract.
    expect(harness.arbiter.check(false)).toBe(true)
    harness.arbiter.backendError(new Error('raw backend failure'))
    harness.checks[0].reject(new Error('raw backend failure'))
    await flushRejection()

    expect(harness.sendError).toHaveBeenCalledTimes(1)
    expect(harness.sendError).toHaveBeenCalledWith('raw backend failure')
    expect(harness.logError).toHaveBeenCalledTimes(1)
    expect(harness.logError).toHaveBeenCalledWith('raw backend failure')
  })

  it('keeps an unowned automatic backend error event visible verbatim', () => {
    const harness = createHarness()

    harness.arbiter.backendError(new Error('background backend failure'))

    expect(harness.checks).toHaveLength(0)
    expect(harness.sendError).toHaveBeenCalledOnce()
    expect(harness.sendError).toHaveBeenCalledWith('background backend failure')
    expect(harness.logError).toHaveBeenCalledOnce()
    expect(harness.logError).toHaveBeenCalledWith('background backend failure')
  })

  it('shows a promise-only rejection for a manual check and keeps an automatic one quiet', async () => {
    const manual = createHarness()
    expect(manual.arbiter.check(true)).toBe(true)
    manual.checks[0].reject(new Error('manual promise failure'))
    await flushRejection()
    expect(manual.sendError).toHaveBeenCalledWith('manual promise failure')
    expect(manual.logError).toHaveBeenCalledWith('manual promise failure')

    const automatic = createHarness()
    expect(automatic.arbiter.check(false)).toBe(true)
    automatic.checks[0].reject(new Error('automatic promise failure'))
    await flushRejection()
    expect(automatic.sendError).not.toHaveBeenCalled()
    expect(automatic.logError).toHaveBeenCalledWith('automatic promise failure')
  })

  it('retains automatic update-not-available visibility and releases request ownership', () => {
    const harness = createHarness()

    expect(harness.arbiter.check(false)).toBe(true)
    harness.arbiter.notAvailable()

    expect(harness.sendNotAvailable).toHaveBeenCalledOnce()
    expect(harness.arbiter.active).toBe(false)
    expect(harness.arbiter.check(false)).toBe(true)
    expect(harness.checks).toHaveLength(2)
  })

  it('blocks new checks after the install gate becomes ready or starts installing', () => {
    const harness = createHarness()

    harness.setBlocked(true)
    expect(harness.arbiter.check(true)).toBe(false)
    expect(harness.checks).toHaveLength(0)

    harness.setBlocked(false)
    expect(harness.arbiter.check(false)).toBe(true)
    harness.arbiter.finish()
    harness.setBlocked(true)
    expect(harness.arbiter.check(false)).toBe(false)
    expect(harness.checks).toHaveLength(1)
  })

  it('replays retained ready truth only for a blocked manual check after renderer reload', () => {
    const replayed = vi.fn<(version?: string) => void>()
    const installGate = createInstallGate({
      quitAndInstall: vi.fn(),
      onError: vi.fn()
    })
    const harness = createHarness(
      () => installGate.ready || installGate.installing,
      () => installGate.replayReady(replayed)
    )

    installGate.markReady('2.0.0')
    expect(harness.arbiter.check(false)).toBe(false)
    expect(replayed).not.toHaveBeenCalled()
    expect(harness.arbiter.check(true)).toBe(false)
    expect(replayed).toHaveBeenCalledOnce()
    expect(replayed).toHaveBeenCalledWith('2.0.0')
    expect(harness.checks).toHaveLength(0)

    expect(installGate.restart()).toBe(true)
    expect(harness.arbiter.check(true)).toBe(false)
    expect(replayed).toHaveBeenCalledOnce()
    expect(harness.checks).toHaveLength(0)
  })

  it('wires manual availability and a download into request release and the real install gate', () => {
    const availableListeners: Array<(info: { version: string }) => void> = []
    const downloadedListeners: Array<(info: { version: string }) => void> = []
    const notAvailableListeners: Array<() => void> = []
    const errorListeners: Array<(error: unknown) => void> = []
    const installs = vi.fn<() => void>()
    const installError = vi.fn<(message: string) => void>()
    const forwardedAvailable = vi.fn<(info: { version: string }) => void>()
    const forwardedDownloaded = vi.fn<(info: { version: string }) => void>()
    const installGate = createInstallGate({
      quitAndInstall: installs,
      onError: installError
    })
    const harness = createHarness(() => installGate.ready || installGate.installing)

    wireNonWindowsUpdateLifecycle({
      manualUpdates: true,
      requests: harness.arbiter,
      installGate,
      onAvailable: (listener) => availableListeners.push(listener),
      onDownloaded: (listener) => downloadedListeners.push(listener),
      onNotAvailable: (listener) => notAvailableListeners.push(listener),
      onError: (listener) => errorListeners.push(listener),
      downloadedVersion: (info) => info.version,
      forwardAvailable: forwardedAvailable,
      forwardDownloaded: forwardedDownloaded
    })

    expect(harness.arbiter.check(false)).toBe(true)
    availableListeners[0]({ version: '2.0.0' })
    expect(forwardedAvailable).toHaveBeenCalledWith({ version: '2.0.0' })
    expect(harness.arbiter.active).toBe(false)

    expect(harness.arbiter.check(false)).toBe(true)
    downloadedListeners[0]({ version: '2.0.0' })
    expect(forwardedDownloaded).toHaveBeenCalledWith({ version: '2.0.0' })
    expect(harness.arbiter.active).toBe(false)
    expect(installGate.ready).toBe(true)
    expect(installGate.readyVersion).toBe('2.0.0')
    expect(harness.arbiter.check(true)).toBe(false)
    expect(harness.checks).toHaveLength(2)

    expect(installGate.restart()).toBe(true)
    expect(installGate.restart()).toBe(false)
    expect(installs).toHaveBeenCalledOnce()
    errorListeners[0](new Error('installer launch event failure'))
    expect(installError).toHaveBeenCalledWith(
      'Could not restart to install nodeterm 2.0.0: installer launch event failure'
    )
    expect(harness.logError).toHaveBeenCalledWith('installer launch event failure')
    expect(harness.sendError).not.toHaveBeenCalled()
    expect(installGate.restart()).toBe(true)
    expect(installs).toHaveBeenCalledTimes(2)
    expect(notAvailableListeners).toHaveLength(1)
    expect(errorListeners).toHaveLength(1)
  })

  it('wires the self-installing available, no-update, error, and downloaded event ordering', async () => {
    const harness = createHarness()
    const availableListeners: Array<(info: { version: string }) => void> = []
    const downloadedListeners: Array<(info: { version: string }) => void> = []
    const notAvailableListeners: Array<() => void> = []
    const errorListeners: Array<(error: unknown) => void> = []
    const markReady = vi.fn<(version?: string) => void>()

    wireNonWindowsUpdateLifecycle({
      manualUpdates: false,
      requests: harness.arbiter,
      installGate: {
        markReady,
        installFailed: vi.fn<() => boolean>().mockReturnValue(false),
        ready: false,
        installing: false
      },
      onAvailable: (listener) => availableListeners.push(listener),
      onDownloaded: (listener) => downloadedListeners.push(listener),
      onNotAvailable: (listener) => notAvailableListeners.push(listener),
      onError: (listener) => errorListeners.push(listener),
      downloadedVersion: (info) => info.version,
      forwardAvailable: vi.fn(),
      forwardDownloaded: vi.fn()
    })

    expect(harness.arbiter.check(false)).toBe(true)
    availableListeners[0]({ version: '2.0.0' })
    expect(harness.arbiter.active).toBe(true)
    expect(harness.arbiter.check(true)).toBe(false)
    expect(harness.checks).toHaveLength(1)

    errorListeners[0](new Error('event wins'))
    expect(harness.sendError).toHaveBeenCalledTimes(1)
    expect(harness.sendError).toHaveBeenCalledWith('event wins')
    expect(harness.logError).toHaveBeenCalledTimes(1)
    expect(harness.arbiter.active).toBe(false)
    harness.checks[0].reject(new Error('event wins'))
    await flushRejection()
    expect(harness.sendError).toHaveBeenCalledTimes(1)
    expect(harness.logError).toHaveBeenCalledTimes(1)

    expect(harness.arbiter.check(false)).toBe(true)
    notAvailableListeners[0]()
    expect(harness.sendNotAvailable).toHaveBeenCalledOnce()
    expect(harness.arbiter.active).toBe(false)

    expect(harness.arbiter.check(false)).toBe(true)
    availableListeners[0]({ version: '2.0.0' })
    downloadedListeners[0]({ version: '2.0.0' })
    expect(markReady).toHaveBeenCalledWith('2.0.0')
    expect(harness.arbiter.active).toBe(false)
    expect(harness.checks).toHaveLength(3)
  })

  it('handles a synchronous backend failure with the same manual visibility policy', () => {
    const sendError = vi.fn<(detail: string) => void>()
    const logError = vi.fn<(detail: string) => void>()
    const arbiter = createNonWindowsUpdateRequestArbiter({
      checkForUpdates: () => {
        throw new Error('synchronous backend failure')
      },
      isCheckBlocked: () => false,
      sendNotAvailable: vi.fn(),
      sendError,
      logError
    })

    expect(arbiter.check(true)).toBe(false)
    expect(sendError).toHaveBeenCalledWith('synchronous backend failure')
    expect(logError).toHaveBeenCalledWith('synchronous backend failure')
    expect(arbiter.active).toBe(false)

    const automaticSendError = vi.fn<(detail: string) => void>()
    const automaticLogError = vi.fn<(detail: string) => void>()
    const automatic = createNonWindowsUpdateRequestArbiter({
      checkForUpdates: () => {
        throw new Error('automatic synchronous failure')
      },
      isCheckBlocked: () => false,
      sendNotAvailable: vi.fn(),
      sendError: automaticSendError,
      logError: automaticLogError
    })
    expect(automatic.check(false)).toBe(false)
    expect(automaticSendError).not.toHaveBeenCalled()
    expect(automaticLogError).toHaveBeenCalledWith('automatic synchronous failure')
  })
})
