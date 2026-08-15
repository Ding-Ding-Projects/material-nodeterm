// The one honest sentence every toy-lock surface repeats: this is not security, and the real
// "recovery" is deleting nodeterm's own local application-data folder. Shown in the lock wizard,
// the unlock prompt, and Support Tickets' resolution — always with the ACTUAL folder path, never
// a vague "app data" gesture. See docs/toy-locks.md.
import { useEffect, useState } from 'react'

export function RecoveryNotice({ compact = false }: { compact?: boolean }): React.JSX.Element {
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
        This is just for fun — a speed bump, not security, not encryption, and no protection from
        anyone who actually has this computer.
      </p>
      {!compact && (
        <p className="toylock-recovery__how">
          Locked out? Delete nodeterm's local application-data folder and every lock resets.
        </p>
      )}
      <div className="toylock-recovery__path-row">
        <code className="toylock-recovery__path">{dir ?? '…'}</code>
        <button className="toylock-btn toylock-btn--sm" onClick={copy} disabled={!dir}>
          Copy path
        </button>
      </div>
    </div>
  )
}
