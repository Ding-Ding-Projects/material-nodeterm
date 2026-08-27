import { useState } from 'react'
import { Button } from '@renderer/ui/Button'
import { ConfirmDialog } from '../ConfirmDialog'
import { useSettings } from '../../state/settings'
import { isPristine, resetPatch } from '@renderer/lib/settingsReset'
import type { Settings } from '@shared/types'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'

/**
 * "Reset to defaults" for the settings ONE section owns.
 *
 * Disabled while everything is already at its default — which does two jobs: it keeps a
 * destructive control from firing for nothing, and it answers the question that brought the user
 * here ("have I actually changed anything?"), otherwise unanswerable without remembering what the
 * defaults were.
 */
export function SectionReset<K extends keyof Settings>({
  keys,
  label,
  what
}: {
  keys: readonly K[]
  /** Button text, e.g. "Reset terminal appearance". */
  label: string
  /** Completes the confirm sentence: "Reset <what> to their defaults?" */
  what: string
}): React.JSX.Element {
  // `base`, not the effective `settings` — "is this section already at its default?" is a
  // question about the user's SAVED preference, not about whatever a scheduled override happens
  // to be showing right now (see state/settings.ts's doc on `base` vs `settings`).
  const settings = useSettings((s) => s.base)
  const update = useSettings((s) => s.update)
  const [asking, setAsking] = useState(false)
  const pristine = isPristine(keys, settings)
  const vocab = useVocabularyMapper()

  return (
    <>
      <div className="md3-settings-row">
        <p className="md3-settings-hint">
          {pristine
            ? `${vocab(what[0].toUpperCase() + what.slice(1))} are at their defaults.`
            : `${vocab('Put')} ${what} ${vocab('back the way they shipped. Nothing else is touched.')}`}
        </p>
        <Button disabled={pristine} onClick={() => setAsking(true)}>
          {vocab(label)}
        </Button>
      </div>
      {asking && (
        <ConfirmDialog
          message={`${vocab('Reset')} ${what} ${vocab('to their defaults?')}`}
          confirmLabel="Reset"
          onConfirm={() => {
            update(resetPatch(keys))
            setAsking(false)
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  )
}
