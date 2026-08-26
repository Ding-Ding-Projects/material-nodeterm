import { useEffect, useState } from 'react'
import type { PtyPressure } from '@shared/types'
import { isMacPlatform } from '../../shared/platform-utils'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'

// The warning that was missing on 2026-08-11: the machine filled up its pty devices
// (`kern.tty.ptmx_max`) and the first thing anyone learned about it was terminals refusing to
// open. The shell now measures the pressure (core/pty-pressure.ts) and this strip says so while
// there is still room to act — in the user's terms (terminals, sessions), not the kernel's.
//
// Its own component, subscribing for itself, for the same reason TmuxBanner is: Canvas.tsx is a
// hot file that every other branch touches, and a banner is not canvas logic. The one thing it
// cannot own is the error surface — failures belong in the same toast strip as every other async
// canvas op — so that comes in as a prop.

export interface PtyPressureCopy {
  title: string
  body: string
  /** Body segments keep the live numeric measurement separate from translatable prose. */
  bodyParts: readonly { kind: 'authored' | 'factual'; text: string }[]
  /** Drives the banner's severity styling (`announce-banner--<tone>`). */
  tone: 'warning' | 'danger'
}

/**
 * What the strip says, or `null` for "say nothing".
 *
 * Both bands end on the SAME sentence about Recently closed, because that is the one lever the
 * user has that costs nothing and always works: a deleted session's tmux session ends, and its
 * pty devices go back to the machine. What neither band says is `sysctl` — the button below is
 * that sentence's replacement, and a user who can read a shell command already got it from the
 * spawn error.
 */
export function ptyPressureCopy(p: PtyPressure): PtyPressureCopy | null {
  if (p.level === 'none' || p.usage === null || p.ceiling === null) return null
  const counts = `(${p.usage} of ${p.ceiling} pty devices)`
  const recover = 'Deleting sessions from Recently closed returns them.'
  if (p.level === 'critical') {
    const body =
      `This machine has run out of terminal capacity ${counts}. New terminals will fail to ` +
      `open until some are returned. ${recover}`
    return {
      tone: 'danger',
      title: 'Out of terminal capacity',
      body,
      bodyParts: [
        { kind: 'authored', text: 'This machine has run out of terminal capacity ' },
        { kind: 'factual', text: counts },
        { kind: 'authored', text: '. New terminals will fail to open until some are returned. ' },
        { kind: 'authored', text: recover }
      ]
    }
  }
  const body = `This machine is close to its terminal limit ${counts}. ${recover}`
  return {
    tone: 'warning',
    title: 'Close to this machine’s terminal limit',
    body,
    bodyParts: [
      { kind: 'authored', text: 'This machine is close to its terminal limit ' },
      { kind: 'factual', text: counts },
      { kind: 'authored', text: '. ' },
      { kind: 'authored', text: recover }
    ]
  }
}

export function PtyPressureBanner({
  onError,
  isMac = isMacPlatform()
}: {
  /** Surface a FAILED fix the way the canvas surfaces every other async failure. */
  onError: (message: string) => void
  isMac?: boolean
}): JSX.Element | null {
  // `seq` counts BROADCASTS, not levels: the shell sends one per band change and one per
  // five-minute re-announce, which is what lets a dismissal be scoped to a single reminder.
  const [state, setState] = useState<{ reading: PtyPressure; seq: number } | null>(null)
  const [dismissed, setDismissed] = useState<{ level: PtyPressure['level']; seq: number } | null>(
    null
  )
  const [busy, setBusy] = useState(false)
  const vocab = useVocabularyMapper()

  useEffect(() => {
    // Optional-called: the Server Edition bridge declares this a documented no-op.
    const off = window.nodeTerminal.onPtyPressure?.((r) =>
      setState((prev) => ({ reading: r, seq: (prev?.seq ?? 0) + 1 }))
    )
    return () => off?.()
  }, [])

  const reading = state?.reading ?? null
  const copy = reading ? ptyPressureCopy(reading) : null
  // Dismissal is never for the session, and the two bands are not dismissed on the same terms:
  //   - ELEVATED sticks until the level changes. It is an early warning with runway left; the
  //     user has been told, and a strip that comes back every five minutes on a machine that is
  //     merely busy is how a banner teaches people to ignore it.
  //   - CRITICAL expires with the broadcast it dismissed. Terminals are failing to open RIGHT NOW,
  //     so ✕ buys quiet until the next reminder (five minutes, see PTY_PRESSURE_RE_ANNOUNCE_MS),
  //     never permanent silence.
  // Either way a drop to `none` clears everything: there is nothing left to dismiss.
  const hidden =
    !!dismissed &&
    !!reading &&
    dismissed.level === reading.level &&
    (reading.level !== 'critical' || dismissed.seq === state!.seq)
  if (!reading || !copy || hidden) return null

  const fix = (): void => {
    if (busy) return
    setBusy(true)
    // No optimistic clear: the banner comes down when the SHELL says the level dropped (the
    // handler re-announces from the ceiling it just set), so what the user sees is the machine's
    // state, never our hope for it. A cancelled password dialog is a decision, not a failure —
    // it leaves the banner exactly as it was and nothing is retried.
    void window.nodeTerminal
      .raisePtyDeviceLimit?.()
      .then((res) => {
        // `canceled` (the user said no) and `busy` (another window is already asking) are both
        // outcomes, not failures — neither may raise a toast.
        if (!res.ok && !res.canceled && !res.busy) onError(res.error)
      })
      .catch((e: unknown) => onError(String((e as Error)?.message ?? e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className={`announce-banner announce-banner--${copy.tone}`}>
      <span className="announce-banner__dot" />
      <div className="announce-banner__content">
        <span className="announce-banner__title">{vocab(copy.title)}</span>
        <span className="announce-banner__body">
          {copy.bodyParts.map((part, index) => (
            <span key={`${part.kind}-${index}`}>{part.kind === 'authored' ? vocab(part.text) : part.text}</span>
          ))}
        </span>
      </div>
      {isMac && (
        <button
          className="announce-banner__btn"
          title={vocab('Raises this Mac’s pty-device limit (kern.tty.ptmx_max) now and after every restart. macOS will ask for your password.')}
          disabled={busy}
          onClick={fix}
        >
          {busy ? vocab('Fixing…') : vocab('Fix automatically…')}
        </button>
      )}
      <button
        className="announce-banner__close"
        title={vocab('Dismiss')}
        onClick={() => setDismissed({ level: reading.level, seq: state!.seq })}
      >
        ✕
      </button>
    </div>
  )
}
