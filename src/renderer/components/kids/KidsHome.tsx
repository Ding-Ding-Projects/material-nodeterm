import { useEffect, useMemo } from 'react'

import { IconLock, IconTerminal } from '@renderer/components/icons'
import { KIDS_DISCLOSURE } from '@shared/kids-mode-policy'
import { useKidsActivity } from '@renderer/state/kidsActivity'
import { IconBeep, IconBook, IconBrush, IconSparkle, IconSpeaker, IconSun } from './icons'
import { narrateKidsScreen } from './narration'

export type KidsTileKind = 'beep' | 'terminal' | 'draw'

interface TileSpec {
  kind: KidsTileKind | 'stickers' | 'story' | 'sounds'
  title: string
  sub: string
  icon: React.JSX.Element
  variant: 'primary' | 'success' | 'warning' | 'tertiary' | 'secondary' | 'neutral'
  disabled?: boolean
  disabledReason?: string
}

function greeting(): { icon: React.JSX.Element; label: string } {
  const h = new Date().getHours()
  if (h < 12) return { icon: <IconSun />, label: 'Morning' }
  if (h < 18) return { icon: <IconSun />, label: 'Afternoon' }
  return { icon: <IconSun />, label: 'Evening' }
}

/**
 * Kids home — Beep's avatar, the six activity tiles, and the status strip.
 *
 * Only four tiles are real: Talk to Beep, Type things and Draw each open the shared kid canvas
 * with a genuine agent/terminal/sticky node; My stickers opens the real counter. "Story time" and
 * "Sounds" are the two design tiles this app has nothing to back them with (no read-aloud story
 * library, no sound-matching game exist anywhere in the codebase) — rather than ship a tile that
 * LOOKS like a button and does nothing, they render as an explicit, disabled "more coming" plate.
 * See docs/kids-mode.md for the deferred-feature record this satisfies.
 */
export function KidsHome({
  modeName,
  onOpenGate,
  onOpenActivity,
  onOpenStickers
}: {
  modeName: string
  onOpenGate: () => void
  onOpenActivity: (kind: KidsTileKind) => void
  onOpenStickers: () => void
}): React.JSX.Element {
  const stickers = useKidsActivity((s) => s.stickers)
  const allowRealTerminal = useKidsActivity((s) => s.allowRealTerminal)
  const dailyLimitMinutes = useKidsActivity((s) => s.dailyLimitMinutes)
  const minutesToday = useKidsActivity((s) => s.minutesToday())

  useEffect(() => {
    narrateKidsScreen(`Hi! I'm Beep. What do you want to do?`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const g = greeting()
  const minutesLeft = dailyLimitMinutes != null ? Math.max(0, dailyLimitMinutes - minutesToday) : null

  const tiles: TileSpec[] = useMemo(
    () => [
      { kind: 'beep', title: 'Talk to Beep', sub: 'Ask me anything', icon: <IconBeep size={40} />, variant: 'primary' },
      {
        kind: 'terminal',
        title: 'Type things',
        sub: allowRealTerminal ? 'A real computer' : 'Turned off for now',
        icon: <IconTerminal />,
        variant: 'success',
        disabled: !allowRealTerminal,
        disabledReason: 'A grown-up turned this off on the grown-up screen.'
      },
      { kind: 'draw', title: 'Draw', sub: 'Make something', icon: <IconBrush size={40} />, variant: 'warning' },
      {
        kind: 'story',
        title: 'Story time',
        sub: 'More coming soon',
        icon: <IconBook size={40} />,
        variant: 'tertiary',
        disabled: true,
        disabledReason: 'Story time is not built yet — this tile is a placeholder, not a bug.'
      },
      {
        kind: 'sounds',
        title: 'Sounds',
        sub: 'More coming soon',
        icon: <IconSpeaker size={40} />,
        variant: 'secondary',
        disabled: true,
        disabledReason: 'Sounds is not built yet — this tile is a placeholder, not a bug.'
      },
      { kind: 'stickers', title: 'My stickers', sub: `You have ${stickers}`, icon: <IconSparkle size={40} />, variant: 'neutral' }
    ],
    [allowRealTerminal, stickers]
  )

  return (
    <div className="md3-kids-screen md3-kids-home" data-screen-label="Kids home">
      <div className="md3-kids-home__strip">
        <span className="md3-kids-chip">
          {g.icon}
          {g.label}
        </span>
        {minutesLeft != null ? (
          <span className="md3-kids-chip">
            <IconSparkle size={18} />
            {minutesLeft} min left today
          </span>
        ) : null}
        <span className="md3-kids-chip">
          <IconSparkle size={18} />
          {stickers} sticker{stickers === 1 ? '' : 's'}
        </span>
        <div className="md3-kids-home__spacer" />
        <button
          type="button"
          className="md3-kids-iconbtn"
          onClick={onOpenGate}
          aria-label="Grown-up gate"
          title="Grown-up gate"
        >
          <IconLock />
        </button>
      </div>

      <div className="md3-kids-home__avatar">
        <div className="md3-kids-home__avatar-bubble">
          <IconBeep size={60} />
        </div>
        <div className="md3-kids-home__hi">Hi! I&apos;m Beep.</div>
        <div className="md3-kids-home__ask">What do you want to do?</div>
      </div>

      <div className="md3-kids-tiles">
        {tiles.map((t) => (
          <button
            key={t.kind}
            type="button"
            className={`md3-kids-tile md3-kids-tile--${t.variant}${t.disabled ? ' md3-kids-tile--disabled' : ''}`}
            disabled={t.disabled}
            title={t.disabled ? t.disabledReason : undefined}
            aria-disabled={t.disabled || undefined}
            onClick={() => {
              if (t.disabled) return
              if (t.kind === 'stickers') {
                onOpenStickers()
                return
              }
              if (t.kind === 'beep' || t.kind === 'terminal' || t.kind === 'draw') onOpenActivity(t.kind)
            }}
          >
            <span className="md3-kids-tile__icon">{t.icon}</span>
            <span className="md3-kids-tile__title">{t.title}</span>
            <span className="md3-kids-tile__sub">{t.sub}</span>
            {t.disabled && !allowRealTerminal && t.kind === 'terminal' ? (
              <span className="md3-kids-tile__badge">Off</span>
            ) : t.disabled ? (
              <span className="md3-kids-tile__badge">Soon</span>
            ) : null}
          </button>
        ))}
      </div>

      <p className="md3-kids-disclosure">{KIDS_DISCLOSURE}</p>
      <p className="md3-kids-home__hint">{modeName}</p>
    </div>
  )
}
