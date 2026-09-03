import { useEffect, useMemo } from 'react'

import { IconLock, IconTerminal } from '@renderer/components/icons'
import { KIDS_DISCLOSURE } from '@shared/kids-mode-policy'
import { useKidsActivity } from '@renderer/state/kidsActivity'
import { IconBeep, IconBook, IconBrush, IconSparkle, IconSpeaker, IconSun } from './icons'
import { narrateKidsScreen } from './narration'
import { Button, IconButton } from '@renderer/ui/md3'
import { useVocabularyMapper, useVocabularyTemplate } from '@renderer/lib/personalVocabulary/useVocabularyText'

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
  const vocab = useVocabularyMapper()
  const stickers = useKidsActivity((s) => s.stickers)
  const allowRealTerminal = useKidsActivity((s) => s.allowRealTerminal)
  const dailyLimitMinutes = useKidsActivity((s) => s.dailyLimitMinutes)
  const minutesToday = useKidsActivity((s) => s.minutesToday())

  useEffect(() => {
    narrateKidsScreen(vocab(`Hi! I'm Beep. What do you want to do?`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const g = greeting()
  const greetingLabel = vocab(g.label)
  const minutesLeft = dailyLimitMinutes != null ? Math.max(0, dailyLimitMinutes - minutesToday) : null
  const minutesLeftLabel = useVocabularyTemplate('{minutes} min left today', {
    minutes: String(minutesLeft ?? 0)
  })
  const stickerCountLabel = useVocabularyTemplate('You have {count} stickers', {
    count: String(stickers)
  })

  const tiles: TileSpec[] = useMemo(
    () => [
      { kind: 'beep', title: vocab('Talk to Beep'), sub: vocab('Ask me anything'), icon: <IconBeep size={40} />, variant: 'primary' },
      {
        kind: 'terminal',
        title: vocab('Type things'),
        sub: allowRealTerminal ? vocab('A real computer') : vocab('Turned off for now'),
        icon: <IconTerminal />,
        variant: 'success',
        disabled: !allowRealTerminal,
        disabledReason: vocab('A grown-up turned this off on the grown-up screen.')
      },
      { kind: 'draw', title: vocab('Draw'), sub: vocab('Make something'), icon: <IconBrush size={40} />, variant: 'warning' },
      {
        kind: 'story',
        title: vocab('Story time'),
        sub: vocab('More coming soon'),
        icon: <IconBook size={40} />,
        variant: 'tertiary',
        disabled: true,
        disabledReason: vocab('Story time is not built yet — this tile is a placeholder, not a bug.')
      },
      {
        kind: 'sounds',
        title: vocab('Sounds'),
        sub: vocab('More coming soon'),
        icon: <IconSpeaker size={40} />,
        variant: 'secondary',
        disabled: true,
        disabledReason: vocab('Sounds is not built yet — this tile is a placeholder, not a bug.')
      },
      { kind: 'stickers', title: vocab('My stickers'), sub: stickerCountLabel ?? `You have ${stickers} stickers`, icon: <IconSparkle size={40} />, variant: 'neutral' }
    ],
    [allowRealTerminal, stickerCountLabel, stickers, vocab]
  )

  return (
    <div className="md3-kids-screen md3-kids-home" data-screen-label={vocab('Kids home')}>
      <div className="md3-kids-home__strip">
        <span className="md3-kids-chip">
          {g.icon}
          {greetingLabel}
        </span>
        {minutesLeft != null ? (
          <span className="md3-kids-chip">
            <IconSparkle size={18} />
            {minutesLeftLabel}
          </span>
        ) : null}
        <span className="md3-kids-chip">
          <IconSparkle size={18} />
          {stickers} {vocab(stickers === 1 ? 'sticker' : 'stickers')}
        </span>
        <div className="md3-kids-home__spacer" />
        <IconButton size="standard" vocabularyMode="factual"
          type="button"
          className="md3-kids-iconbtn"
          onClick={onOpenGate}
          aria-label={vocab('Grown-up gate')}
          title={vocab('Grown-up gate')}
        >
          <IconLock />
        </IconButton>
      </div>

      <div className="md3-kids-home__avatar">
        <div className="md3-kids-home__avatar-bubble">
          <IconBeep size={60} />
        </div>
        <div className="md3-kids-home__hi">{vocab("Hi! I'm Beep.")}</div>
        <div className="md3-kids-home__ask">{vocab('What do you want to do?')}</div>
      </div>

      <div className="md3-kids-tiles">
        {tiles.map((t) => (
          <Button variant="tonal" vocabularyMode="factual"
            key={t.kind}
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
              <span className="md3-kids-tile__badge">{vocab('Off')}</span>
            ) : t.disabled ? (
              <span className="md3-kids-tile__badge">{vocab('Soon')}</span>
            ) : null}
          </Button>
        ))}
      </div>

      <p className="md3-kids-disclosure">{vocab(KIDS_DISCLOSURE)}</p>
      <p className="md3-kids-home__hint">{modeName}</p>
    </div>
  )
}
