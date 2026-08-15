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
  // Track whether a pairing listener is currently running so unmount can stop it.
  const runningRef = useRef(false)

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
    setError('')
    setBusy(true)
    try {
      const {
        payload,
        sshOpen: open,
        relayPlan: plan,
        shortCode: code,
        manualHost: mhost
      } = await window.nodeTerminal.pairing.start()
      setRelayPlan(plan ?? null)
      const dataUrl = await toDataURL(payload, { margin: 1, width: 240 })
      setQr(dataUrl)
      setShortCode(code ?? '')
      setManualHost(mhost ?? '')
      setSshOpen(open)
      setSshHealed(false)
      setRelayResult(null)
      setPhase('waiting')
      runningRef.current = true
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const stop = (): void => {
    if (runningRef.current) {
      runningRef.current = false
      void window.nodeTerminal.pairing.stop()
    }
    setPhase('idle')
    setQr('')
    setShortCode('')
    setManualHost('')
  }

  // Subscribe to the completion event. `onFinished` rides a ref so a re-rendered callback never
  // resubscribes the event. It runs for failures too: registry-first persistence can deliberately
  // leave a retryable device record when authorized_keys finalization fails, and Settings must
  // refresh immediately so that record is visible and revocable.
  const onFinishedRef = useRef(onFinished)
  onFinishedRef.current = onFinished
  useEffect(() => {
    return window.nodeTerminal.pairing.onDone((result) => {
      runningRef.current = false
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
    return () => {
      if (runningRef.current) {
        runningRef.current = false
        void window.nodeTerminal.pairing.stop()
      }
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
