import { useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { AwsWizardField, AwsWizardSchema, AwsWizardSpec } from '@shared/aws-wizard'
import {
  defaultAwsWizardSpec,
  defaultAwsWizardValue,
  parseAwsWizardJson,
  parseAwsWizardYaml,
  serializeAwsWizardJson,
  serializeAwsWizardYaml,
  validateAwsWizardValues
} from '@shared/aws-wizard'
import type { CanvasNode } from '../state/workspace'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '@renderer/lib/regex/useRegexSearchField'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { Switch } from '../ui/Switch'
import { Button, IconButton, Tablist, TextArea } from '../ui/md3'
import { MaterialSymbol } from '../components/MaterialSymbol'
import { useI18n } from '../lib/i18n'

type PathPart = string | number

function atPath(value: unknown, path: PathPart[]): unknown {
  let current = value
  for (const part of path) {
    if (typeof part === 'number' && Array.isArray(current)) current = current[part]
    else if (typeof part === 'string' && current && typeof current === 'object') current = (current as Record<string, unknown>)[part]
    else return undefined
  }
  return current
}

function withPath(value: unknown, path: PathPart[], next: unknown): unknown {
  if (path.length === 0) return next
  const [head, ...tail] = path
  if (typeof head === 'number') {
    const list = Array.isArray(value) ? [...value] : []
    list[head] = withPath(list[head], tail, next)
    return list
  }
  const object = value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
  object[head] = withPath(object[head], tail, next)
  return object
}

function pathText(path: PathPart[]): string {
  return path.map((part) => typeof part === 'number' ? `[${part}]` : part).join('.').replace('.[', '[')
}

function fieldHasMatch(field: AwsWizardField, search: (text: string) => boolean): boolean {
  if (search(field.label) || search(field.description ?? '')) return true
  if (field.kind === 'object') return Object.values(field.properties).some((child) => fieldHasMatch(child, search))
  if (field.kind === 'array') return fieldHasMatch(field.items, search)
  if (field.kind === 'map') return fieldHasMatch(field.values, search)
  if (field.kind === 'enum') return field.options.some((option) => search(option.label) || search(option.value))
  return false
}

function errorFor(path: PathPart[], errors: { path: string; message: string }[]): string | undefined {
  const key = pathText(path)
  return errors.find((error) => error.path === key)?.message
}

interface FieldProps {
  field: AwsWizardField
  path: PathPart[]
  values: unknown
  setValue: (path: PathPart[], value: unknown) => void
  setLocalFile: (path: PathPart[], file: string | undefined) => void
  localFiles: Record<string, string>
  errors: { path: string; message: string }[]
  matches: (text: string) => boolean
}

function EnumFieldEditor({ field, path, value, setValue, error }: {
  field: Extract<AwsWizardField, { kind: 'enum' }>
  path: PathPart[]
  value: unknown
  setValue: (path: PathPart[], value: unknown) => void
  error?: string
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const optionSearch = useRegexSearchField({ mode: 'text' })
  const options = field.options.filter((option) => optionSearch.test(`${option.label} ${option.value}`))
  return (
    <label className="aws-wizard__field">
      <span className="aws-wizard__label">{field.label}</span>
      {field.description && <span className="aws-wizard__description">{field.description}</span>}
      <div className="aws-wizard__enum-search menu-filter__row">
        <Input ref={inputRef} value={optionSearch.value} onChange={(event) => optionSearch.setValue(event.target.value)} placeholder="Search options…" aria-label={`Search ${field.label} options`} />
        <AnchoredRegexBuilder search={optionSearch} fieldRef={inputRef} label={`Regex builder for ${field.label} options`} zIndex={90} />
      </div>
      <Select value={typeof value === 'string' ? value : ''} onChange={(event) => setValue(path, event.target.value)} aria-label={field.label}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Select>
      {options.length === 0 && <span className="aws-wizard__empty">No options match this filter.</span>}
      {error && <span className="aws-wizard__error" role="alert">{error}</span>}
    </label>
  )
}

function FieldEditor({ field, path, values, setValue, setLocalFile, localFiles, errors, matches }: FieldProps): React.JSX.Element | null {
  const value = atPath(values, path)
  const key = pathText(path)
  const ownMatch = matches(field.label) || matches(field.description ?? '')
  const nestedMatch = fieldHasMatch(field, matches)
  if (!ownMatch && !nestedMatch) return null
  const error = errorFor(path, errors)
  const label = <span className="aws-wizard__label">{field.label}</span>
  const description = field.description ? <span className="aws-wizard__description">{field.description}</span> : null
  const feedback = error ? <span className="aws-wizard__error" role="alert">{error}</span> : null

  if (field.kind === 'object') {
    return (
      <fieldset className="aws-wizard__object">
        <legend>{field.label}</legend>
        {description}
        <div className="aws-wizard__children">
          {Object.entries(field.properties).map(([childKey, child]) => (
            <FieldEditor key={childKey} field={child} path={[...path, childKey]} values={values} setValue={setValue} setLocalFile={setLocalFile} localFiles={localFiles} errors={errors} matches={matches} />
          ))}
        </div>
      </fieldset>
    )
  }

  if (field.kind === 'array') {
    const items = Array.isArray(value) ? value : []
    const max = Math.min(100, field.maxItems ?? 100)
    return (
      <fieldset className="aws-wizard__collection">
        <legend>{field.label}</legend>
        {description}
        {items.map((_, index) => (
          <div className="aws-wizard__collection-row" key={`${key}-${index}`}>
            <FieldEditor field={field.items} path={[...path, index]} values={values} setValue={setValue} setLocalFile={setLocalFile} localFiles={localFiles} errors={errors} matches={() => true} />
            <Button variant="text" size="small" className="aws-wizard__remove nodrag" onClick={() => setValue(path, items.filter((__, i) => i !== index))} aria-label={`Remove ${field.label} item ${index + 1}`}>Remove</Button>
          </div>
        ))}
        {items.length === 0 && <p className="aws-wizard__empty">No items yet. Add one to start this repeatable list.</p>}
        <Button variant="tonal" size="small" className="nodrag" disabled={items.length >= max} title={items.length >= max ? `This list is limited to ${max} items.` : undefined} onClick={() => setValue(path, [...items, defaultAwsWizardValue(field.items)])}>Add item</Button>
        {feedback}
      </fieldset>
    )
  }

  if (field.kind === 'map') {
    const entries = value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value as Record<string, unknown>) : []
    const max = Math.min(100, field.maxEntries ?? 100)
    return (
      <fieldset className="aws-wizard__collection">
        <legend>{field.label}</legend>
        {description}
        {entries.map(([entryKey, entryValue]) => (
          <div className="aws-wizard__map-row" key={`${key}-${entryKey}`}>
            <Input value={entryKey} aria-label={`${field.label} key`} onChange={(event) => {
              const nextKey = event.target.value
              if (!/^[A-Za-z0-9_.:-]{0,128}$/.test(nextKey) || nextKey === '__proto__' || nextKey === 'constructor') return
              const next = { ...(value as Record<string, unknown>) }
              delete next[entryKey]
              if (nextKey) next[nextKey] = entryValue
              setValue(path, next)
            }} placeholder="Key" />
            <FieldEditor field={field.values} path={[...path, entryKey]} values={values} setValue={setValue} setLocalFile={setLocalFile} localFiles={localFiles} errors={errors} matches={() => true} />
            <Button variant="text" size="small" className="aws-wizard__remove nodrag" onClick={() => {
              const next = { ...(value as Record<string, unknown>) }
              delete next[entryKey]
              setValue(path, next)
            }} aria-label={`Remove ${field.label} entry ${entryKey}`}>Remove</Button>
          </div>
        ))}
        {entries.length === 0 && <p className="aws-wizard__empty">No entries yet. Add a key and value to start this map.</p>}
        <Button variant="tonal" size="small" className="nodrag" disabled={entries.length >= max} title={entries.length >= max ? `This map is limited to ${max} entries.` : undefined} onClick={() => setValue(path, { ...(value as Record<string, unknown>), [`key${entries.length + 1}`]: defaultAwsWizardValue(field.values) })}>Add entry</Button>
        {feedback}
      </fieldset>
    )
  }

  if (field.kind === 'enum') {
    return <EnumFieldEditor field={field} path={path} value={value} setValue={setValue} error={error} />
  }

  if (field.kind === 'boolean') {
    return <div className="aws-wizard__field aws-wizard__switch-field">{label}{description}<Switch checked={value === true} onChange={(next) => setValue(path, next)} ariaLabel={field.label} />{feedback}</div>
  }

  if (field.kind === 'file') {
    return (
      <div className="aws-wizard__field">
        {label}{description}
        <div className="aws-wizard__file-row">
          <Input value={localFiles[key] ?? ''} readOnly placeholder="No local file selected" aria-label={`${field.label} path`} />
          <Button variant="tonal" size="small" className="nodrag" onClick={async () => {
            const selected = await window.nodeTerminal.dialog.selectFile()
            if (selected) { setLocalFile(path, selected); setValue(path, '__local_file__') }
          }}>Browse…</Button>
          <Button variant="text" size="small" className="nodrag" disabled={!localFiles[key]} onClick={() => { setLocalFile(path, undefined); setValue(path, '') }}>Clear</Button>
        </div>
        {feedback}
      </div>
    )
  }

  const inputType = field.kind === 'date' ? 'date' : field.kind === 'time' ? 'time' : field.kind === 'date-time' ? 'datetime-local' : field.kind === 'number' || field.kind === 'integer' ? 'number' : 'text'
  return (
    <label className="aws-wizard__field">
      {label}{description}
      <Input type={inputType} value={typeof value === 'number' ? value : typeof value === 'string' ? value : ''} min={field.min} max={field.max} step={field.step ?? (field.kind === 'integer' ? 1 : undefined)} maxLength={field.maxLength} onChange={(event) => {
        if (field.kind === 'number' || field.kind === 'integer') setValue(path, event.target.value === '' ? '' : Number(event.target.value))
        else setValue(path, event.target.value)
      }} aria-label={field.label} />
      {(field.min !== undefined || field.max !== undefined) && <span className="aws-wizard__bounds">Allowed range: {field.min ?? 'no minimum'} to {field.max ?? 'no maximum'}.</span>}
      {feedback}
    </label>
  )
}

export default function AwsWizardNode({ id, data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const { deleteElements, updateNodeData } = useReactFlow()
  const fallback = defaultAwsWizardSpec()
  const spec = (data.awsWizardSpec as AwsWizardSpec | undefined) ?? fallback
  const schema: AwsWizardSchema = spec.schema ?? fallback.schema
  const values = spec.values ?? (defaultAwsWizardValue(schema.input) as Record<string, unknown>)
  const localFiles = (data.awsWizardFiles as Record<string, string> | undefined) ?? {}
  const headerFill = nodeHeaderFillStyle(data.color)
  const { mode } = useI18n()
  const ui = (en: string, yue: string): string => mode === 'yue' ? yue : mode === 'bilingual' ? `${en} · ${yue}` : en
  const search = useRegexSearchField({ mode: 'text' })
  const inputRef = useRef<HTMLInputElement>(null)
  const [advancedMode, setAdvancedMode] = useState<'json' | 'yaml'>('json')
  const [advancedDraft, setAdvancedDraft] = useState<string | null>(null)
  const [advancedError, setAdvancedError] = useState<string | null>(null)

  const errors = useMemo(() => validateAwsWizardValues(schema, values), [schema, values])
  const advancedText = advancedDraft ?? (advancedMode === 'json' ? serializeAwsWizardJson(values) : serializeAwsWizardYaml(values))
  const patchValues = (next: unknown): void => {
    if (!next || typeof next !== 'object' || Array.isArray(next)) return
    updateNodeData(id, { awsWizardSpec: { schema, values: next } })
    setAdvancedDraft(null)
    setAdvancedError(null)
  }
  const setValue = (path: PathPart[], next: unknown): void => patchValues(withPath(values, path, next))
  const setLocalFile = (path: PathPart[], file: string | undefined): void => {
    const next = { ...localFiles }
    const key = pathText(path)
    if (file) next[key] = file
    else delete next[key]
    updateNodeData(id, { awsWizardFiles: next })
  }
  const applyAdvanced = (): void => {
    try {
      const next = advancedMode === 'json' ? parseAwsWizardJson(advancedText) : parseAwsWizardYaml(advancedText)
      const nextErrors = validateAwsWizardValues(schema, next)
      if (nextErrors.length) throw new Error(`${nextErrors.length} value${nextErrors.length === 1 ? '' : 's'} do not match the schema. First issue: ${nextErrors[0]!.path} ${nextErrors[0]!.message}`)
      patchValues(next)
    } catch (error) {
      setAdvancedError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className={`term-node aws-wizard-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }}>
      <NodeResizer minWidth={520} minHeight={520} isVisible={selected} color={data.color} />
      <div className={`term-node__header ${headerFill.className}${headerFill.filled ? ' term-node__header--filled' : ''}`} style={headerFill.style}>
        <MaterialSymbol name="database" label={ui('AWS wizard', 'AWS 精靈')} />
        <EditableNodeTitle value={data.title} onChange={(next) => updateNodeData(id, { title: next })} emptyLabel={ui('AWS request wizard', 'AWS 請求精靈')} title={ui('Click to rename', '撳一下改名')} ariaLabel={ui('AWS request wizard name', 'AWS 請求精靈名稱')} rejectEmpty={false} />
        <span className="term-node__spacer" />
        <IconButton className="term-node__close nodrag" title="Close" aria-label="Close AWS request wizard" onClick={() => deleteElements({ nodes: [{ id }] })}>×</IconButton>
      </div>
      <div className="aws-wizard__body nodrag nowheel">
        <div className="aws-wizard__intro"><strong>{schema.service} · {schema.operation}</strong><span>{schema.description}</span><span className="aws-wizard__offline-note">{ui('Review only. This wizard never executes an AWS request.', '只供檢視，呢個精靈唔會執行 AWS 請求。')}</span></div>
        <div className="aws-wizard__search menu-filter">
          <div className="menu-filter__row"><Input ref={inputRef} value={search.value} onChange={(event) => search.setValue(event.target.value)} placeholder={search.mode === 'regex' ? ui('Filter fields… (regex)', '篩選欄位…（正則表達式）') : ui('Filter fields…', '篩選欄位…')} aria-label={ui('Search AWS wizard fields', '搜尋 AWS 精靈欄位')} /><AnchoredRegexBuilder search={search} fieldRef={inputRef} label={ui('Regex builder for AWS wizard fields', 'AWS 精靈欄位正則表達式建立器')} zIndex={90} /></div>
          {search.error && <span className="aws-wizard__error">{search.error}</span>}
        </div>
        <Tablist className="aws-wizard__tabs" ariaLabel={ui('AWS wizard views', 'AWS 精靈檢視')}>
          <Button variant={advancedMode === 'json' ? 'tonal' : 'text'} size="small" role="tab" aria-selected={advancedMode === 'json'} className={`nodrag ${advancedMode === 'json' ? 'is-active' : ''}`} onClick={() => { setAdvancedMode('json'); setAdvancedDraft(null); setAdvancedError(null) }}>{ui('Typed controls + JSON', '類型控制 + JSON')}</Button>
          <Button variant={advancedMode === 'yaml' ? 'tonal' : 'text'} size="small" role="tab" aria-selected={advancedMode === 'yaml'} className={`nodrag ${advancedMode === 'yaml' ? 'is-active' : ''}`} onClick={() => { setAdvancedMode('yaml'); setAdvancedDraft(null); setAdvancedError(null) }}>{ui('Typed controls + YAML', '類型控制 + YAML')}</Button>
        </Tablist>
        <div className="aws-wizard__editor-grid">
          <div className="aws-wizard__typed" role="tabpanel">
            <FieldEditor field={schema.input} path={[]} values={values} setValue={setValue} setLocalFile={setLocalFile} localFiles={localFiles} errors={errors} matches={search.test} />
          </div>
          <div className="aws-wizard__advanced" role="tabpanel">
            <label className="aws-wizard__field"><span className="aws-wizard__label">Advanced {advancedMode.toUpperCase()}</span><TextArea className="nodrag nowheel" value={advancedText} onChange={(event) => { setAdvancedDraft(event.target.value); setAdvancedError(null) }} aria-label={`Advanced ${advancedMode} request view`} spellCheck={false} /></label>
            {advancedError && <div className="aws-wizard__error" role="alert">{advancedError}</div>}
            <Button variant="filled" size="small" className="nodrag" onClick={applyAdvanced}>{ui('Apply', '套用')} {advancedMode.toUpperCase()}</Button>
            <span className="aws-wizard__advanced-note">{ui('Applying validates the complete object against the same schema as the typed controls. Local file paths remain machine-local.', '套用前會用同一份結構驗證完整物件，本機檔案路徑只留喺本機。')}</span>
          </div>
        </div>
        <div className={`aws-wizard__status ${errors.length ? 'is-invalid' : 'is-valid'}`} role="status">
          {errors.length ? (mode === 'yue' ? `${errors.length} 個欄位要留意。` : mode === 'bilingual' ? `${errors.length} field${errors.length === 1 ? '' : 's'} need attention. · ${errors.length} 個欄位要留意。` : `${errors.length} field${errors.length === 1 ? '' : 's'} need attention.`) : ui('All entered values match the schema.', '已輸入值全部符合結構。')}
        </div>
      </div>
    </div>
  )
}
