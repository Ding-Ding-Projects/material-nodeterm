import { useEffect, useRef, useState } from 'react'
import { toDataURL } from 'qrcode'
import type { PairingDoneResult } from '@shared/types'

export type PairingPhase = 'idle' | 'waiting' | 'paired' | 'timeout' | 'failed'

/** Pure completion mapping so a persistence failure cannot silently regress to "timed out". */
export function pairingDonePresentation(result: PairingDoneResult): {
  phase: PairingPhase
  error: string
} {
  if (result.ok) return { phase: 'paired', error: '' }
  if (result.reason === 'attempts') {
    return {
      phase: 'failed',
      error: 'Pairing closed after too many incorrect codes. Start again for a fresh code.'
    }
  }
  if (result.reason === 'failed') {
    return {
      phase: 'failed',
      error:
        'Pairing failed before credentials were delivered. Review Paired devices in Phone settings; if an entry was created, revoke it before trying again.'
    }
  }
  return { phase: 'timeout', error: '' }
}

/** How often the Remote Login warning re-probes sshd while it is showing. */
const SSH_RECHECK_MS = 2000

function createPairingAttemptId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('Secure pairing is unavailable because cryptographic UUIDs are unavailable.')
  }
  return globalThis.crypto.randomUUID()
}

/**
 * The phone-pairing state machine, shared by Settings → Phone and the quick-pair popover:
 * start/stop, the QR data URL, the completion event, and the live Remote-Login (sshd) re-probe
 * while the warning is visible. Any in-flight pairing is stopped when the OWNING view unmounts —
 * both hosts are transient surfaces, and a headless listener would silently pair whoever scans a
 * QR that is no longer on screen.
 */
export function usePhonePairing(onFinished?: () => void): {
  phase: PairingPhase
  qr: string
  /** Six-digit code for typing in by hand where a camera cannot be used. */
  shortCode: string
  /** The `host:port` that code is typed at. */
  manualHost: string
  sshOpen: boolean
  sshHealed: boolean
  /** On phase 'paired': whether the pairing came with a relay leg ('off' = toggle disabled,
   *  'failed' = mint failed → LAN-only). Surfaced so the silent degrade is visible at the one
   *  moment the user is looking. */
  relayResult: 'ok' | 'off' | 'failed' | 'dev' | null
  /** While 'waiting': what the QR on screen WILL mint — lets the surfaces warn beside the QR
   *  (esp. 'dev': unpackaged build, relay off regardless of the toggle). */
  relayPlan: 'ok' | 'dev' | 'off' | null
  error: string
  busy: boolean
  start: () => Promise<void>
  stop: () => void
  reset: () => void
} {
  const [phase, setPhase] = useState<PairingPhase>('idle')
  const [qr, setQr] = useState('')
  const [shortCode, setShortCode] = useState('')
  const [manualHost, setManualHost] = useState('')
  const [sshOpen, setSshOpen] = useState(true)
  // Went from unreachable → reachable while the warning was showing: show a green confirmation
  // instead of silently dropping the warning (the user just flipped a toggle; acknowledge it).
  const [sshHealed, setSshHealed] = useState(false)
  const [relayResult, setRelayResult] = useState<'ok' | 'off' | 'failed' | 'dev' | null>(null)
  const [relayPlan, setRelayPlan] = useState<'ok' | 'dev' | 'off' | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Ownership starts BEFORE the IPC await: closing a surface while main is still starting the
  // listener must send stop now, then poison every late continuation. Epochs also keep an older
  // QR render/finally from overwriting a newer start, explicit stop, or completion event.
  const attemptRef = useRef<string | null>(null)
  const epochRef = useRef(0)
  const mountedRef = useRef(true)
  const listenerAttemptRef = useRef<string | null>(null)
  // Only the IPC start handshake is queued. If start B supersedes pending start A, A resolves,
  // sees its stale epoch and stops its listener BEFORE B is dispatched; a global stop API cannot
  // otherwise target A without accidentally canceling B's fresh listener.
  const startDispatchRef = useRef<Promise<void>>(Promise.resolve())
  const stopHostAttempt = async (attemptId: string): Promise<void> => {
    await window.nodeTerminal.pairing.stop(attemptId).catch(() => undefined)
  }

  // Live re-check while the Remote Login warning is visible: the initial probe runs once at
  // pairing start, so without this the warning could never clear — the user enables Remote Login
  // in System Settings and nothing changes on screen. Poll only in that exact state (waiting +
  // unreachable); the interval dies with the warning.
  useEffect(() => {
    if (phase !== 'waiting' || sshOpen) return
    let cancelled = false
    const timer = setInterval(() => {
      void window.nodeTerminal.pairing
        .probeSsh()
        .then((open) => {
          if (!cancelled && open) {
            setSshOpen(true)
            setSshHealed(true)
          }
        })
        .catch(() => {
          // transient probe error: keep the warning, try again on the next tick
        })
    }, SSH_RECHECK_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [phase, sshOpen])

  const start = async (): Promise<void> => {
    const attemptId = createPairingAttemptId()
    const predecessor = startDispatchRef.current
    const previousListenerAttempt = listenerAttemptRef.current
    const epoch = ++epochRef.current
    attemptRef.current = attemptId
    listenerAttemptRef.current = null
    setError('')
    setBusy(true)
    setQr('')
    setShortCode('')
    setManualHost('')
    try {
      // If the previous start reached main, stop it before dispatching this replacement. If its
      // IPC is still pending, `predecessor` itself performs the late stop before it resolves.
      const replacementStop = previousListenerAttempt
        ? stopHostAttempt(previousListenerAttempt)
        : Promise.resolve()
      const startRequest = Promise.all([predecessor, replacementStop]).then(async () => {
        if (!mountedRef.current || epochRef.current !== epoch) {
          throw new Error('Pairing start was superseded.')
        }
        const started = await window.nodeTerminal.pairing.start(attemptId)
        if (!mountedRef.current || epochRef.current !== epoch) {
          // The first stop may have raced ahead of main creating the listener. Do not release the
          // dispatch queue until this second, post-resolution stop has completed.
          await stopHostAttempt(attemptId)
          throw new Error('Pairing start was superseded.')
        }
        if (started.attemptId !== attemptId) {
          await stopHostAttempt(started.attemptId)
          throw new Error('Pairing start ownership could not be verified.')
        }
        listenerAttemptRef.current = attemptId
        return started
      })
      startDispatchRef.current = startRequest.then(
        () => undefined,
        () => undefined
      )
      const {
        payload,
        sshOpen: open,
        relayPlan: plan,
        shortCode: code,
        manualHost: mhost
      } = await startRequest
      if (!mountedRef.current || epochRef.current !== epoch) {
        await stopHostAttempt(attemptId)
        return
      }
      // Main now owns a live listener; keep ownership true while QR generation is pending so an
      // unmount or explicit stop cannot leak a headless ten-minute pairing window.
      setRelayPlan(plan ?? null)
      const dataUrl = await toDataURL(payload, { margin: 1, width: 240 })
      if (!mountedRef.current || epochRef.current !== epoch) return
      setQr(dataUrl)
      setShortCode(code ?? '')
      setManualHost(mhost ?? '')
      setSshOpen(open)
      setSshHealed(false)
      setRelayResult(null)
      setPhase('waiting')
    } catch (err) {
      if (mountedRef.current && epochRef.current === epoch) {
        const owned = attemptRef.current === attemptId
        attemptRef.current = null
        listenerAttemptRef.current = null
        // A QR failure happens after main created the listener. Never leave that invisible attempt
        // running just because renderer-side encoding failed.
        if (owned) await stopHostAttempt(attemptId)
        setError((err as Error).message)
      }
    } finally {
      if (mountedRef.current && epochRef.current === epoch) setBusy(false)
    }
  }

  const stop = (): void => {
    epochRef.current += 1
    const owned = attemptRef.current
    attemptRef.current = null
    listenerAttemptRef.current = null
    if (owned) void stopHostAttempt(owned)
    setBusy(false)
    setPhase('idle')
    setQr('')
    setShortCode('')
    setManualHost('')
    setError('')
  }

  // Subscribe to the completion event. `onFinished` rides a ref so a re-rendered callback never
  // resubscribes the event. It runs for failures too: registry-first persistence can deliberately
  // leave a retryable device record when authorized_keys finalization fails, and Settings must
  // refresh immediately so that record is visible and revocable.
  const onFinishedRef = useRef(onFinished)
  onFinishedRef.current = onFinished
  useEffect(() => {
    return window.nodeTerminal.pairing.onDone((result) => {
      if (result.attemptId !== attemptRef.current) return
      epochRef.current += 1
      attemptRef.current = null
      listenerAttemptRef.current = null
      setBusy(false)
      setQr('')
      setShortCode('')
      setManualHost('')
      const presentation = pairingDonePresentation(result)
      setPhase(presentation.phase)
      setError(presentation.error)
      setRelayResult(result.ok ? (result.relay ?? null) : null)
      onFinishedRef.current?.()
    })
  }, [])

  // Stop any in-flight pairing when the owning view unmounts (closed / navigated away).
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      epochRef.current += 1
      const owned = attemptRef.current
      attemptRef.current = null
      listenerAttemptRef.current = null
      if (owned) void stopHostAttempt(owned)
    }
  }, [])

  const reset = (): void => {
    setPhase('idle')
    setError('')
  }

  return {
    phase,
    qr,
    shortCode,
    manualHost,
    sshOpen,
    sshHealed,
    relayResult,
    relayPlan,
    error,
    busy,
    start,
    stop,
    reset
  }
}
