// The honest limits every lock surface repeats, and the real recovery route.
//
// These are enforced locks: the app genuinely refuses the thing until the credential is supplied,
// and the credential itself is hashed and kept in the operating system's credential vault. What
// they are NOT is encryption of the data behind them - a locked terminal's scrollback and a locked
// project's canvas are ordinary files on this disk, and anyone with the machine can read them
// without ever meeting this prompt.
//
// Saying so is not a disclaimer to be trimmed. A lock that implies more protection than it has is
// worse than no lock, because somebody puts something behind it that needed the stronger thing.
//
// Shown in the lock wizard, the unlock prompt, and Support Tickets' resolution - always with the
// ACTUAL folder path, never a vague "app data" gesture. See docs/toy-locks.md.
import { useEffect, useState } from 'react'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'
import { Button } from '@renderer/ui/md3'

export function RecoveryNotice({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const [dir, setDir] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.nodeTerminal.userDataDir().then((d) => {
      if (!cancelled) setDir(d)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const copy = (): void => {
    if (dir) window.nodeTerminal.clipboard.writeText(dir)
  }

  return (
    <div className="toylock-recovery">
      <p className="toylock-recovery__disclaimer">
        {vocab("This lock is enforced by nodeterm, and the credential is stored in this computer's own credential vault. It is not encryption: what is behind it stays readable on disk to anyone who has this machine.")}
      </p>
      {!compact && (
        <p className="toylock-recovery__how">
          {vocab("Locked out? Delete nodeterm's local application-data folder and every lock resets.")}
        </p>
      )}
      <div className="toylock-recovery__path-row">
        <code className="toylock-recovery__path">{dir ?? '…'}</code>
        <Button variant="outlined" size="small" vocabularyMode="factual" className="toylock-btn toylock-btn--sm" onClick={copy} disabled={!dir}>
          {vocab('Copy path')}
        </Button>
      </div>
    </div>
  )
}
