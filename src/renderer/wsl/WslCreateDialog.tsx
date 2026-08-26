import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDialogStack } from '../components/dialog-stack'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '@renderer/lib/regex/useRegexSearchField'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import type { WslCatalogueEntry } from './wslCoreApi'
import { validateWslCreateForm } from './wslCreateForm'

interface WslCreateDialogProps {
  catalogue: WslCatalogueEntry[]
  catalogueLoading: boolean
  catalogueError: string | null
  existingNames: ReadonlySet<string>
  busy: boolean
  error: string | null
  onCreate: (v: { catalogueId: string; name: string }) => void
  onCancel: () => void
}

/**
 * "New WSL instance…" — a right-click-on-empty-canvas guided form: a searchable picker over the
 * real catalogue (every flavour the machine's WSL can install, not a curated shortlist — see
 * `WslCoreApi.catalogue`) plus a required name field that validates inline in plain words. The
 * Create button is disabled until `validateWslCreateForm` says every condition is met, and it
 * always names the exact unmet one — never a bare disabled control with no explanation.
 *
 * Modelled on `WorktreeDialog`/`GroupPickerDialog`: its own top-level portal (the context menu
 * that opened it has already unmounted), its own anchored regex-builder-backed search over the
 * distro list, keyboard operable, MD3 primitives only.
 */
export function WslCreateDialog({
  catalogue,
  catalogueLoading,
  catalogueError,
  existingNames,
  busy,
  error,
  onCreate,
  onCancel
}: WslCreateDialogProps): React.JSX.Element {
  const [catalogueId, setCatalogueId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const search = useRegexSearchField({ mode: 'text' })
  const searchInputRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const isTop = useDialogStack()

  useEffect(() => {
    searchInputRef.current?.focus()
  }, [])

  const filtered = useMemo(
    () => catalogue.filter((c) => search.test(c.label)),
    [catalogue, search]
  )

  const validation = validateWslCreateForm({
    catalogueId,
    name,
    existingNames,
    catalogueLoading,
    catalogueError,
    busy
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!isTop()) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isTop, onCancel])

  const submit = (): void => {
    if (!validation.valid || !catalogueId) return
    onCreate({ catalogueId, name: name.trim() })
  }

  return createPortal(
    <div className="confirm-overlay" onClick={onCancel}>
      <div
        className="confirm bind-dialog wsl-create-dialog"
        role="dialog"
        aria-label="New WSL instance"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="confirm__msg">New WSL instance</p>

        <div className="menu-filter wsl-create-dialog__search">
          <div className="menu-filter__row">
            <input
              ref={searchInputRef}
              className="menu-filter__input"
              value={search.value}
              spellCheck={false}
              placeholder={search.mode === 'regex' ? 'Filter distributions… (regex)' : 'Filter distributions…'}
              aria-label="Filter distributions"
              onChange={(e) => search.setValue(e.target.value)}
            />
            <AnchoredRegexBuilder
              search={search}
              fieldRef={searchInputRef}
              label="Regex — WSL distributions"
              zIndex={93}
            />
          </div>
          {search.error && <div className="menu-filter__error">{search.error}</div>}
        </div>

        <div className="wsl-create-dialog__list" role="listbox" aria-label="Available distributions">
          {catalogueLoading ? (
            <div className="wsl-create-dialog__empty">Loading available distributions…</div>
          ) : catalogueError ? (
            <div className="wsl-create-dialog__empty wsl-create-dialog__empty--error">
              Could not load available distributions: {catalogueError}
            </div>
          ) : filtered.length === 0 ? (
            <div className="wsl-create-dialog__empty">
              {catalogue.length === 0 ? 'No distributions available.' : 'No distributions match that filter.'}
            </div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={catalogueId === c.id}
                className={`wsl-create-dialog__option${catalogueId === c.id ? ' is-active' : ''}`}
                onClick={() => setCatalogueId(c.id)}
              >
                {c.label}
              </button>
            ))
          )}
        </div>

        <label className="wsl-create-dialog__field">
          <span className="wsl-create-dialog__field-label">Name</span>
          <Input
            ref={nameInputRef}
            value={name}
            spellCheck={false}
            placeholder="my-project"
            aria-label="WSL instance name"
            aria-invalid={!!validation.nameError}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
          {validation.nameError && <div className="wsl-create-dialog__field-error">{validation.nameError}</div>}
        </label>

        {error && <div className="wsl-create-dialog__field-error">{error}</div>}

        <div className="confirm__actions">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!validation.valid}
            title={validation.disabledReason ?? undefined}
            onClick={submit}
          >
            Create
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
