import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'

/** Non-blocking strip shown when the active project's .nodeterm file changed on disk
 *  while there are unsaved local edits. Reload = take the disk version; Keep mine =
 *  overwrite disk with the in-memory canvas on the next save. */
export function ConflictBar({
  onReload,
  onKeepMine
}: {
  onReload(): void
  onKeepMine(): void
}): JSX.Element {
  // Personal-vocabulary boundary: banner copy is prose the user reads, never a path or command.
  const vocab = useVocabularyMapper()
  return (
    <div className="conflict-bar">
      <span>{vocab('Project file changed on disk (git pull or another machine).')}</span>
      <button onClick={onReload}>{vocab('Reload from disk')}</button>
      <button onClick={onKeepMine}>{vocab('Keep my version')}</button>
    </div>
  )
}
