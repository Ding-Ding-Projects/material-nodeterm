import { useEffect, useRef, useState } from 'react'
import { openDialogCount } from './dialog-stack'
import { useProjects } from '../state/projects'
import { useSettings } from '../state/settings'
import { useSchoolMode } from '../state/schoolMode'
import { dimSumLabel, type DimSumDish } from '../lib/dimsum/catalog'
import { rollDimSumForLaunch } from '../lib/dimsum/roll'
import { schoolModeAllowsOptionalFeatures } from '../lib/schoolModePolicy'

/** How long after the app looks settled we decide (and, separately, re-check right before
 *  revealing) whether to show the surprise. Long enough that the first-run tour, the mobile-
 *  launch card and an update/mandatory-update banner have had a chance to appear; short enough
 *  that it still reads as "at startup". */
const DECIDE_DELAY_MS = 3000
const VISIBLE_MS = 9000
const VISIBLE_MS_REDUCED_MOTION = 6000

function reducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The dim-sum surprise: a 10%-per-launch chance of a small, non-blocking, auto-dismissing card
 * naming a random dish in both languages, with its bundled illustration. See docs/dim-sum.md.
 *
 * Cannot be opted out of by design (no setting), but it MUST NOT appear:
 *   - during a genuine first run (no project has ever been created — the welcome screen owns
 *     that moment),
 *   - while any modal dialog is open (an error dialog, a confirm, onboarding, …),
 *   - while School mode is on (that mode makes this capability behave as if not installed).
 * All three are re-checked at the moment of REVEAL, not only at the moment of deciding, so a
 * dialog that opens during the settle delay still suppresses it.
 */
export function DimSumSurprise() {
  const hydrated = useSettings((s) => s.hydrated)
  const hasProjects = useProjects((s) => s.projects.some((p) => !p.closed))
  const schoolModeEnabled = useSchoolMode((s) => s.enabled)
  const schoolModeHydrated = useSchoolMode((s) => s.hydrated)
  const schoolModeAllowsDimSum = schoolModeAllowsOptionalFeatures({
    enabled: schoolModeEnabled,
    hydrated: schoolModeHydrated
  })
  const [dish, setDish] = useState<DimSumDish | null>(null)
  const [visible, setVisible] = useState(false)
  const decidedRef = useRef(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Latest gate values, read from a ref at reveal time so the settle-delay timeout doesn't close
  // over stale booleans captured when the effect first ran.
  const gatesRef = useRef({ hasProjects, schoolModeAllowsDimSum })
  gatesRef.current = { hasProjects, schoolModeAllowsDimSum }

  useEffect(() => {
    if (decidedRef.current || !hydrated || !schoolModeHydrated) return
    // A confirmed ON record consumes this launch's opportunity without ever rolling. Turning the
    // mode off later must not replay a surprise that was suppressed while focus mode was active.
    if (schoolModeEnabled) {
      decidedRef.current = true
      return
    }
    const t = setTimeout(() => {
      if (decidedRef.current) return
      decidedRef.current = true
      const { hasProjects: hp, schoolModeAllowsDimSum: allowed } = gatesRef.current
      if (!hp || !allowed || openDialogCount() > 0) return
      const picked = rollDimSumForLaunch()
      if (!picked) return
      setDish(picked)
      setVisible(true)
      const dismissMs = reducedMotion() ? VISIBLE_MS_REDUCED_MOTION : VISIBLE_MS
      hideTimerRef.current = setTimeout(() => setVisible(false), dismissMs)
    }, DECIDE_DELAY_MS)
    return () => clearTimeout(t)
  }, [hydrated, schoolModeEnabled, schoolModeHydrated])

  useEffect(() => {
    if (schoolModeAllowsDimSum) return
    // Render also gates on this value below, so the toast disappears in the same React commit.
    // Clearing state/timers prevents its dismiss callback from lingering after the capability has
    // become unavailable.
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    setVisible(false)
  }, [schoolModeAllowsDimSum])

  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    },
    []
  )

  if (!schoolModeAllowsDimSum || !dish || !visible) return null

  return (
    <div className="dimsum-toast" role="status" aria-live="polite">
      <img className="dimsum-toast__image" src={dish.image} alt={dimSumLabel(dish)} width={40} height={40} />
      <div className="dimsum-toast__body">
        <div className="dimsum-toast__eyebrow">A little dim sum surprise</div>
        <div className="dimsum-toast__name">{dimSumLabel(dish)}</div>
      </div>
      <button
        type="button"
        className="dimsum-toast__close"
        aria-label="Dismiss"
        onClick={() => {
          if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
          setVisible(false)
        }}
      >
        ×
      </button>
    </div>
  )
}
