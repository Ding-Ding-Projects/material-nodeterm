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
import { formatText } from '@shared/i18n'

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
  copyId?: keyof typeof WSL_COPY_IDS
  authoredPrefixId?: keyof typeof WSL_COPY_IDS
}

const WSL_BRAND = 'WSL'

/** One canonical list of WSL-owned catalogue ids. Runtime facts are parameters, never ids. */
export const WSL_COPY_IDS = {
  title: 'wsl.create.title',
  cancel: 'wsl.create.actions.cancel',
  create: 'wsl.create.actions.create',
  cancelling: 'wsl.create.actions.cancelling',
  creating: 'wsl.create.actions.creating',
  description: 'wsl.create.description',
  filterLabel: 'wsl.create.filter.label',
  filterRegex: 'wsl.create.filter.regex',
  listAria: 'wsl.create.list.aria',
  loading: 'wsl.create.status.loading',
  catalogueError: 'wsl.create.error.cataloguePrefix',
  emptyNone: 'wsl.create.empty.none',
  emptyNoMatch: 'wsl.create.empty.noMatch',
  nameLabel: 'wsl.create.field.name',
  nameAria: 'wsl.create.field.nameAria',
  namePlaceholder: 'wsl.create.field.placeholder',
  nameSupport: 'wsl.create.field.support',
  errorPrefix: 'wsl.create.error.prefix',
  progressStarting: 'wsl.create.progress.starting',
  progressCancelling: 'wsl.create.progress.cancelling',
  progressValidating: 'wsl.create.progress.validating',
  progressChecking: 'wsl.create.progress.checking',
  progressInstalling: 'wsl.create.progress.installing',
  progressTelemetry: 'wsl.create.progress.telemetry',
  progressRecording: 'wsl.create.progress.recording',
  progressCompleted: 'wsl.create.progress.completed',
  progressFailed: 'wsl.create.progress.failed',
  progressCancelled: 'wsl.create.progress.cancelled',
  progressStep: 'wsl.create.progress.step',
  progressOf: 'wsl.create.progress.of',
  progressAria: 'wsl.create.progress.aria',
  progressElapsed: 'wsl.create.progress.elapsed',
  progressSeconds: 'wsl.create.progress.seconds',
  progressCancellable: 'wsl.create.progress.cancellable',
  errorNoActive: 'wsl.create.error.noActive',
  errorCancelRejected: 'wsl.create.error.cancelRejected',
  errorCancelPrefix: 'wsl.create.error.cancelPrefix',
  validationRequired: 'wsl.create.validation.required',
  validationWhitespace: 'wsl.create.validation.whitespace',
  validationLength: 'wsl.create.validation.length',
  validationCharacters: 'wsl.create.validation.characters',
  validationShape: 'wsl.create.validation.shape',
  validationDuplicate: 'wsl.create.validation.duplicate',
  validationChooseDistribution: 'wsl.create.validation.chooseDistribution'
} as const

const STAGE_COPY_IDS: Record<WslCreateProgress['stage'], keyof typeof WSL_COPY_IDS> = {
  validating: 'progressValidating',
  checking: 'progressChecking',
  installing: 'progressInstalling',
  recording: 'progressRecording',
  completed: 'progressCompleted',
  failed: 'progressFailed',
  cancelled: 'progressCancelled'
}

const VALIDATION_COPY_IDS: Record<string, keyof typeof WSL_COPY_IDS> = {
  'Name is required.': 'validationRequired',
  'Name cannot start or end with whitespace.': 'validationWhitespace',
  'Name must be 64 characters or fewer.': 'validationLength',
  'Name contains characters that are not allowed.': 'validationCharacters',
  'Use letters, numbers, spaces, dots, hyphens, or underscores, starting and ending with a letter or number.': 'validationShape',
  'A WSL instance with this name already exists.': 'validationDuplicate',
  'Choose a distribution.': 'validationChooseDistribution',
  'Creating…': 'creating',
  'Loading available distributions…': 'loading',
  'Could not load available distributions.': 'catalogueError'
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
  const copy = (id: string, fallback: string, params: Record<string, string> = {}): string =>
    formatText(mapVocabulary(ts(id, fallback)), params)

  const renderError = (value: WslDialogError): string =>
    value.ownership === 'external-factual'
      ? `${value.authoredPrefixId
        ? `${copy(WSL_COPY_IDS[value.authoredPrefixId], 'Could not cancel {brand} creation:', { brand: WSL_BRAND })} `
        : ''}${value.text}`
      : copy(
        value.copyId ? WSL_COPY_IDS[value.copyId] : WSL_COPY_IDS.errorPrefix,
        value.text,
        { brand: WSL_BRAND }
      )

  const copyValidation = (value: string): string => {
    const copyId = VALIDATION_COPY_IDS[value]
    if (!copyId) return value
    return copy(
      WSL_COPY_IDS[copyId],
      value,
      { brand: WSL_BRAND }
    )
  }

  const cancel = async (): Promise<void> => {
    if (!busy) {
      onCancel()
      return
    }
    const activeOperationId = operationIdRef.current
    if (!activeOperationId) {
      setCancelRequested(false)
      setCancelError({ ownership: 'authored', copyId: 'errorNoActive', text: '' })
      return
    }
    if (cancelRequested) return
    setCancelRequested(true)
    setCancelError(null)
    try {
      const accepted = await onCancelCreate(activeOperationId)
      if (!accepted) {
        setCancelRequested(false)
        setCancelError({ ownership: 'authored', copyId: 'errorCancelRejected', text: '' })
      }
    } catch (e) {
      setCancelRequested(false)
      const detail = e instanceof Error ? e.message : String(e)
      setCancelError({
        ownership: 'external-factual',
        text: detail,
        authoredPrefixId: 'errorCancelPrefix'
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
      title={copy(WSL_COPY_IDS.title, 'New {brand} instance', { brand: WSL_BRAND })}
      actions={
        <>
          <Button type="button" variant="text" onClick={() => void cancel()} disabled={cancelRequested}>
            {cancelRequested
              ? copy(WSL_COPY_IDS.cancelling, 'Cancelling {brand} creation…', { brand: WSL_BRAND })
              : copy(WSL_COPY_IDS.cancel, 'Cancel')}
          </Button>
          <Button
            type="button"
            variant="filled"
            disabled={busy || !validation.valid}
            title={validation.disabledReason ? copyValidation(validation.disabledReason) : undefined}
            onClick={submit}
          >
            {busy
              ? copy(WSL_COPY_IDS.creating, 'Creating {brand} instance…', { brand: WSL_BRAND })
              : copy(WSL_COPY_IDS.create, 'Create')}
          </Button>
        </>
      }
    >
      <div className="wsl-create-dialog__body">
        <p className="wsl-create-dialog__description">
          {copy(
            WSL_COPY_IDS.description,
            'Choose a distribution from the live {brand} catalogue, then give this machine-local instance a unique name.',
            { brand: WSL_BRAND }
          )}
        </p>

        <div className="menu-filter wsl-create-dialog__search">
          <div className="menu-filter__row">
            <TextField
              ref={searchInputRef}
              className="wsl-create-dialog__search-field"
              label={copy(WSL_COPY_IDS.filterLabel, 'Filter distributions')}
              aria-label={copy(WSL_COPY_IDS.filterLabel, 'Filter distributions')}
              value={search.value}
              spellCheck={false}
              disabled={busy}
              trailingSlot={<AnchoredRegexBuilder
                search={search}
                fieldRef={searchInputRef}
                label={copy(WSL_COPY_IDS.filterRegex, 'Regex for {brand} distributions', { brand: WSL_BRAND })}
                zIndex={93}
              />}
              onChange={(e) => search.setValue(e.target.value)}
            />
          </div>
          {/* Regex diagnostics can quote the user's raw pattern. Keep that complete diagnostic
              verbatim rather than allowing a vocabulary entry to rewrite typed input. */}
          {search.error && <div className="menu-filter__error">{search.error}</div>}
        </div>

        <div className="wsl-create-dialog__list" role="listbox" aria-label={copy(WSL_COPY_IDS.listAria, 'Available {brand} distributions', { brand: WSL_BRAND })} aria-busy={catalogueLoading}>
          {catalogueLoading ? (
            <div className="wsl-create-dialog__empty" role="status">{copy(WSL_COPY_IDS.loading, 'Loading available distributions…')}</div>
          ) : catalogueError ? (
            <div className="wsl-create-dialog__empty wsl-create-dialog__empty--error" role="alert">
              {copy(WSL_COPY_IDS.catalogueError, 'Could not load available distributions:')} {catalogueError}
            </div>
          ) : filtered.length === 0 ? (
            <div className="wsl-create-dialog__empty">
              {catalogue.length === 0
                ? copy(WSL_COPY_IDS.emptyNone, 'No distributions available.')
                : copy(WSL_COPY_IDS.emptyNoMatch, 'No distributions match that filter.')}
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
            label={copy(WSL_COPY_IDS.nameLabel, 'Instance name')}
            aria-label={copy(WSL_COPY_IDS.nameAria, '{brand} instance name', { brand: WSL_BRAND })}
            value={name}
            spellCheck={false}
            placeholder={copy(WSL_COPY_IDS.namePlaceholder, 'my-project')}
            disabled={busy}
            invalid={!!validation.nameError}
            supportText={validation.nameError
              ? copyValidation(validation.nameError)
              : copy(WSL_COPY_IDS.nameSupport, 'Letters, numbers, spaces, dots, hyphens, and underscores are accepted.')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />

        {(error || cancelError) && (
          <div className="wsl-create-dialog__field-error" role="alert">
            {error
              ? <>{copy(WSL_COPY_IDS.errorPrefix, 'The {brand} operation reported an error:', { brand: WSL_BRAND })} {error}</>
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
                  ? copy(WSL_COPY_IDS.progressCancelling, 'Cancelling {brand} creation…', { brand: WSL_BRAND })
                  : progress
                    ? copy(
                      WSL_COPY_IDS[STAGE_COPY_IDS[progress.stage]],
                      '{brand} creation is in progress.',
                      { brand: WSL_BRAND, exe: 'wsl.exe' }
                    )
                    : copy(WSL_COPY_IDS.progressStarting, 'Starting {brand} creation…', { brand: WSL_BRAND })}
              </strong>
              <span>
                {copy(WSL_COPY_IDS.progressStep, 'Step')} {progress?.step ?? 1}{' '}
                {copy(WSL_COPY_IDS.progressOf, 'of')} {progress?.steps ?? 4}
              </span>
            </div>
            <div
              className={`wsl-create-dialog__progress-track${progress?.determinate ? '' : ' is-indeterminate'}`}
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={progress?.steps ?? 4}
              aria-valuenow={progress?.step ?? 1}
              aria-valuetext={`${copy(WSL_COPY_IDS.progressStep, 'Step')} ${progress?.step ?? 1} ${copy(WSL_COPY_IDS.progressOf, 'of')} ${progress?.steps ?? 4}`}
              aria-label={copy(WSL_COPY_IDS.progressAria, '{brand} creation phase progress', { brand: WSL_BRAND })}
            >
              <span style={progress?.determinate ? { width: '100%' } : undefined} />
            </div>
            <p className="wsl-create-dialog__progress-detail">
              {copy(WSL_COPY_IDS.progressElapsed, 'Elapsed time:')} {Math.floor((Math.max(elapsedMs, progress?.elapsedMs ?? 0)) / 1000)} {copy(WSL_COPY_IDS.progressSeconds, 'seconds.')}{' '}
              {progress?.stage === 'installing'
                ? copy(
                  WSL_COPY_IDS.progressTelemetry,
                  'Installation progress is reported by phase because {exe} provides no byte or percentage telemetry.',
                  { exe: 'wsl.exe' }
                )
                : copy(WSL_COPY_IDS.progressCancellable, 'The operation is bounded and can be cancelled.')}
            </p>
            {progress?.message && (
              <p className="wsl-create-dialog__progress-detail" data-vocabulary-ownership="external-factual">
                {progress.message}
              </p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}
