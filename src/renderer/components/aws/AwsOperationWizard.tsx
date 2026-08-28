import { useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  AwsWizardDefinition,
  AwsWizardFieldDefinition,
  AwsWizardPortableProjection,
  AwsWizardValidationIssue
} from '@shared/aws-wizard'
import {
  parseAwsWizardAdvanced,
  projectAwsWizardPortableIntent,
  serializeAwsWizardValue,
  validateAwsWizardValue
} from '@shared/aws-wizard'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'

export interface AwsOperationWizardProps {
  definition: AwsWizardDefinition
  initialValue?: unknown
  onSubmit?: (value: Record<string, unknown>, portable: AwsWizardPortableProjection) => void
  onCancel?: () => void
}

type ValueRecord = Record<string, unknown>

function objectValue(value: unknown): ValueRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ValueRecord : {}
}

function defaultValue(field: AwsWizardFieldDefinition): unknown {
  switch (field.kind) {
    case 'structure':
    case 'union':
    case 'map': return {}
    case 'list': return []
    case 'boolean': return false
    case 'document': return null
    case 'file': return { kind: 'local-file', path: '', name: '' }
    default: return ''
  }
}

function optionCorpus(field: AwsWizardFieldDefinition): string {
  return [field.name, field.documentation, ...field.enumValues].join(' ')
}

interface FieldEditorProps {
  field: AwsWizardFieldDefinition
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}

function FieldEditor({ field, value, onChange, disabled = false }: FieldEditorProps): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const enumSearch = useRegexSearchField()
  const enumSearchRef = useRef<HTMLInputElement>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const visibleOptions = useMemo(
    () => field.enumValues.filter((option) => enumSearch.test(`${option} ${field.documentation}`)),
    [enumSearch, field.enumValues, field.documentation]
  )
  const current = value === undefined || value === null ? '' : value
  const label = field.required ? `${field.name} *` : field.name
  const descriptionId = `${field.id.replace(/[^a-zA-Z0-9_-]/g, '-')}-description`

  if (field.kind === 'unsupported') {
    return (
      <fieldset className="aws-wizard__field aws-wizard__field--unsupported" disabled>
        <legend>{label}</legend>
        <p id={descriptionId}>{field.disabledReason ?? vocab('This modeled control is unavailable.')}</p>
      </fieldset>
    )
  }

  if (field.kind === 'structure' || field.kind === 'union') {
    const record = objectValue(value)
    const activeUnionKey = field.kind === 'union' ? Object.keys(record)[0] : null
    return (
      <fieldset className={`aws-wizard__field aws-wizard__field--${field.kind}`} disabled={disabled}>
        <legend>{label}</legend>
        {field.documentation && <p id={descriptionId} className="aws-wizard__description">{field.documentation}</p>}
        {field.kind === 'union' && (
          <div className="aws-wizard__union-choices" role="radiogroup" aria-label={vocab(`Choose one ${field.name} option`)}>
            {field.children.map((child) => (
              <Button
                key={child.id}
                type="button"
                variant={activeUnionKey === child.name ? 'primary' : 'default'}
                aria-pressed={activeUnionKey === child.name}
                onClick={() => onChange({ [child.name]: defaultValue(child) })}
              >
                {child.name}
              </Button>
            ))}
          </div>
        )}
        <div className="aws-wizard__children">
          {field.children.map((child) => {
            if (field.kind === 'union' && activeUnionKey !== child.name) return null
            return (
              <FieldEditor
                key={child.id}
                field={child}
                value={record[child.name]}
                onChange={(next) => onChange({ ...record, [child.name]: next })}
                disabled={disabled}
              />
            )
          })}
        </div>
      </fieldset>
    )
  }

  if (field.kind === 'list') {
    const items = Array.isArray(value) ? value : []
    return (
      <fieldset className="aws-wizard__field aws-wizard__collection" disabled={disabled}>
        <legend>{label}</legend>
        {field.documentation && <p id={descriptionId} className="aws-wizard__description">{field.documentation}</p>}
        <div className="aws-wizard__collection-items">
          {items.map((item, index) => (
            <div className="aws-wizard__collection-row" key={`${field.id}-${index}`}>
              {field.item && <FieldEditor field={field.item} value={item} onChange={(next) => onChange(items.map((entry, i) => i === index ? next : entry))} disabled={disabled} />}
              <Button type="button" variant="ghost" onClick={() => onChange(items.filter((_, i) => i !== index))}>{vocab('Remove item')}</Button>
            </div>
          ))}
        </div>
        <Button type="button" onClick={() => onChange([...items, field.item ? defaultValue(field.item) : null])} disabled={field.max !== null && items.length >= field.max}>{vocab('Add item')}</Button>
        {field.min !== null && <small>{vocab(`At least ${field.min} item(s) required.`)}</small>}
        {field.max !== null && <small>{vocab(`At most ${field.max} item(s) allowed.`)}</small>}
      </fieldset>
    )
  }

  if (field.kind === 'map') {
    const entries = Object.entries(objectValue(value))
    return (
      <fieldset className="aws-wizard__field aws-wizard__collection" disabled={disabled}>
        <legend>{label}</legend>
        {field.documentation && <p id={descriptionId} className="aws-wizard__description">{field.documentation}</p>}
        {entries.map(([key, entryValue], index) => (
          <div className="aws-wizard__collection-row aws-wizard__map-row" key={`${field.id}-${index}`}>
            <label>{vocab('Map key')}<Input value={key} onChange={(event) => {
              const next = { ...objectValue(value) }
              delete next[key]
              next[event.target.value] = entryValue
              onChange(next)
            }} /></label>
            {field.mapValue && <FieldEditor field={field.mapValue} value={entryValue} onChange={(next) => onChange({ ...objectValue(value), [key]: next })} disabled={disabled} />}
            <Button type="button" variant="ghost" onClick={() => {
              const next = { ...objectValue(value) }
              delete next[key]
              onChange(next)
            }}>{vocab('Remove entry')}</Button>
          </div>
        ))}
        <Button type="button" onClick={() => {
          const next = { ...objectValue(value) }
          let key = 'key'
          let suffix = 1
          while (Object.prototype.hasOwnProperty.call(next, key)) key = `key-${suffix++}`
          next[key] = field.mapValue ? defaultValue(field.mapValue) : null
          onChange(next)
        }} disabled={field.max !== null && entries.length >= field.max}>{vocab('Add map entry')}</Button>
      </fieldset>
    )
  }

  if (field.kind === 'document') {
    return (
      <label className="aws-wizard__field aws-wizard__scalar">
        <span>{label}</span>
        {field.documentation && <small id={descriptionId}>{field.documentation}</small>}
        <textarea
          className="aws-wizard__document"
          value={JSON.stringify(value ?? null, null, 2)}
          aria-describedby={descriptionId}
          disabled={disabled}
          onChange={(event) => {
            try { onChange(JSON.parse(event.target.value)) } catch { /* Keep the last valid value until the advanced editor is used. */ }
          }}
        />
      </label>
    )
  }

  if (field.kind === 'enum') {
    return (
      <fieldset className="aws-wizard__field aws-wizard__scalar" disabled={disabled}>
        <legend>{label}</legend>
        {field.documentation && <small id={descriptionId}>{field.documentation}</small>}
        <div className="aws-wizard__search-row">
          <Input ref={enumSearchRef} value={enumSearch.value} onChange={(event) => enumSearch.setValue(event.target.value)} placeholder={vocab('Search modeled choices')} aria-label={vocab(`Search choices for ${field.name}`)} />
          <AnchoredRegexBuilder search={enumSearch} fieldRef={enumSearchRef} label={vocab(`Regex for ${field.name} choices`)} />
        </div>
        {enumSearch.error && <p role="alert">{enumSearch.error}</p>}
        <select value={typeof current === 'string' ? current : ''} aria-describedby={descriptionId} onChange={(event) => onChange(event.target.value)}>
          <option value="">{vocab('Choose a modeled value')}</option>
          {visibleOptions.map((option) => <option value={option} key={option}>{option}</option>)}
        </select>
      </fieldset>
    )
  }

  if (field.kind === 'boolean') {
    return (
      <label className="aws-wizard__switch">
        <input type="checkbox" checked={value === true} disabled={disabled} aria-describedby={descriptionId} onChange={(event) => onChange(event.target.checked)} />
        <span>{label}</span>
        {field.documentation && <small id={descriptionId}>{field.documentation}</small>}
      </label>
    )
  }

  if (field.kind === 'file') {
    const file = objectValue(value)
    return (
      <div className="aws-wizard__field aws-wizard__file">
        <span>{label}</span>
        {field.documentation && <small id={descriptionId}>{field.documentation}</small>}
        <Button type="button" disabled={disabled} onClick={() => {
          setFileError(null)
          void window.nodeTerminal.dialog.selectFile().then((path) => {
            if (path) onChange({ kind: 'local-file', path, name: path.split(/[\\/]/).pop() ?? '' })
          }).catch(() => setFileError(vocab('The local file picker was unavailable. Choose a file again.')))
        }}>{typeof file.name === 'string' && file.name ? file.name : vocab('Choose local file')}</Button>
        {fileError && <p role="alert">{fileError}</p>}
      </div>
    )
  }

  const inputType = field.kind === 'date' || field.kind === 'time' || field.kind === 'date-time' ? field.kind === 'date-time' ? 'datetime-local' : field.kind : field.kind === 'number' ? 'number' : 'text'
  return (
    <label className="aws-wizard__field aws-wizard__scalar">
      <span>{label}</span>
      {field.documentation && <small id={descriptionId}>{field.documentation}</small>}
      <Input
        type={inputType}
        value={String(current)}
        min={field.kind === 'number' && field.min !== null ? field.min : undefined}
        max={field.kind === 'number' && field.max !== null ? field.max : undefined}
        step={field.kind === 'number' ? field.integer ? 1 : 'any' : undefined}
        aria-describedby={descriptionId}
        onChange={(event) => onChange(field.kind === 'number' ? event.target.value : event.target.value)}
        disabled={disabled}
      />
    </label>
  )
}

function issuesText(issues: readonly AwsWizardValidationIssue[]): ReactNode {
  if (!issues.length) return null
  return <ul className="aws-wizard__issues" role="alert">{issues.map((entry, index) => <li key={`${entry.path}-${index}`}><strong>{entry.path}</strong>: {entry.message}</li>)}</ul>
}

export function AwsOperationWizard({ definition, initialValue, onSubmit, onCancel }: AwsOperationWizardProps): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const initialValidation = validateAwsWizardValue(definition, initialValue ?? {})
  const [value, setValue] = useState<unknown>(initialValidation.value ?? {})
  const [query, setQuery] = useState('')
  const [advancedFormat, setAdvancedFormat] = useState<'json' | 'yaml'>('json')
  const [jsonText, setJsonText] = useState(() => serializeAwsWizardValue(initialValidation.value ?? {}, 'json'))
  const [yamlText, setYamlText] = useState(() => serializeAwsWizardValue(initialValidation.value ?? {}, 'yaml'))
  const [advancedError, setAdvancedError] = useState<string | null>(null)
  const [advancedIssues, setAdvancedIssues] = useState<AwsWizardValidationIssue[]>(initialValidation.issues)
  const [submittedIssues, setSubmittedIssues] = useState<AwsWizardValidationIssue[]>([])
  const search = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)
  const root = definition.root
  const rootRecord = objectValue(value)
  const visibleChildren = root.children.filter((field) => search.test(optionCorpus(field)))
  const updateFromForm = (next: unknown): void => {
    setValue(next)
    setJsonText(serializeAwsWizardValue(next, 'json'))
    setYamlText(serializeAwsWizardValue(next, 'yaml'))
    setAdvancedError(null)
    setAdvancedIssues([])
    setSubmittedIssues([])
  }
  const updateAdvanced = (text: string, format: 'json' | 'yaml'): void => {
    if (format === 'json') setJsonText(text)
    else setYamlText(text)
    try {
      const result = parseAwsWizardAdvanced(definition, text, format)
      if (!result.ok) {
        setAdvancedError(null)
        setAdvancedIssues(result.issues)
        return
      }
      setAdvancedError(null)
      setAdvancedIssues([])
      setSubmittedIssues([])
      setValue(result.value)
      const serializedJson = serializeAwsWizardValue(result.value, 'json')
      const serializedYaml = serializeAwsWizardValue(result.value, 'yaml')
      // Keep the editor the user is typing in exactly as entered, so a valid keystroke does not
      // move the caret to the end. The other representation is refreshed immediately, preserving
      // bidirectional JSON/YAML synchronization without turning the advanced view into a jumpy
      // formatter.
      if (format === 'json') setYamlText(serializedYaml)
      else setJsonText(serializedJson)
    } catch (error) {
      setAdvancedIssues([])
      setAdvancedError(error instanceof Error ? error.message : vocab('Advanced input could not be read.'))
    }
  }
  const submit = (): void => {
    const result = validateAwsWizardValue(definition, value)
    setSubmittedIssues(result.issues)
    if (!result.ok || !result.value || typeof result.value !== 'object' || Array.isArray(result.value)) return
    onSubmit?.(result.value as Record<string, unknown>, projectAwsWizardPortableIntent(definition, result.value))
  }

  return (
    <section className="md3-dialog aws-wizard" role="dialog" aria-label={`${definition.serviceId} ${definition.commandName} wizard`}>
      <header className="aws-wizard__header">
        <h2>{definition.serviceId} · {definition.commandName}</h2>
        <p>{vocab('Choose typed values for this modeled operation. Advanced edits stay synchronized with the guided controls.')}</p>
      </header>
      <div className="aws-wizard__search-row">
        <Input ref={searchRef} value={search.value} onChange={(event) => search.setValue(event.target.value)} placeholder={vocab('Search operation fields')} aria-label={vocab('Search operation fields')} />
        <AnchoredRegexBuilder search={search} fieldRef={searchRef} label={vocab('Regex for operation fields')} />
      </div>
      {search.error && <p role="alert">{search.error}</p>}
      <div className="aws-wizard__body">
        <div className="aws-wizard__guided" aria-label={vocab('Guided controls')}>
          {visibleChildren.map((field) => <FieldEditor key={field.id} field={field} value={rootRecord[field.name]} onChange={(next) => updateFromForm({ ...rootRecord, [field.name]: next })} />)}
          {!visibleChildren.length && <p>{vocab('No operation fields match this search.')}</p>}
        </div>
        <section className="aws-wizard__advanced" aria-label={vocab('Advanced synchronized editor')}>
          <div className="aws-wizard__tabs" role="tablist" aria-label={vocab('Advanced format')}>
            {(['json', 'yaml'] as const).map((format) => <Button key={format} type="button" role="tab" aria-selected={advancedFormat === format} variant={advancedFormat === format ? 'primary' : 'default'} onClick={() => setAdvancedFormat(format)}>{format.toUpperCase()}</Button>)}
          </div>
          <textarea className="aws-wizard__advanced-editor" value={advancedFormat === 'json' ? jsonText : yamlText} aria-label={vocab(`Advanced ${advancedFormat} editor`)} onChange={(event) => updateAdvanced(event.target.value, advancedFormat)} />
          {advancedError && <p role="alert">{advancedError}</p>}
          {issuesText(advancedIssues)}
        </section>
      </div>
      {issuesText(submittedIssues)}
      <footer className="md3-dialog__actions">
        {onCancel && <Button type="button" onClick={onCancel}>{vocab('Cancel')}</Button>}
        <Button type="button" variant="primary" onClick={submit}>{vocab('Review operation')}</Button>
      </footer>
    </section>
  )
}
