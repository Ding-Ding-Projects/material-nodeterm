import { useEffect, useState } from 'react'

import { useKidsMode } from '@renderer/state/kidsMode'
import { useKidsActivity } from '@renderer/state/kidsActivity'
import { KidsHome, type KidsTileKind } from './KidsHome'
import { KidsGate } from './KidsGate'
import { KidsParent } from './KidsParent'
import { KidsStickers } from './KidsStickers'
import { KidsActivityCanvas } from './KidsActivityCanvas'

type Screen = 'home' | 'gate' | 'timesUp' | 'parent' | 'stickers' | 'activity'

/**
 * Routes the four (well, six — the extra two are internal) Kids-mode screens. Only mounted while
 * `useKidsMode().enabled` is true (see App.tsx) — this component owns everything a kid sees once
 * that is the case.
 *
 * `screen` starts at `'gate'` when "Lock kids mode on launch" is on, and at `'home'` otherwise —
 * decided once, from the store's value at mount, which is exactly what "on launch" means. It is
 * NOT re-read reactively afterward: flipping the switch mid-session must not yank the current
 * screen out from under a kid who is, say, mid-conversation with Beep.
 */
export function KidsShell(): React.JSX.Element {
  const name = useKidsMode((s) => s.name)
  const credentialState = useKidsMode((s) => s.credentialState)
  const refreshCredentialState = useKidsMode((s) => s.refreshCredentialState)
  const tickMinute = useKidsActivity((s) => s.tickMinute)

  const [screen, setScreen] = useState<Screen>(() => {
    const s = useKidsActivity.getState()
    return s.overDailyLimit() ? 'timesUp' : s.lockOnLaunch ? 'gate' : 'home'
  })
  const [activity, setActivity] = useState<KidsTileKind | null>(null)
  const [verifiedPin, setVerifiedPin] = useState('')

  // A credential can be changed by another app while this shell is already mounted. Refresh before
  // routing into the gate so a stale absent/present decision never decides which controls appear.
  useEffect(() => {
    void refreshCredentialState()
  }, [refreshCredentialState])

  /** Every "go back to the kid-facing side" action routes through here, so a daily limit that
   *  fired while a grown-up was on the parent/gate screen is honoured the instant they try to
   *  hand the app back, instead of granting one free minute before the next tick catches it. */
  const goKidFacing = () => setScreen(useKidsActivity.getState().overDailyLimit() ? 'timesUp' : 'home')

  // The minute ticker — and the daily-limit enforcement it feeds — runs only while a kid-facing
  // screen is actually showing. The gate/parent/timesUp screens are grown-up-facing waits, not
  // time a kid is spending in the app, so they do not tick.
  useEffect(() => {
    const kidFacing = screen === 'home' || screen === 'activity' || screen === 'stickers'
    if (!kidFacing) return
    const id = window.setInterval(() => {
      tickMinute()
      if (useKidsActivity.getState().overDailyLimit()) {
        setActivity(null)
        setScreen('timesUp')
      }
    }, 60_000)
    return () => window.clearInterval(id)
  }, [screen, tickMinute])

  if (credentialState === 'loading') {
    return <div className="md3-kids-shell md3-kids-screen" role="status">Checking the shared PIN state…</div>
  }

  return (
    <div className="md3-kids-shell">
      {screen === 'home' ? (
        <KidsHome
          modeName={name}
          onOpenGate={() => setScreen('gate')}
          onOpenActivity={(kind) => {
            setActivity(kind)
            setScreen('activity')
          }}
          onOpenStickers={() => setScreen('stickers')}
        />
      ) : null}

      {screen === 'gate' || screen === 'timesUp' ? (
        <KidsGate
          modeName={name}
          variant={screen === 'timesUp' ? 'timesUp' : 'casual'}
          onVerified={(pin) => {
            setVerifiedPin(pin)
            setScreen('parent')
          }}
          onBackToKids={goKidFacing}
        />
      ) : null}

      {screen === 'parent' ? (
        <KidsParent
          modeName={name}
          verifiedPin={verifiedPin}
          onBackToKids={() => {
            setVerifiedPin('')
            goKidFacing()
          }}
        />
      ) : null}

      {screen === 'stickers' ? <KidsStickers onBack={goKidFacing} /> : null}

      <KidsActivityCanvas
        active={screen === 'activity' ? activity : null}
        onBack={() => {
          setActivity(null)
          goKidFacing()
        }}
      />
    </div>
  )
}
