import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { MaterialSymbol } from './MaterialSymbol'
import { Button } from '@renderer/ui/md3'

/** Non-blocking strip shown when the active project's .nodeterm file changed on disk
 *  while there are unsaved local edits. Reload = take the disk version; Keep mine =
 *  overwrite disk with the in-memory canvas on the next save.
 *
 *  It only ever covers the OVERLAPPING half of an outside change: nodes that arrived from another
 *  device (a session the phone registered) are adopted onto the canvas before this bar is raised,
 *  because nothing re-emits them and either button would otherwise be able to delete a running
 *  session. `addedCount` is how many did — the message says so, so the user is not asked to weigh
 *  a choice against something that is no longer at stake. */
export function ConflictBar({
  addedCount = 0,
  onReload,
  onKeepMine
}: {
  addedCount?: number
  onReload(): void
  onKeepMine(): void
}): JSX.Element {
  // Personal-vocabulary boundary: banner copy is prose the user reads, never a path or command.
  const vocab = useVocabularyMapper()
  return (
    <div className="conflict-bar md3-conflict-bar">
      <MaterialSymbol className="md3-conflict-bar__icon" name="warning" size={18} fill />
      <span>{vocab('Project file changed on disk (git pull or another machine).')}</span>
      <Button variant="outlined" size="small" vocabularyMode="factual" className="md3-conflict-bar__btn" onClick={onReload}>
        {vocab('Reload from disk')}
      </Button>
      <Button variant="filled" size="small" vocabularyMode="factual" className="md3-conflict-bar__btn md3-conflict-bar__btn--primary" onClick={onKeepMine}>
        {vocab('Keep my version')}
      </Button>
    </div>
  )
}
