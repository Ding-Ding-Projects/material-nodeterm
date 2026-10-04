import { useI18n } from '@renderer/lib/i18n'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { Button } from '@renderer/ui/md3'
import { MaterialSymbol } from './MaterialSymbol'
import { mapTemplate } from './UpdateCard'
import { runPendingUpdate, usePendingUpdate, type PendingUpdate } from '../state/pendingUpdate'

/** The tooltip names what one click will do, with the updater's version inserted untouched. */
function pendingTitle(
  pending: PendingUpdate,
  t: ReturnType<typeof useI18n>['t'],
  vocab: (text: string) => string
): string {
  if (pending.kind === 'required') {
    return vocab(t('update.pending.required', 'This version is no longer supported, update to continue').primary)
  }
  const version = pending.version ?? ''
  return pending.kind === 'downloaded'
    ? mapTemplate(t('update.pending.downloaded', 'nodeterm v{version} is ready, restart to update').primary, { version }, vocab)
    : mapTemplate(t('update.pending.manual', 'nodeterm v{version} is available, download it to update').primary, { version }, vocab)
}

/**
 * The persistent title-bar "Update" button. It appears only while an update is owed (staged,
 * download-only or required) and has no dismiss: the update card's own dismiss hides the card,
 * never this, so a hidden card still leaves the install path one click away. The Server Edition
 * stubs the updater, so nothing is ever owed there and the button never renders.
 */
export function PendingUpdateButton(): JSX.Element | null {
  const pending = usePendingUpdate((s) => s.pending)
  const { t, ts } = useI18n()
  const vocab = useVocabularyMapper()
  if (!pending) return null
  const title = pendingTitle(pending, t, vocab)
  return (
    <Button
      variant="filled"
      size="small"
      vocabularyMode="factual"
      className="md3-app-bar__update"
      data-pending-update={pending.kind}
      title={title}
      aria-label={title}
      leadingIcon={<MaterialSymbol name="system_update" size={18} />}
      onClick={() => runPendingUpdate(pending)}
    >
      {vocab(ts('update.pending.button', 'Update'))}
    </Button>
  )
}
