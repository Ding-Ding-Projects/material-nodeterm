import { useEffect, useMemo, useRef, useState } from 'react'
import { useDialogStack } from '../components/dialog-stack'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '@renderer/lib/regex/useRegexSearchField'
import { Button, Dialog, TextField } from '../ui/md3'
import { resolveWslApi, type WslCatalogueEntry } from './wslCoreApi'
import type { WslCreateProgress } from '@shared/wsl'
import { validateWslCreateForm } from './wslCreateForm'
import { useI18n } from '../lib/i18n'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { mapAroundExactFacts } from '../nodes/nodeVocabulary'

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

interface WslDialogError {
  ownership: 'authored' | 'external-factual'
  text: string
  facts?: readonly string[]
  authoredPrefix?: string
}

const WSL_COPY_IDS: Record<string, string> = {
  'New WSL instance': 'wsl.create.title',
  'Cancelling…': 'wsl.create.actions.cancelling',
  Cancel: 'wsl.create.actions.cancel',
  'Creating…': 'wsl.create.actions.creating',
  Create: 'wsl.create.actions.create',
  'Choose a distribution from the live WSL catalogue, then give this machine-local instance a unique name.': 'wsl.create.description',
  'Filter distributions': 'wsl.create.filter.label',
  'Regex for WSL distributions': 'wsl.create.filter.regex',
  'Available WSL distributions': 'wsl.create.list.aria',
  'Loading available distributions…': 'wsl.create.status.loading',
  'Could not load available distributions:': 'wsl.create.error.cataloguePrefix',
  'No distributions available.': 'wsl.create.empty.none',
  'No distributions match that filter.': 'wsl.create.empty.noMatch',
  'Instance name': 'wsl.create.field.name',
  'WSL instance name': 'wsl.create.field.nameAria',
  'my-project': 'wsl.create.field.placeholder',
  'Letters, numbers, spaces, dots, hyphens, and underscores are accepted.': 'wsl.create.field.support',
  'The WSL operation reported an error:': 'wsl.create.error.prefix',
  'Starting WSL creation…': 'wsl.create.progress.starting',
  'Cancelling WSL creation…': 'wsl.create.progress.cancelling',
  'Validating the selected distribution and name.': 'wsl.create.progress.validating',
  Step: 'wsl.create.progress.step',
  of: 'wsl.create.progress.of',
  'WSL creation phase progress': 'wsl.create.progress.aria',
  'Elapsed time:': 'wsl.create.progress.elapsed',
  'seconds.': 'wsl.create.progress.seconds',
  'Installation progress is reported by phase because wsl.exe provides no byte or percentage telemetry.': 'wsl.create.progress.installing',
  'The operation is bounded and can be cancelled.': 'wsl.create.progress.cancellable',
  'Cancellation could not be sent because there is no active WSL operation.': 'wsl.create.error.noActive',
  'Cancellation was not accepted because the WSL operation is no longer active. You can retry or close this dialog.': 'wsl.create.error.cancelRejected',
  'Could not cancel WSL creation:': 'wsl.create.error.cancelPrefix',
  'Name is required.': 'wsl.create.validation.required',
  'Name cannot start or end with whitespace.': 'wsl.create.validation.whitespace',
  'Name must be 64 characters or fewer.': 'wsl.create.validation.length',
  'Name contains characters that are not allowed.': 'wsl.create.validation.characters',
  'Use letters, numbers, spaces, dots, hyphens, or underscores, starting and ending with a letter or number.': 'wsl.create.validation.shape',
  'A WSL instance with this name already exists.': 'wsl.create.validation.duplicate'
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
  const [cancelError, setCancelError] = useState<WslDialogError | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const startedAtRef = useRef<number | null>(null)
  const search = useRegexSearchField({ mode: 'text' })
  const searchInputRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const isTop = useDialogStack()
  const { ts } = useI18n()
  const mapVocabulary = useVocabularyMapper()
  // The fallback is both localized through the shared catalog and then passed through the local
  // personal-vocabulary boundary. Keys are derived only from fixed shipped copy, never from a
  // distribution name, user name, path, operation id, or external error.
  const vocab = (fallback: string): string => ts(WSL_COPY_IDS[fallback] ?? `wsl.create.runtime.${fallback}`, fallback)
  const copy = (fallback: string, facts: readonly string[] = []): string =>
    mapAroundExactFacts(vocab(fallback), facts, mapVocabulary)

  const renderError = (value: WslDialogError): string =>
    value.ownership === 'external-factual'
      ? `${value.authoredPrefix ? `${copy(value.authoredPrefix, ['WSL'])} ` : ''}${mapAroundExactFacts(value.text, value.facts ?? [], mapVocabulary)}`
      : copy(value.text, ['WSL', 'wsl.exe'])

  const cancel = async (): Promise<void> => {
    if (!busy) {
      onCancel()
      return
    }
    const activeOperationId = operationIdRef.current
    if (!activeOperationId) {
      setCancelRequested(false)
      setCancelError({ ownership: 'authored', text: 'Cancellation could not be sent because there is no active WSL operation.' })
      return
    }
    if (cancelRequested) return
    setCancelRequested(true)
    setCancelError(null)
    try {
      const accepted = await onCancelCreate(activeOperationId)
      if (!accepted) {
        setCancelRequested(false)
        setCancelError({ ownership: 'authored', text: 'Cancellation was not accepted because the WSL operation is no longer active. You can retry or close this dialog.' })
      }
    } catch (e) {
      setCancelRequested(false)
      const detail = e instanceof Error ? e.message : String(e)
      setCancelError({
        ownership: 'external-factual',
        text: detail,
        facts: [detail],
        authoredPrefix: 'Could not cancel WSL creation:'
      })
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
      title={copy('New WSL instance', ['WSL'])}
      actions={
        <>
          <Button type="button" variant="text" onClick={() => void cancel()} disabled={cancelRequested}>
            {cancelRequested ? copy('Cancelling…') : copy('Cancel')}
          </Button>
          <Button
            type="button"
            variant="filled"
            disabled={busy || !validation.valid}
            title={validation.disabledReason ? copy(validation.disabledReason, ['WSL', 'wsl.exe']) : undefined}
            onClick={submit}
          >
            {busy ? copy('Creating…') : copy('Create')}
          </Button>
        </>
      }
    >
      <div className="wsl-create-dialog__body">
        <p className="wsl-create-dialog__description">
          {copy('Choose a distribution from the live WSL catalogue, then give this machine-local instance a unique name.', ['WSL'])}
        </p>

        <div className="menu-filter wsl-create-dialog__search">
          <div className="menu-filter__row">
            <TextField
              ref={searchInputRef}
              className="wsl-create-dialog__search-field"
              label={copy('Filter distributions')}
              aria-label={copy('Filter distributions')}
              value={search.value}
              spellCheck={false}
              disabled={busy}
              trailingSlot={<AnchoredRegexBuilder
                search={search}
                fieldRef={searchInputRef}
                label={copy('Regex for WSL distributions', ['WSL'])}
                zIndex={93}
              />}
              onChange={(e) => search.setValue(e.target.value)}
            />
          </div>
          {/* Regex diagnostics can quote the user's raw pattern. Keep that complete diagnostic
              verbatim rather than allowing a vocabulary entry to rewrite typed input. */}
          {search.error && <div className="menu-filter__error">{search.error}</div>}
        </div>

        <div className="wsl-create-dialog__list" role="listbox" aria-label={copy('Available WSL distributions', ['WSL'])} aria-busy={catalogueLoading}>
          {catalogueLoading ? (
            <div className="wsl-create-dialog__empty" role="status">{copy('Loading available distributions…')}</div>
          ) : catalogueError ? (
            <div className="wsl-create-dialog__empty wsl-create-dialog__empty--error" role="alert">
              {copy('Could not load available distributions:')} {catalogueError}
            </div>
          ) : filtered.length === 0 ? (
            <div className="wsl-create-dialog__empty">
              {catalogue.length === 0 ? copy('No distributions available.') : copy('No distributions match that filter.')}
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
            label={copy('Instance name')}
            aria-label={copy('WSL instance name', ['WSL'])}
            value={name}
            spellCheck={false}
            placeholder={copy('my-project')}
            disabled={busy}
            invalid={!!validation.nameError}
            supportText={validation.nameError ? copy(validation.nameError, ['WSL', 'wsl.exe']) : copy('Letters, numbers, spaces, dots, hyphens, and underscores are accepted.')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />

        {(error || cancelError) && (
          <div className="wsl-create-dialog__field-error" role="alert">
            {error
              ? <>{copy('The WSL operation reported an error:', ['WSL'])} {error}</>
              : cancelError
                ? renderError(cancelError)
                : null}
          </div>
        )}

        {busy && (
          <div className="wsl-create-dialog__progress" role="status" aria-live="polite">
            <div className="wsl-create-dialog__progress-heading">
              <strong>
                {cancelRequested
                  ? copy('Cancelling WSL creation…', ['WSL'])
                  : progress
                    ? mapAroundExactFacts(progress.message, [catalogue.find((c) => c.id === catalogueId)?.label ?? '', name, progress.operationId], (value) => copy(value, ['WSL', 'wsl.exe']))
                    : copy('Starting WSL creation…', ['WSL'])}
              </strong>
              <span>{copy('Step')} {progress?.step ?? 1} {copy('of')} {progress?.steps ?? 4}</span>
            </div>
            <div
              className={`wsl-create-dialog__progress-track${progress?.determinate ? '' : ' is-indeterminate'}`}
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={progress?.steps ?? 4}
              aria-valuenow={progress?.step ?? 1}
              aria-valuetext={mapAroundExactFacts(
                `Step ${progress?.step ?? 1} of ${progress?.steps ?? 4}, ${progress?.stage ?? 'validating'}${progress?.determinate ? '' : '; installation byte progress is unavailable'}`,
                [progress?.stage ?? 'validating', 'WSL', 'wsl.exe'],
                (value) => copy(value, ['WSL', 'wsl.exe'])
              )}
              aria-label={copy('WSL creation phase progress', ['WSL'])}
            >
              <span style={progress?.determinate ? { width: '100%' } : undefined} />
            </div>
            <p className="wsl-create-dialog__progress-detail">
              {copy('Elapsed time:')} {Math.floor((Math.max(elapsedMs, progress?.elapsedMs ?? 0)) / 1000)} {copy('seconds.')}{' '}
              {progress?.stage === 'installing'
                ? copy('Installation progress is reported by phase because wsl.exe provides no byte or percentage telemetry.', ['wsl.exe'])
                : copy('The operation is bounded and can be cancelled.')}
            </p>
          </div>
        )}
      </div>
    </Dialog>
  )
}
