import { useEffect } from 'react'

import { useKidsActivity } from '@renderer/state/kidsActivity'
import { IconBackArrow, IconSparkle } from './icons'
import { narrateKidsScreen } from './narration'
import { Button } from '@renderer/ui/md3'
import { useVocabularyMapper, useVocabularyTemplate } from '@renderer/lib/personalVocabulary/useVocabularyText'

/**
 * "My stickers" — the real counter the grown-up screen's stat card also reads, not a decoration.
 * A sticker is earned automatically (`KidsActivityCanvas`) for spending real time in an activity,
 * so this grid is always the truth about what has actually been done, never a hand-set number.
 */
export function KidsStickers({ onBack }: { onBack: () => void }): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const stickers = useKidsActivity((s) => s.stickers)
  const stickerNarration = useVocabularyTemplate(
    stickers === 1 ? 'You have {count} sticker.' : 'You have {count} stickers.',
    { count: String(stickers) }
  )

  useEffect(() => {
    narrateKidsScreen(stickerNarration ?? `You have ${stickers} sticker${stickers === 1 ? '' : 's'}.`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="md3-kids-screen md3-kids-stickers" data-screen-label={vocab('My stickers')}>
      <div className="md3-kids-activity__bar">
        <Button variant="outlined" vocabularyMode="factual" className="md3-kids-backbtn" onClick={onBack}>
          <IconBackArrow />
          {vocab('Back to Beep')}
        </Button>
        <div className="md3-kids-activity__title">{vocab('My stickers')}</div>
      </div>
      <div className="md3-kids-stickers__count">
        <IconSparkle size={48} />
        <span>{stickers}</span>
      </div>
      <div className="md3-kids-stickers__hint">
        {stickers === 0
          ? vocab('Try an activity for a little while and a sticker shows up here.')
          : vocab('You earn one every time you spend a bit of real time on an activity.')}
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
