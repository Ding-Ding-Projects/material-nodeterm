import { useEffect } from 'react'

import { useKidsActivity } from '@renderer/state/kidsActivity'
import { IconBackArrow, IconSparkle } from './icons'
import { narrateKidsScreen } from './narration'

/**
 * "My stickers" — the real counter the grown-up screen's stat card also reads, not a decoration.
 * A sticker is earned automatically (`KidsActivityCanvas`) for spending real time in an activity,
 * so this grid is always the truth about what has actually been done, never a hand-set number.
 */
export function KidsStickers({ onBack }: { onBack: () => void }): React.JSX.Element {
  const stickers = useKidsActivity((s) => s.stickers)

  useEffect(() => {
    narrateKidsScreen(`You have ${stickers} sticker${stickers === 1 ? '' : 's'}.`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="md3-kids-screen md3-kids-stickers" data-screen-label="My stickers">
      <div className="md3-kids-activity__bar">
        <button type="button" className="md3-kids-backbtn" onClick={onBack}>
          <IconBackArrow />
          Back to Beep
        </button>
        <div className="md3-kids-activity__title">My stickers</div>
      </div>
      <div className="md3-kids-stickers__count">
        <IconSparkle size={48} />
        <span>{stickers}</span>
      </div>
      <div className="md3-kids-stickers__hint">
        {stickers === 0
          ? 'Try an activity for a little while and a sticker shows up here.'
          : 'You earn one every time you spend a bit of real time on an activity.'}
      </div>
      <div className="md3-kids-stickers__grid" aria-hidden="true">
        {Array.from({ length: Math.max(stickers, 1) }).map((_, i) => (
          <span
            key={i}
            className={'md3-kids-stickers__item' + (i < stickers ? '' : ' md3-kids-stickers__item--empty')}
          >
            <IconSparkle size={26} />
          </span>
        ))}
      </div>
    </div>
  )
}
