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
import {
  WSL_COPY,
  type WslCopyKey,
  type WslDialogError,
  wslCopyKeyForFallback,
  wslStageCopyKey
} from './wslCopy'

interface WslCreateDialogProps {
  catalogue: WslCatalogueEntry[]
  catalogueLoading: boolean
  catalogueError: WslDialogError | null
  existingNames: ReadonlySet<string>
  busy: boolean
  error: WslDialogError | null
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
  const [cancelError, setCancelError] = useState<WslDialogError | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const startedAtRef = useRef<number | null>(null)
  const wasBusyRef = useRef(false)
  const search = useRegexSearchField({ mode: 'text' })
  const searchInputRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const isTop = useDialogStack()
  const { ts } = useI18n()
  const mapVocabulary = useVocabularyMapper()
  // The fallback is both localized through the shared catalog and then passed through the local
  // personal-vocabulary boundary. Keys are derived only from fixed shipped copy, never from a
  // distribution name, user name, path, operation id, or external error.
  const copy = (key: WslCopyKey, facts: readonly string[] = [], params?: Readonly<Record<string, string>>): string => {
    const entry = WSL_COPY[key]
    return mapAroundExactFacts(ts(entry.id, entry.fallback, { brand: 'WSL', ...params }), facts, mapVocabulary)
  }

  const copyFromFallback = (fallback: string, facts: readonly string[] = []): string => {
    const key = wslCopyKeyForFallback(fallback)
    return key ? copy(key, facts) : mapAroundExactFacts(fallback, facts, mapVocabulary)
  }

  const renderError = (value: WslDialogError): string => {
    if (value.ownership === 'authored') return copy(value.copy)
    const authored = value.authoredTemplate
      ? copy(value.authoredTemplate, value.facts, value.params)
      : value.authoredPrefix
        ? copy(value.authoredPrefix)
        : value.text
          ? copy('operationErrorPrefix')
        : ''
    const factual = value.text ? mapAroundExactFacts(value.text, value.facts, mapVocabulary) : ''
    return [authored, factual].filter(Boolean).join(' ')
  }

  const cancel = async (): Promise<void> => {
    if (!busy && !operationIdRef.current) {
      onCancel()
      return
    }
    const activeOperationId = operationIdRef.current
    if (!activeOperationId) {
      setCancelRequested(false)
      setCancelError({ ownership: 'authored', copy: 'noActive' })
      return
    }
    if (cancelRequested) return
    setCancelRequested(true)
    setCancelError(null)
    try {
      const accepted = await onCancelCreate(activeOperationId)
      if (!accepted) {
        setCancelRequested(false)
        setCancelError({ ownership: 'authored', copy: 'cancelRejected' })
      }
    } catch (e) {
      setCancelRequested(false)
      const detail = e instanceof Error ? e.message : String(e)
      setCancelError({
        ownership: 'external-factual',
        text: detail,
        facts: [detail],
        authoredPrefix: 'cancelErrorPrefix'
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
    if (busy) wasBusyRef.current = true
    if (wasBusyRef.current && !busy && operationId) {
      operationIdRef.current = null
      setOperationId(null)
      startedAtRef.current = null
      wasBusyRef.current = false
    }
  }, [busy, operationId])

  useEffect(() => {
    if (!operationId || !startedAtRef.current) return
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - (startedAtRef.current ?? Date.now()))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [operationId])

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
  const operationActive = busy || operationId !== null

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
    if (operationActive || operationIdRef.current || !validation.valid || !catalogueId) return
    const nextOperationId = operationIdRef.current ?? crypto.randomUUID()
    operationIdRef.current = nextOperationId
    setOperationId(nextOperationId)
    startedAtRef.current = Date.now()
    setElapsedMs(0)
    setProgress({
      operationId: nextOperationId,
      stage: 'validating',
      step: 1,
      steps: 4,
      determinate: false,
      elapsedMs: 0,
      message: { id: 'validating', params: {}, facts: [] }
    })
    setCancelRequested(false)
    setCancelError(null)
    onCreate({ operationId: nextOperationId, catalogueId, name: name.trim() })
  }

  return (
    <Dialog
      open
      onClose={cancel}
      closeOnScrimClick={!operationActive}
      closeOnEscape={false}
      className="wsl-create-dialog"
      title={copy('title')}
      actions={
        <>
          <Button type="button" variant="text" onClick={() => void cancel()} disabled={cancelRequested}>
            {cancelRequested ? copy('cancelling') : copy('cancel')}
          </Button>
          <Button
            type="button"
            variant="filled"
            disabled={operationActive || !validation.valid}
            title={validation.disabledReason ? copyFromFallback(validation.disabledReason) : undefined}
            onClick={submit}
          >
            {operationActive ? copy('creating') : copy('create')}
          </Button>
        </>
      }
    >
      <div className="wsl-create-dialog__body">
        <p className="wsl-create-dialog__description">
          {copy('description')}
        </p>

        <div className="menu-filter wsl-create-dialog__search">
          <div className="menu-filter__row">
            <TextField
              ref={searchInputRef}
              className="wsl-create-dialog__search-field"
              label={copy('filterLabel')}
              aria-label={copy('filterLabel')}
              value={search.value}
              spellCheck={false}
              disabled={operationActive}
              trailingSlot={<AnchoredRegexBuilder
                search={search}
                fieldRef={searchInputRef}
                label={copy('filterRegex')}
                zIndex={93}
              />}
              onChange={(e) => search.setValue(e.target.value)}
            />
          </div>
          {/* Regex diagnostics can quote the user's raw pattern. Keep that complete diagnostic
              verbatim rather than allowing a vocabulary entry to rewrite typed input. */}
          {search.error && <div className="menu-filter__error">{search.error}</div>}
        </div>

        <div className="wsl-create-dialog__list" role="listbox" aria-label={copy('listAria')} aria-busy={catalogueLoading}>
          {catalogueLoading ? (
            <div className="wsl-create-dialog__empty" role="status">{copy('loading')}</div>
          ) : catalogueError ? (
            <div className="wsl-create-dialog__empty wsl-create-dialog__empty--error" role="alert">
              {renderError(catalogueError)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="wsl-create-dialog__empty">
              {catalogue.length === 0 ? copy('emptyNone') : copy('emptyNoMatch')}
            </div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={catalogueId === c.id}
                aria-disabled={operationActive || undefined}
                disabled={operationActive}
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
            label={copy('nameLabel')}
            aria-label={copy('nameAria')}
            value={name}
            spellCheck={false}
            placeholder={copy('namePlaceholder')}
            disabled={operationActive}
            invalid={!!validation.nameError}
            supportText={validation.nameError ? copyFromFallback(validation.nameError) : copy('nameSupport')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />

        {(error || cancelError) && (
          <div className="wsl-create-dialog__field-error" role="alert">
            {error
              ? renderError(error)
              : cancelError
                ? renderError(cancelError)
                : null}
          </div>
        )}

        {operationActive && (
          <div className="wsl-create-dialog__progress" role="status" aria-live="polite">
            <div className="wsl-create-dialog__progress-heading">
              <strong>
                {cancelRequested
                  ? copy('cancellingProgress')
                  : progress
                    ? copy(progress.message.id as WslCopyKey, progress.message.facts, progress.message.params)
                    : copy('starting')}
              </strong>
              <span>{copy('step')} {progress?.step ?? 1} {copy('of')} {progress?.steps ?? 4}</span>
            </div>
            <div
              className={`wsl-create-dialog__progress-track${progress?.determinate ? '' : ' is-indeterminate'}`}
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={progress?.steps ?? 4}
              aria-valuenow={progress?.step ?? 1}
              aria-valuetext={copy(
                'progressValue',
                [progress?.stage ?? 'validating', 'wsl.exe'],
                {
                  step: String(progress?.step ?? 1),
                  steps: String(progress?.steps ?? 4),
                  stage: copy(wslStageCopyKey(progress?.stage ?? 'validating')),
                  detail: progress?.determinate ? '' : copy('installing', ['wsl.exe'])
                }
              )}
              aria-label={copy('progressAria')}
            >
              <span style={progress?.determinate ? { width: '100%' } : undefined} />
            </div>
            <p className="wsl-create-dialog__progress-detail">
              {copy('elapsed')} {Math.floor((Math.max(elapsedMs, progress?.elapsedMs ?? 0)) / 1000)} {copy('seconds')}{' '}
              {progress?.stage === 'installing'
                ? copy('installingDetail', ['wsl.exe'])
                : copy('cancellable')}
            </p>
          </div>
        )}
      </div>
    </Dialog>
  )
}
