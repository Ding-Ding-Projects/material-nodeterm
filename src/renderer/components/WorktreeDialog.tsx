import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDialogStack } from './dialog-stack'
import { BranchSelect } from './BranchSelect'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { isValidGitRef, type WorktreeCreateValue, type WorktreeEntry } from '@shared/worktree'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { Radio } from '../ui/md3'
import { Radio } from '@renderer/ui/md3'
import {
  filterWorktrees,
  isValidGitRef,
  type WorktreeCreateValue,
  type WorktreeEntry
} from '@shared/worktree'

interface Props {
  /** 'create' = the pane/palette entry point (a new group frame); 'bind' = an existing group's
   *  "Bind to worktree…". Only the wording differs — both can create or adopt a worktree. */
  intent: 'create' | 'bind'
  /** Repo root, resolved from the project cwd. Empty only when the project is not a git repo. */
  repoPath: string
  /** Worktrees that already exist for this repo, excluding the main checkout and bound ones. */
  existing: WorktreeEntry[]
  /** The repo's default branch (the main checkout's), used as the Base default. */
  defaultBaseRef: string
  /** The repo's local branch names. Base and the "existing branch" field pick from these with a
   *  custom dropdown (`BranchSelect`). Base's dropdown also carries a free-text field so a base can
   *  be any ref (a tag / SHA / `origin/x`), not just a local branch. Empty ⇒ plain text inputs. */
  branches: string[]
  /** Suggested worktree path. Returns '' when no writable base dir is known — see `pathUnknown`. */
  defaultPath: (repoPath: string, branch: string) => string
  busy: boolean
  error: string | null
  onCreate: (v: WorktreeCreateValue) => void
  onBindExisting: (e: WorktreeEntry) => void
  onCancel: () => void
}

/** Create a worktree (and the group frame around it), or bind a group to one that already exists. */
export function WorktreeDialog({
  intent,
  repoPath,
  existing,
  defaultBaseRef,
  branches,
  defaultPath,
  busy,
  error,
  onCreate,
  onBindExisting,
  onCancel
}: Props) {
  const vocabulary = useVocabularyMapper()
  const existingSearch = useRegexSearchField({ mode: 'text' })
  const existingSearchInputRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  )
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [branch, setBranch] = useState('feature/')
  // `feature/` is a head-start for typing, not a submittable value — it fails `isValidGitRef`
  // (trailing slash). Showing the red "not a valid branch name" error on an untouched dialog reads
  // as the app yelling before the user has done anything, so the error waits until the field is
  // touched. (Create stays disabled meanwhile — see `valid` — so an unfinished `feature/` can't
  // slip through either way.)
  const [branchEdited, setBranchEdited] = useState(false)
  const [baseRef, setBaseRef] = useState(defaultBaseRef)
  const [path, setPath] = useState(() => defaultPath(repoPath, 'feature/'))
  const [pathEdited, setPathEdited] = useState(false)
  const [existingQuery, setExistingQuery] = useState('')

  // Keep the path in sync with the branch until the user edits it by hand.
  useEffect(() => {
    if (!pathEdited) setPath(defaultPath(repoPath, branch || 'work'))
  }, [repoPath, branch, pathEdited, defaultPath])

  // The repo's default branch resolves asynchronously (the store fills after the first render);
  // adopt it as long as the user has not typed a base of their own.
  const [baseEdited, setBaseEdited] = useState(false)
  useEffect(() => {
    if (!baseEdited) setBaseRef(defaultBaseRef)
  }, [defaultBaseRef, baseEdited])

  const hasBranches = branches.length > 0
  const filteredExisting = filterWorktrees(existing, existingQuery)

  const filteredExisting = useMemo(
    () =>
      existing.filter((entry) =>
        existingSearch.test(`${entry.branch ?? '(detached HEAD — check out a branch first)'} ${entry.path}`)
      ),
    [
      existing,
      existingSearch.mode,
      existingSearch.query,
      existingSearch.pattern,
      existingSearch.flags,
      existingSearch.test
    ]
  )

  // Search is the only field in this picker that can narrow the collection, so it receives focus
  // on open and returns focus to the control that launched the dialog when the portal closes.
  useEffect(() => {
    existingSearchInputRef.current?.focus()
    return () => returnFocusRef.current?.focus()
  }, [])

  // Only the topmost modal answers a key (./dialog-stack): this dialog and a ConfirmDialog can be
  // open at the same time, and one Escape must not close both.
  const isTop = useDialogStack()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isTop, onCancel])

  // No writable base dir is known, so we refuse to *suggest* a path — an empty base would
  // otherwise propose `/worktrees/…` at the filesystem root. The user can still type one. The hint
  // tracks the FIELD, not `pathEdited`: clearing the box after editing it also leaves Create
  // disabled, and a disabled button with no explanation is a dead end.
  const pathUnknown = !path.trim()
  // Gate Create on the same validator the ops layer uses, so "clickable" always means "will not be
  // rejected for this reason" — the button reflects the REAL validity (so an untouched `feature/`
  // can't be submitted). The red error, by contrast, only appears once the user has touched the
  // field (`branchEdited`): a fresh dialog must not accuse the user of a bad name they never typed.
  const branchInvalid = !!branch.trim() && !isValidGitRef(branch)
  const valid = !!repoPath.trim() && !!branch.trim() && !branchInvalid && !!path.trim() && !busy
  const title = vocabulary(intent === 'bind' ? 'Bind to worktree' : 'New worktree')
  const createLabel = vocabulary(intent === 'bind' ? 'Create & bind' : 'Create')

  return createPortal(
    <div className="confirm-overlay" onClick={onCancel}>
      <div
        className="confirm bind-dialog worktree-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="worktree-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="confirm__msg" id="worktree-dialog-title">{title}</p>

        <div className="bind-repo" title={repoPath}>
          {repoPath || vocabulary('This project is not a git repository.')}
        </div>

        {existing.length > 0 && (
          <section className="bind-existing" aria-labelledby="bind-existing-title">
            <div className="bind-existing__title" id="bind-existing-title">
              {vocabulary('Existing worktrees')} <span className="bind-existing__count">({existing.length})</span>
            </div>
            <div className="menu-filter bind-existing__search">
              <div className="menu-filter__row">
                <input
                  ref={existingSearchInputRef}
                  className="menu-filter__input"
                  value={existingSearch.value}
                  spellCheck={false}
                  placeholder={
                    existingSearch.mode === 'regex'
                      ? vocabulary('Filter existing worktrees… (regex)')
                      : vocabulary('Filter existing worktrees…')
                  }
                  aria-label={vocabulary('Filter existing worktrees')}
                  aria-controls="bind-existing-list"
                  onChange={(e) => existingSearch.setValue(e.target.value)}
                />
                <AnchoredRegexBuilder
                  search={existingSearch}
                  fieldRef={existingSearchInputRef}
                  label="Regex — existing worktrees"
                  zIndex={93}
                />
              </div>
              {existingSearch.error && <div className="menu-filter__error">{existingSearch.error}</div>}
            </div>
            <div className="sr-only" role="status" aria-live="polite">
              {existingSearch.active
                ? `${filteredExisting.length} of ${existing.length} existing worktrees shown`
                : `${existing.length} existing worktrees available`}
            </div>
            <ul
              id="bind-existing-list"
              className="bind-existing__list"
              role="list"
              aria-label={`${filteredExisting.length} of ${existing.length} existing worktrees available`}
            >
              {filteredExisting.length === 0 ? (
                <li className="bind-existing__empty" role="status">
                  {vocabulary('No existing worktrees match that filter.')}
                </li>
              ) : (
                filteredExisting.map((e) => (
                  <li key={e.path} className="bind-existing__item">
                    {/* A detached-HEAD worktree cannot be bound (there is no branch to merge or name
                        the group after), so the row is disabled and says why. */}
                    <button
                      className="bind-existing__row"
                      disabled={busy || !e.branch}
                      onClick={() => onBindExisting(e)}
                      title={
                        e.branch
                          ? e.path
                          : `${e.path}\nDetached HEAD — check out a branch in this worktree first.`
                      }
                    >
                      <span className="bind-existing__branch">
                        {e.branch ? `⎇ ${e.branch}` : '⎇ (detached HEAD — check out a branch first)'}
                      </span>
                      <span className="bind-existing__path">{e.path}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </section>
          <div className="bind-existing">
            <div className="bind-existing__title">Existing worktrees</div>
            <input
              className="bind-existing__search"
              type="search"
              aria-label="Search existing worktrees"
              placeholder="Search branch or path…"
              value={existingQuery}
              onChange={(e) => setExistingQuery(e.target.value)}
            />
            <div className="bind-existing__list">
              {filteredExisting.map((e) => (
                // A detached-HEAD worktree cannot be bound (there is no branch to merge or name the
                // group after), so the row is DISABLED and says why — clicking it used to be a
                // silent no-op.
                <button
                  key={e.path}
                  className="bind-existing__row"
                  disabled={busy || !e.branch}
                  onClick={() => onBindExisting(e)}
                  title={
                    e.branch
                      ? e.path
                      : `${e.path}\nDetached HEAD — check out a branch in this worktree first.`
                  }
                >
                  <span className="bind-existing__branch">
                    {e.branch ? `⎇ ${e.branch}` : '⎇ (detached HEAD — check out a branch first)'}
                  </span>
                  <span className="bind-existing__path">{e.path}</span>
                </button>
              ))}
              {filteredExisting.length === 0 && (
                <div className="bind-existing__empty">No matching worktrees</div>
              )}
            </div>
          </div>
        )}

        <div className="bind-mode">
          <label>
            <Radio name="worktree-mode" checked={mode === 'new'} onChange={() => setMode('new')} /> {vocabulary('New branch')}
          </label>
          <label>
            <Radio
              name="worktree-mode"
            <Radio checked={mode === 'new'} onChange={() => setMode('new')} /> {vocabulary('New branch')}
          </label>
          <label>
            <Radio
              checked={mode === 'existing'}
              onChange={() => setMode('existing')}
            />{' '}
            {vocabulary('Existing branch')}
          </label>
        </div>

        {/* New branch = a name that must NOT exist yet, so free text. Existing branch = check out
            one that DOES exist, so pick it from the dropdown (falls back to text if none were read). */}
        {mode === 'existing' && hasBranches ? (
          <div className="bind-field">
            {vocabulary('Branch')}
            <BranchSelect
              value={branches.includes(branch) ? branch : ''}
              options={branches}
              placeholder={vocabulary('Select a branch…')}
              onChange={(v) => {
                setBranch(v)
                setBranchEdited(true)
              }}
            />
          </div>
        ) : (
          <label className="bind-field">
            {vocabulary('Branch')}
            <input
              value={branch}
              onChange={(e) => {
                setBranch(e.target.value)
                setBranchEdited(true)
              }}
            />
          </label>
        )}

        {branchEdited && branchInvalid && (
          <div className="bind-error">
            Not a valid branch name — finish typing one (no spaces, "..", or a leading/trailing
            slash).
          </div>
        )}

        {mode === 'new' && (
          <>
            {/* Pick a branch from the dropdown, or type any ref (tag / SHA / origin/x) in its
                free-text field. If the branch list could not be read, degrade to a plain input. */}
            {hasBranches ? (
              <div className="bind-field">
                {vocabulary('Base')}
                <BranchSelect
                  value={baseRef}
                  options={branches}
                  placeholder={vocabulary('Select a base…')}
                  allowCustom
                  customPlaceholder="or a tag, commit, origin/…"
                  onChange={(v) => {
                    setBaseRef(v)
                    setBaseEdited(true)
                  }}
                />
              </div>
            ) : (
              <label className="bind-field">
                {vocabulary('Base')}
                <input
                  value={baseRef}
                  placeholder="e.g. origin/main, a tag, or a commit"
                  onChange={(e) => {
                    setBaseRef(e.target.value)
                    setBaseEdited(true)
                  }}
                />
              </label>
            )}
          </>
        )}

        <label className="bind-field">
          {vocabulary('Worktree path')}
          <input
            value={path}
            onChange={(e) => {
              setPath(e.target.value)
              setPathEdited(true)
            }}
          />
        </label>

        {pathUnknown && (
          <div className="bind-error">
            No default worktree location is available. Enter a full path to create one.
          </div>
        )}
        {error && <div className="bind-error">{error}</div>}

        <div className="confirm__actions">
          <button className="confirm__btn" onClick={onCancel} disabled={busy}>
            {vocabulary('Cancel')}
          </button>
          <button
            className="confirm__btn primary"
            disabled={!valid}
            onClick={() =>
              onCreate({
                repoPath: repoPath.trim(),
                mode,
                branch: branch.trim(),
                baseRef: baseRef.trim(),
                path: path.trim()
              })
            }
          >
            {busy ? vocabulary('Creating…') : createLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
