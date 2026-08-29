import { useEffect, useMemo, useRef, useState } from 'react'
import { useDialogStack } from '../components/dialog-stack'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '@renderer/lib/regex/useRegexSearchField'
import { Button, Dialog, TextField } from '../ui/md3'
import { resolveWslApi, type WslCatalogueEntry } from './wslCoreApi'
import type { WslCreateProgress } from '@shared/wsl'
import { validateWslCreateForm } from './wslCreateForm'

interface WslCreateDialogProps {
  catalogue: WslCatalogueEntry[]
  catalogueLoading: boolean
  catalogueError: string | null
  existingNames: ReadonlySet<string>
  busy: boolean
  error: string | null
  onCreate: (v: { operationId: string; catalogueId: string; name: string }) => void
  onCancelCreate: (operationId: string) => Promise<boolean>
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
  onCancelCreate,
  onCancel
}: WslCreateDialogProps): React.JSX.Element {
  const [catalogueId, setCatalogueId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [operationId, setOperationId] = useState<string | null>(null)
  const operationIdRef = useRef<string | null>(null)
  const [progress, setProgress] = useState<WslCreateProgress | null>(null)
  const [cancelRequested, setCancelRequested] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const startedAtRef = useRef<number | null>(null)
  const search = useRegexSearchField({ mode: 'text' })
  const searchInputRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const isTop = useDialogStack()

  const cancel = async (): Promise<void> => {
    if (!busy) {
      onCancel()
      return
    }
    const activeOperationId = operationIdRef.current
    if (!activeOperationId) {
      setCancelRequested(false)
      setCancelError('Cancellation could not be sent because there is no active WSL operation.')
      return
    }
    if (cancelRequested) return
    setCancelRequested(true)
    setCancelError(null)
    try {
      const accepted = await onCancelCreate(activeOperationId)
      if (!accepted) {
        setCancelRequested(false)
        setCancelError('Cancellation was not accepted because the WSL operation is no longer active. You can retry or close this dialog.')
      }
    } catch (e) {
      setCancelRequested(false)
      setCancelError(`Could not cancel WSL creation: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  useEffect(() => {
    if (!operationId) return
    return resolveWslApi().onCreateProgress((next) => {
      if (next.operationId === operationId) setProgress(next)
    })
  }, [operationId])

  useEffect(() => {
    if (!busy && operationId) {
      operationIdRef.current = null
      setOperationId(null)
      startedAtRef.current = null
    }
  }, [busy, operationId])

  useEffect(() => {
    if (!busy || !startedAtRef.current) return
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - (startedAtRef.current ?? Date.now()))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [busy, operationId])

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
        cancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isTop, onCancel, onCancelCreate, busy, operationId])

  const submit = (): void => {
    if (busy || operationIdRef.current || !validation.valid || !catalogueId) return
    const nextOperationId = operationIdRef.current ?? crypto.randomUUID()
    operationIdRef.current = nextOperationId
    setOperationId(nextOperationId)
    startedAtRef.current = Date.now()
    setElapsedMs(0)
    setProgress({ operationId: nextOperationId, stage: 'validating', step: 1, steps: 4, determinate: false, elapsedMs: 0, message: 'Validating the selected distribution and name.' })
    setCancelRequested(false)
    setCancelError(null)
    onCreate({ operationId: nextOperationId, catalogueId, name: name.trim() })
  }

  return (
    <Dialog
      open
      onClose={cancel}
      closeOnScrimClick={!busy}
      closeOnEscape={false}
      className="wsl-create-dialog"
      title="New WSL instance"
      actions={
        <>
          <Button type="button" variant="text" onClick={() => void cancel()} disabled={cancelRequested}>
            {cancelRequested ? 'Cancelling…' : 'Cancel'}
          </Button>
          <Button
            type="button"
            variant="filled"
            disabled={busy || !validation.valid}
            title={validation.disabledReason ?? undefined}
            onClick={submit}
          >
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="wsl-create-dialog__body">
        <p className="wsl-create-dialog__description">
          Choose a distribution from the live WSL catalogue, then give this machine-local instance a unique name.
        </p>

        <div className="menu-filter wsl-create-dialog__search">
          <div className="menu-filter__row">
            <TextField
              ref={searchInputRef}
              className="wsl-create-dialog__search-field"
              label="Filter distributions"
              aria-label="Filter distributions"
              value={search.value}
              spellCheck={false}
              disabled={busy}
              trailingSlot={<AnchoredRegexBuilder
                search={search}
                fieldRef={searchInputRef}
                label="Regex for WSL distributions"
                zIndex={93}
              />}
              onChange={(e) => search.setValue(e.target.value)}
            />
          </div>
          {search.error && <div className="menu-filter__error">{search.error}</div>}
        </div>

        <div className="wsl-create-dialog__list" role="listbox" aria-label="Available WSL distributions" aria-busy={catalogueLoading}>
          {catalogueLoading ? (
            <div className="wsl-create-dialog__empty" role="status">Loading available distributions…</div>
          ) : catalogueError ? (
            <div className="wsl-create-dialog__empty wsl-create-dialog__empty--error" role="alert">
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
                aria-disabled={busy || undefined}
                disabled={busy}
                className={`wsl-create-dialog__option${catalogueId === c.id ? ' is-active' : ''}`}
                onClick={() => setCatalogueId(c.id)}
              >
                {c.label}
              </button>
            ))
          )}
        </div>

        <TextField
            ref={nameInputRef}
            className="wsl-create-dialog__name-field"
            label="Instance name"
            aria-label="WSL instance name"
            value={name}
            spellCheck={false}
            placeholder="my-project"
            disabled={busy}
            invalid={!!validation.nameError}
            supportText={validation.nameError ?? 'Letters, numbers, spaces, dots, hyphens, and underscores are accepted.'}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />

        {(error ?? cancelError) && <div className="wsl-create-dialog__field-error" role="alert">{error ?? cancelError}</div>}

        {busy && (
          <div className="wsl-create-dialog__progress" role="status" aria-live="polite">
            <div className="wsl-create-dialog__progress-heading">
              <strong>{cancelRequested ? 'Cancelling WSL creation…' : progress?.message ?? 'Starting WSL creation…'}</strong>
              <span>Step {progress?.step ?? 1} of {progress?.steps ?? 4}</span>
            </div>
            <div
              className={`wsl-create-dialog__progress-track${progress?.determinate ? '' : ' is-indeterminate'}`}
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={progress?.steps ?? 4}
              aria-valuenow={progress?.step ?? 1}
              aria-valuetext={`Step ${progress?.step ?? 1} of ${progress?.steps ?? 4}, ${progress?.stage ?? 'validating'}${progress?.determinate ? '' : '; installation byte progress is unavailable'}`}
              aria-label="WSL creation phase progress"
            >
              <span style={progress?.determinate ? { width: '100%' } : undefined} />
            </div>
            <p className="wsl-create-dialog__progress-detail">
              {'Elapsed time: ' + Math.floor((Math.max(elapsedMs, progress?.elapsedMs ?? 0)) / 1000) + ' seconds. ' + (progress?.stage === 'installing' ? 'Installation progress is reported by phase because wsl.exe provides no byte or percentage telemetry.' : 'The operation is bounded and can be cancelled.')}
            </p>
          </div>
        )}
      </div>
    </Dialog>
  )
}
