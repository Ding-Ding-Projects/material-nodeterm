import { useState } from 'react'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { Dialog } from '../ui/md3/Dialog'
import { ListRow } from '../ui/md3/ListRow'
import { TextField } from '../ui/md3/TextField'

/**
 * VS Code-style "Publish to GitHub" picker: an editable repository name plus a
 * choice between a private and a public repository — all in-app, no terminal.
 * The chosen name + visibility are handed back to the caller, which performs
 * the actual `gh repo create` (in-process when gh is authed, otherwise via a
 * chained terminal login).
 */
export function PublishDialog({
  defaultName,
  owner,
  onCancel,
  onPublish
}: {
  defaultName: string
  owner?: string
  onCancel: () => void
  onPublish: (name: string, isPrivate: boolean) => void
}) {
  const vocab = useVocabularyMapper()
  const [name, setName] = useState(defaultName)
  const trimmed = name.trim()
  const hint = (vis: string) => `${owner ? `${owner}/` : ''}${trimmed || 'repo'} · ${vis}`

  return (
    <Dialog open onClose={onCancel} title={vocab('Publish to GitHub')} className="pubdlg">
        <TextField
          className="pubdlg__name"
          label="Repository name"
          autoFocus
          spellCheck={false}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
            if (e.key === 'Enter' && trimmed) onPublish(trimmed, true)
          }}
        />
        <ListRow
          className="pubdlg__opt"
          icon={<LockIcon />}
          label={vocab('Publish to GitHub private repository')}
          sub={hint('private')}
          vocabularyMode="factual"
          disabled={!trimmed}
          onClick={() => onPublish(trimmed, true)}
        />
        <ListRow
          className="pubdlg__opt"
          icon={<GlobeIcon />}
          label={vocab('Publish to GitHub public repository')}
          sub={hint('public')}
          vocabularyMode="factual"
          disabled={!trimmed}
          onClick={() => onPublish(trimmed, false)}
        />
    </Dialog>
  )
}

function LockIcon() {
  return (
    <svg className="pubdlg__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="3" y="7" width="10" height="6.5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function GlobeIcon() {
  return (
    <svg className="pubdlg__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  )
}
