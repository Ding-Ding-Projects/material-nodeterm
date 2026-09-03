import { useEffect, useState } from 'react'

import { useKidsMode } from '@renderer/state/kidsMode'
import { useKidsActivity } from '@renderer/state/kidsActivity'
import { useSettings } from '@renderer/state/settings'
import { setKidsAllowedPermissionMode, useActivePermissionMode } from '@renderer/state/permissionMode'
import { IconBackArrow, IconClock, IconCode, IconHourglass, IconSparkle } from './icons'
import { Md3Switch } from './Md3Switch'
import { narrateKidsScreen } from './narration'
import { Button } from '@renderer/ui/md3'
import { useVocabularyMapper, useVocabularyTemplate } from '@renderer/lib/personalVocabulary/useVocabularyText'

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
  const vocab = useVocabularyMapper()
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

  const terminalHint = useVocabularyTemplate('Turns the "Type things" tile on or off on the {name} home screen.', { name: modeName })
  const permissionHint = useVocabularyTemplate(
    'Off makes Beep ask before every single step. On lets Beep propose a whole plan at once. This uses the same permission-mode setting as Settings → Agents, so it applies to every agent on this machine while {name} is on.',
    { name: modeName }
  )
  const dailyLimitOnHint = useVocabularyTemplate('On — ends the session at {minutes} minutes and returns to the PIN screen.', {
    minutes: String(dailyLimitMinutes ?? 0)
  })
  const lockLabel = useVocabularyTemplate('Lock {name} on launch', { name: modeName })
  const lockHint = useVocabularyTemplate('On — the app opens straight to the PIN screen; a grown-up unlocks it before {name} home shows. Off — {name} home opens right away, same as now.', {
    name: modeName
  })

  useEffect(() => {
    narrateKidsScreen(vocab('The grown-up screen. Time, activity, and what Beep is allowed to do.'))
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
    { label: vocab('Time today'), value: `${minutesToday} min`, icon: <IconClock /> },
    { label: vocab('Daily limit'), value: dailyLimitMinutes != null ? `${dailyLimitMinutes} min` : vocab('Off'), icon: <IconHourglass /> },
    { label: vocab('Stickers earned'), value: String(stickers), icon: <IconSparkle /> },
    { label: vocab('Sessions today'), value: String(sessionsToday), icon: <IconClock /> }
  ]

  return (
    <div className="md3-kids-screen md3-kids-parent" data-screen-label={vocab('Parent screen')}>
      <div className="md3-kids-parent__bar">
        <div>
          <div className="md3-kids-parent__title">{vocab('Grown-up screen')}</div>
          <div className="md3-kids-parent__subtitle">{vocab('Time, activity and what Beep is allowed to do.')}</div>
        </div>
        <div className="md3-kids-home__spacer" />
        <Button variant="outlined" vocabularyMode="factual" className="md3-kids-outlined-btn" onClick={onBackToKids}>
          <IconBackArrow size={16} />
          {vocab('Back to kids')}
        </Button>
        <Button variant="filled" vocabularyMode="factual" className="md3-kids-filled-btn" onClick={exitToDeveloperMode} disabled={exiting}>
          <IconCode />
          {exiting ? vocab('Exiting…') : vocab('Exit to developer mode')}
        </Button>
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
          <div className="md3-kids-parent__panel-title">{vocab("Today's activity")}</div>
          {todayEntries.length === 0 ? (
            <div className="md3-kids-parent__empty">{vocab('Nothing yet today.')}</div>
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
          <div className="md3-kids-parent__panel-title">{vocab('Permissions')}</div>

          <div className="md3-kids-perm-row">
            <div className="md3-kids-perm-row__text">
              <div className="md3-kids-perm-row__label">{vocab('Allow the real terminal')}</div>
              <div className="md3-kids-perm-row__hint">{terminalHint}</div>
            </div>
            <Md3Switch
              checked={allowRealTerminal}
              onChange={setAllowRealTerminal}
              ariaLabel={vocab('Allow the real terminal')}
            />
          </div>

          <div className="md3-kids-perm-row">
            <div className="md3-kids-perm-row__text">
              <div className="md3-kids-perm-row__label">{vocab('Allow Beep to answer freely')}</div>
              <div className="md3-kids-perm-row__hint">
                {permissionHint}
              </div>
            </div>
            <Md3Switch
              checked={permissionMode === 'plan'}
              onChange={setKidsAllowedPermissionMode}
              ariaLabel={vocab('Allow Beep to answer freely')}
            />
          </div>

          <div className="md3-kids-perm-row">
            <div className="md3-kids-perm-row__text">
              <div className="md3-kids-perm-row__label">{vocab('Read every screen aloud')}</div>
              <div className="md3-kids-perm-row__hint">
                {vocab("The narrator speaks each screen's label on entry. This is the same narrator Settings → Speech controls app-wide.")}
              </div>
            </div>
            <Md3Switch
              checked={narratorEnabled}
              onChange={(v) => updateSettings({ narratorEnabled: v })}
              ariaLabel={vocab('Read every screen aloud')}
            />
          </div>

          <div className="md3-kids-perm-row">
            <div className="md3-kids-perm-row__text">
              <div className="md3-kids-perm-row__label">{vocab('Daily time limit')}</div>
              <div className="md3-kids-perm-row__hint">
                {dailyLimitMinutes != null
                  ? dailyLimitOnHint
                  : vocab('Off — no limit.')}
              </div>
            </div>
            <Md3Switch
              checked={dailyLimitMinutes != null}
              onChange={setDailyLimitEnabled}
              ariaLabel={vocab('Daily time limit')}
            />
          </div>

          <div className="md3-kids-perm-row">
            <div className="md3-kids-perm-row__text">
              <div className="md3-kids-perm-row__label">{lockLabel}</div>
              <div className="md3-kids-perm-row__hint">
                {lockHint}
              </div>
            </div>
            <Md3Switch checked={lockOnLaunch} onChange={setLockOnLaunch} ariaLabel={vocab('Lock kids mode on launch')} />
          </div>
        </div>
      </div>
    </div>
  )
}
