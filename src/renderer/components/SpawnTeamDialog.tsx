import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDialogStack } from './dialog-stack'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { copy, fact, mapOwnedSentence } from '../lib/personalVocabulary/ownedCopy'
import { Button, Checkbox, TextArea } from '@renderer/ui/md3'

interface SpawnTeamDialogProps {
  /** False on SSH projects / non-repos — the toggle renders disabled with `worktreeNote` beside it. */
  worktreesAvailable: boolean
  /** Why worktrees are unavailable (e.g. the SSH notice). Shown only when they are. */
  worktreeNote?: string
  onSubmit: (v: { task: string; worktrees: boolean }) => void
  onCancel: () => void
}

/**
 * "Spawn a team…" (issue #78): the user types a task, and ONE conductor agent node is opened
 * pre-prompted with it — the conductor's own manage-nodeterm-canvas skill does the role split
 * and the fan-out, so no model plumbing lives in the app. Reuses the `.confirm*` shell like
 * InputDialog; the input is a textarea (Enter inserts a newline — tasks are prose), so submit
 * is ⌘/Ctrl+Enter or the button.
 */
export function SpawnTeamDialog({
  worktreesAvailable,
  worktreeNote,
  onSubmit,
  onCancel
}: SpawnTeamDialogProps) {
  const [task, setTask] = useState('')
  const [worktrees, setWorktrees] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const vocab = useVocabularyMapper()
  // In the modal stack so a ConfirmDialog underneath does not also answer Escape (its listener
  // is on `window`); Enter never leaves the textarea, so nothing else is needed.
  useDialogStack()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const canSubmit = task.trim().length > 0
  const submit = (): void => {
    if (canSubmit) onSubmit({ task, worktrees: worktreesAvailable && worktrees })
  }

  return createPortal(
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm" onClick={(e) => e.stopPropagation()}>
        <p className="confirm__msg">
          {vocab('Spawn a team — describe the task, and a conductor agent will split it into workstreams and open the team on the canvas.')}
        </p>
        <TextArea vocabularyMode="factual"
          ref={inputRef}
          className="confirm__input confirm__textarea"
          value={task}
          placeholder={vocab('What should the team build?')}
          aria-label={vocab('Team task')}
          rows={4}
          spellCheck={false}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
        />
        <label className="confirm__option">
          <Checkbox vocabularyMode="factual"
            checked={worktreesAvailable && worktrees}
            disabled={!worktreesAvailable}
            onChange={(e) => setWorktrees(e.target.checked)}
          />
          {mapOwnedSentence(vocab, [copy('Give each workstream its own '), fact('git worktree')])}
          {!worktreesAvailable && worktreeNote ? mapOwnedSentence(vocab, [copy(' — '), fact(worktreeNote)]) : ''}
        </label>
        <div className="confirm__actions">
          <Button variant="outlined" size="small" vocabularyMode="factual" className="confirm__btn" onClick={onCancel}>
            {vocab('Cancel')}
          </Button>
          <Button variant="filled" size="small" vocabularyMode="factual" className="confirm__btn primary" disabled={!canSubmit} onClick={submit}>
            {vocab('Spawn team')}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
