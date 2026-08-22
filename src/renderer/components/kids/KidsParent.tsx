import { useEffect, useState } from 'react'

import { useKidsMode } from '@renderer/state/kidsMode'
import { useKidsActivity } from '@renderer/state/kidsActivity'
import { useSettings } from '@renderer/state/settings'
import { setKidsAllowedPermissionMode, useActivePermissionMode } from '@renderer/state/permissionMode'
import { IconBackArrow, IconClock, IconCode, IconHourglass, IconSparkle } from './icons'
import { Md3Switch } from './Md3Switch'
import { narrateKidsScreen } from './narration'

/**
 * The grown-up screen — stats, today's activity, and the switches that actually change what the
 * kid-facing side of the app can do. Every switch here is wired to a real setting; see
 * docs/kids-mode.md §"Grown-up screen switches" for exactly what each one touches and any scoping
 * caveats (the two that reach outside this store are called out there and in their own hints
 * below, rather than left to look narrower than they are).
 */
export function KidsParent({
  modeName,
  verifiedPin,
  onBackToKids
}: {
  modeName: string
  verifiedPin: string
  onBackToKids: () => void
}): React.JSX.Element {
  const stickers = useKidsActivity((s) => s.stickers)
  const minutesToday = useKidsActivity((s) => s.minutesToday())
  const dailyLimitMinutes = useKidsActivity((s) => s.dailyLimitMinutes)
  const sessionsToday = useKidsActivity((s) => s.sessionsToday())
  const todayEntries = useKidsActivity((s) => s.todayEntries())
  const allowRealTerminal = useKidsActivity((s) => s.allowRealTerminal)
  const lockOnLaunch = useKidsActivity((s) => s.lockOnLaunch)
  const setAllowRealTerminal = useKidsActivity((s) => s.setAllowRealTerminal)
  const setDailyLimitEnabled = useKidsActivity((s) => s.setDailyLimitEnabled)
  const setLockOnLaunch = useKidsActivity((s) => s.setLockOnLaunch)

  const narratorEnabled = useSettings((s) => s.settings.narratorEnabled)
  // Reads through the same Kids-gated funnel every agent launch does (see
  // permissionMode.funnel.test.ts) rather than the raw setting, so the switch always reflects
  // what Beep will actually start in — not just what the app-wide default happens to say.
  const permissionMode = useActivePermissionMode('claude')
  const updateSettings = useSettings((s) => s.update)

  const disable = useKidsMode((s) => s.disable)
  const [exiting, setExiting] = useState(false)
  const [exitError, setExitError] = useState<string | null>(null)

  useEffect(() => {
    narrateKidsScreen('The grown-up screen. Time, activity, and what Beep is allowed to do.')
  }, [])

  const exitToDeveloperMode = async () => {
    setExiting(true)
    setExitError(null)
    const result = await disable(verifiedPin)
    setExiting(false)
    if (!result.ok) setExitError(result.error)
    // On success, App.tsx's own routing swaps this whole screen out the moment the shared
    // record's `enabled` flips to false — no local navigation needed.
  }

  const stats = [
    { label: 'Time today', value: `${minutesToday} min`, icon: <IconClock /> },
    { label: 'Daily limit', value: dailyLimitMinutes != null ? `${dailyLimitMinutes} min` : 'Off', icon: <IconHourglass /> },
    { label: 'Stickers earned', value: String(stickers), icon: <IconSparkle /> },
    { label: 'Sessions today', value: String(sessionsToday), icon: <IconClock /> }
  ]

  return (
    <div className="md3-kids-screen md3-kids-parent" data-screen-label="Parent screen">
      <div className="md3-kids-parent__bar">
        <div>
          <div className="md3-kids-parent__title">Grown-up screen</div>
          <div className="md3-kids-parent__subtitle">Time, activity and what Beep is allowed to do.</div>
        </div>
        <div className="md3-kids-home__spacer" />
        <button type="button" className="md3-kids-outlined-btn" onClick={onBackToKids}>
          <IconBackArrow size={16} />
          Back to kids
        </button>
        <button type="button" className="md3-kids-filled-btn" onClick={exitToDeveloperMode} disabled={exiting}>
          <IconCode />
          {exiting ? 'Exiting…' : 'Exit to developer mode'}
        </button>
      </div>

      {exitError ? <div className="md3-kids-gate__status" role="alert">{exitError}</div> : null}

      <div className="md3-kids-parent__stats">
        {stats.map((s) => (
          <div key={s.label} className="md3-kids-stat">
            <span className="md3-kids-stat__icon">{s.icon}</span>
            <div>
              <div className="md3-kids-stat__value">{s.value}</div>
              <div className="md3-kids-stat__label">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="md3-kids-parent__cols">
        <div className="md3-kids-parent__panel">
          <div className="md3-kids-parent__panel-title">Today&apos;s activity</div>
          {todayEntries.length === 0 ? (
            <div className="md3-kids-parent__empty">Nothing yet today.</div>
          ) : (
            todayEntries.map((a) => (
              <div key={a.id} className="md3-kids-activity-row">
                <span className="md3-kids-activity-row__badge">
                  {a.kind === 'beep' ? <IconSparkle size={18} /> : a.kind === 'sticker' ? <IconSparkle size={18} /> : <IconClock size={18} />}
                </span>
                <div className="md3-kids-activity-row__text">
                  <div className="md3-kids-activity-row__what">{a.what}</div>
                  <div className="md3-kids-activity-row__detail">{a.detail}</div>
                </div>
                <span className="md3-kids-activity-row__when">
                  {new Date(a.when).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="md3-kids-parent__panel">
          <div className="md3-kids-parent__panel-title">Permissions</div>

          <div className="md3-kids-perm-row">
            <div className="md3-kids-perm-row__text">
              <div className="md3-kids-perm-row__label">Allow the real terminal</div>
              <div className="md3-kids-perm-row__hint">Turns the &quot;Type things&quot; tile on or off on the {modeName} home screen.</div>
            </div>
            <Md3Switch
              checked={allowRealTerminal}
              onChange={setAllowRealTerminal}
              ariaLabel="Allow the real terminal"
            />
          </div>

          <div className="md3-kids-perm-row">
            <div className="md3-kids-perm-row__text">
              <div className="md3-kids-perm-row__label">Allow Beep to answer freely</div>
              <div className="md3-kids-perm-row__hint">
                Off makes Beep ask before every single step. On lets Beep propose a whole plan at once. This
                uses the same permission-mode setting as Settings → Agents, so it applies to every agent on
                this machine while {modeName} is on.
              </div>
            </div>
            <Md3Switch
              checked={permissionMode === 'plan'}
              onChange={setKidsAllowedPermissionMode}
              ariaLabel="Allow Beep to answer freely"
            />
          </div>

          <div className="md3-kids-perm-row">
            <div className="md3-kids-perm-row__text">
              <div className="md3-kids-perm-row__label">Read every screen aloud</div>
              <div className="md3-kids-perm-row__hint">
                The narrator speaks each screen&apos;s label on entry. This is the same narrator Settings →
                Speech controls app-wide.
              </div>
            </div>
            <Md3Switch
              checked={narratorEnabled}
              onChange={(v) => updateSettings({ narratorEnabled: v })}
              ariaLabel="Read every screen aloud"
            />
          </div>

          <div className="md3-kids-perm-row">
            <div className="md3-kids-perm-row__text">
              <div className="md3-kids-perm-row__label">Daily time limit</div>
              <div className="md3-kids-perm-row__hint">
                {dailyLimitMinutes != null
                  ? `On — ends the session at ${dailyLimitMinutes} minutes and returns to the PIN screen.`
                  : 'Off — no limit.'}
              </div>
            </div>
            <Md3Switch
              checked={dailyLimitMinutes != null}
              onChange={setDailyLimitEnabled}
              ariaLabel="Daily time limit"
            />
          </div>

          <div className="md3-kids-perm-row">
            <div className="md3-kids-perm-row__text">
              <div className="md3-kids-perm-row__label">Lock {modeName} on launch</div>
              <div className="md3-kids-perm-row__hint">
                On — the app opens straight to the PIN screen; a grown-up unlocks it before {modeName} home
                shows. Off — {modeName} home opens right away, same as now.
              </div>
            </div>
            <Md3Switch checked={lockOnLaunch} onChange={setLockOnLaunch} ariaLabel="Lock kids mode on launch" />
          </div>
        </div>
      </div>
    </div>
  )
}
