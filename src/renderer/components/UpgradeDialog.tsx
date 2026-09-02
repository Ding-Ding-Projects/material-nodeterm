import { createPortal } from 'react-dom'
import { useEntitlement } from '../state/entitlement'
import { useUpgradeGate } from '../state/upgradeGate'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { copy, fact, mapOwnedSentence } from '../lib/personalVocabulary/ownedCopy'
import { Button } from '@renderer/ui/md3'

/**
 * Pro upgrade prompt shown when a free user triggers a gated feature. Closes automatically
 * once an active entitlement arrives (entitlement onChange flips isPremium).
 */
export function UpgradeDialog() {
  const { open, feature, hide } = useUpgradeGate()
  const isPremium = useEntitlement((s) => s.isPremium)
  const upgrade = useEntitlement((s) => s.upgrade)
  const vocab = useVocabularyMapper()
  if (!open || isPremium) return null
  return createPortal(
    <div className="confirm-overlay" onClick={hide}>
      <div className="confirm" onClick={(e) => e.stopPropagation()}>
        <p className="confirm__msg">{mapOwnedSentence(vocab, [fact(feature), copy(' is a Pro feature')])}</p>
        <p className="confirm__msg">
          {vocab('Pro unlocks unlimited remote access from your phone (free plan: 5 connections/month),')}{' '}
          {vocab('3 team seats to share this Mac, and nodeterm mobile Pro. Complete your purchase in the')}{' '}
          {vocab('browser — Pro unlocks here automatically.')}
        </p>
        <div className="confirm__actions">
          <Button variant="outlined" size="small" vocabularyMode="factual" className="confirm__btn" onClick={hide} aria-label={vocab('Maybe later')}>
            {vocab('Maybe later')}
          </Button>
          <Button variant="filled" size="small" vocabularyMode="factual" className="confirm__btn primary" autoFocus onClick={() => void upgrade()} aria-label={mapOwnedSentence(vocab, [copy('Upgrade to Pro — '), fact('$10/mo')])}>
            {vocab('Upgrade to Pro')} — $10/mo
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
