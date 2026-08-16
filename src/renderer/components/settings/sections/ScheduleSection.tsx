import { useState } from 'react'
import { useSettings } from '../../../state/settings'
import { useScheduledSettings } from '../../../state/scheduledSettings'
import { DEFAULT_SETTINGS } from '@shared/types'
import {
  newScheduleRule,
  validateScheduleWindow,
  type ScheduleRule,
  type ScheduleSource,
  type ScheduleWindow,
  type ScheduledSettingsFile,
  type ScheduledSettingsSourceStatus,
  type SchedulableSettingKey,
  type SchedulableSettingsPatch,
  type Weekday
} from '@shared/scheduled-settings'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'
import { Select } from '@renderer/ui/Select'
import { Switch } from '@renderer/ui/Switch'
import { ThemeSelect } from '../ThemeSelect'
import { uuid } from '@renderer/lib/uuid'
import { cn } from '@renderer/ui/cn'

const ROWS = {
  timezone: { title: 'Timezone', keywords: ['timezone', 'zone', 'clock', 'dst', 'daylight'] },
  rules: {
    title: 'Rules',
    keywords: [
      'schedule',
      'rule',
      'automation',
      'appearance',
      'theme',
      'dark mode',
      'light mode',
      'home assistant',
      'api',
      'time',
      'date'
    ]
  }
}
const ENTRIES = Object.values(ROWS)

function relativeTime(ms: number): string {
  const diff = Math.max(0, Date.now() - ms)
  const s = Math.round(diff / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

function Labeled({
  label,
  hint,
  error,
  children
}: {
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="min-w-0 space-y-1">
      <span className="block text-[12px] font-medium text-muted">{label}</span>
      {children}
      {error ? (
        <p className="text-[11px] leading-snug text-[color:var(--warn)]">{error}</p>
      ) : hint ? (
        <p className="text-[11px] leading-snug text-muted-2">{hint}</p>
      ) : null}
    </div>
  )
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY_FULL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
]

/** Every day is one value ('every-day'), never seven duplicated rules — see
 *  ScheduleWindow's doc. Toggling it OFF seeds Mon–Fri as a friendlier starting point than an
 *  empty (never-active) selection. */
function WeekdayPicker({
  days,
  onChange
}: {
  days: 'every-day' | Weekday[]
  onChange: (days: 'every-day' | Weekday[]) => void
}): React.JSX.Element {
  const everyDay = days === 'every-day'
  // Narrows directly off `days` (not off the `everyDay` alias) so this doesn't depend on
  // TypeScript's aliased-condition narrowing — a plain, unambiguous discriminant check.
  const selected: Weekday[] = days === 'every-day' ? [] : days
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-[13px] text-text">
        <Switch
          checked={everyDay}
          onChange={(v) => onChange(v ? 'every-day' : [1, 2, 3, 4, 5])}
          ariaLabel="Every day"
        />
        Every day
      </label>
      {!everyDay && (
        <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Weekdays">
            {WEEKDAY_SHORT.map((label, idx) => {
              const day = idx as Weekday
              const checked = selected.includes(day)
              return (
                <button
                  key={day}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={WEEKDAY_FULL[day]}
                  onClick={() =>
                    onChange(
                      checked
                        ? selected.filter((d) => d !== day)
                        : [...selected, day].sort((a, b) => a - b)
                    )
                  }
                  className={cn(
                    'h-8 w-10 cursor-pointer rounded-md border text-[12px] font-medium outline-none transition-colors',
                    checked
                      ? 'border-accent bg-accent text-white'
                      : 'border-border bg-bg text-muted hover:text-text'
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
          {selected.length === 0 && (
            <p className="text-[12px] text-[color:var(--warn)]">
              No days selected — this rule can never become active.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function WindowEditor({
  window,
  onChange
}: {
  window: ScheduleWindow
  onChange: (w: ScheduleWindow) => void
}): React.JSX.Element {
  const errors = validateScheduleWindow(window)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Start date" hint="Optional — blank means no lower bound." error={errors.startDate}>
          <Input
            type="date"
            className="w-full"
            value={window.startDate ?? ''}
            onChange={(e) => onChange({ ...window, startDate: e.target.value || undefined })}
          />
        </Labeled>
        <Labeled
          label="End date"
          hint="Optional — blank means no upper bound."
          error={errors.endDate ?? errors.dateOrder}
        >
          <Input
            type="date"
            className="w-full"
            value={window.endDate ?? ''}
            onChange={(e) => onChange({ ...window, endDate: e.target.value || undefined })}
          />
        </Labeled>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Start time" hint="24-hour. Blank = start of day." error={errors.startTime}>
          <Input
            type="time"
            className="w-full"
            value={window.startTime ?? ''}
            onChange={(e) => onChange({ ...window, startTime: e.target.value || undefined })}
          />
        </Labeled>
        <Labeled
          label="End time"
          hint="24-hour. Blank = end of day. Earlier than start time = crosses midnight."
          error={errors.endTime}
        >
          <Input
            type="time"
            className="w-full"
            value={window.endTime ?? ''}
            onChange={(e) => onChange({ ...window, endTime: e.target.value || undefined })}
          />
        </Labeled>
      </div>
      <WeekdayPicker days={window.days} onChange={(days) => onChange({ ...window, days })} />
    </div>
  )
}

function StatusRow({
  label,
  status,
  onRetry
}: {
  label: string
  status: ScheduledSettingsSourceStatus | undefined
  onRetry: () => void
}): React.JSX.Element {
  const lastSuccess = status?.lastSuccessMs ? relativeTime(status.lastSuccessMs) : null
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg px-3 py-2">
      <div className="min-w-0 text-[12px] leading-snug">
        {status?.error ? (
          <p className="text-[color:var(--warn)]">
            {label} error: {status.error}
            {lastSuccess
              ? ` Still applying the value synced ${lastSuccess}.`
              : ' Nothing has synced yet, so this rule cannot apply.'}
          </p>
        ) : status?.ok ? (
          <p className="text-muted">
            {label} last synced {lastSuccess}.
          </p>
        ) : (
          <p className="text-muted">{label} has not been checked yet.</p>
        )}
      </div>
      <Button onClick={onRetry}>Retry</Button>
    </div>
  )
}

function SourceEditor({
  source,
  hasToken,
  status,
  onChange,
  onSetToken,
  onRetry
}: {
  source: ScheduleSource
  hasToken: boolean
  status: ScheduledSettingsSourceStatus | undefined
  onChange: (s: ScheduleSource) => void
  onSetToken: (token: string | null) => void
  onRetry: () => void
}): React.JSX.Element {
  const [tokenDraft, setTokenDraft] = useState('')
  return (
    <div className="space-y-3">
      <Labeled label="Value source">
        <Select
          className="w-full"
          value={source.kind}
          onChange={(e) => {
            const kind = e.target.value
            if (kind === 'api') onChange({ kind: 'api', url: '' })
            else if (kind === 'home-assistant') onChange({ kind: 'home-assistant', baseUrl: '', entityId: '' })
            else onChange({ kind: 'local' })
          }}
        >
          <option value="local">Local — apply the settings below whenever the window matches</option>
          <option value="api">HTTPS API — fetch the settings to apply from a URL</option>
          <option value="home-assistant">Home Assistant — gate this rule on a boolean entity</option>
        </Select>
      </Labeled>

      {source.kind === 'api' && (
        <>
          <Labeled
            label="API URL"
            hint={'Must return {"version":1,"settings":{...}} over HTTPS (or http://localhost for local development). See docs/scheduled-settings.md.'}
          >
            <Input
              className="w-full"
              placeholder="https://example.com/nodeterm-schedule.json"
              value={source.url}
              onChange={(e) => onChange({ ...source, url: e.target.value })}
            />
          </Labeled>
          <StatusRow label="API" status={status} onRetry={onRetry} />
        </>
      )}

      {source.kind === 'home-assistant' && (
        <>
          <Labeled label="Home Assistant base URL" hint="HTTPS (or http://localhost for local development).">
            <Input
              className="w-full"
              placeholder="https://homeassistant.example.com"
              value={source.baseUrl}
              onChange={(e) => onChange({ ...source, baseUrl: e.target.value })}
            />
          </Labeled>
          <Labeled
            label="Entity id"
            hint="A binary_sensor.* or input_boolean.* entity. ON activates this rule's settings; OFF leaves the base settings (or another matching rule) in effect."
          >
            <Input
              className="w-full"
              placeholder="input_boolean.evening_mode"
              value={source.entityId}
              onChange={(e) => onChange({ ...source, entityId: e.target.value })}
            />
          </Labeled>
          <Labeled
            label="Long-lived access token"
            hint={
              hasToken
                ? 'A token is saved for this rule (kept in the OS credential store; never shown again).'
                : 'No token saved yet — this rule cannot be checked without one.'
            }
          >
            <div className="flex gap-2">
              <Input
                type="password"
                className="w-full"
                placeholder={hasToken ? '••••••••••••' : 'Paste a Home Assistant long-lived access token'}
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
                autoComplete="off"
              />
              <Button
                disabled={!tokenDraft}
                onClick={() => {
                  onSetToken(tokenDraft)
                  setTokenDraft('')
                }}
              >
                Save
              </Button>
              {hasToken && (
                <Button variant="ghost" onClick={() => onSetToken(null)}>
                  Clear
                </Button>
              )}
            </div>
          </Labeled>
          <StatusRow label="Home Assistant" status={status} onRetry={onRetry} />
        </>
      )}
    </div>
  )
}

/** One row per schedulable setting the LOCAL editor offers a control for. `hiddenNodeMenuItems` /
 *  `hiddenHeaderButtons` are allowlisted for an `'api'` source (see
 *  shared/scheduled-settings.ts) but deliberately have no row here — a checkbox list of internal
 *  menu-item ids is the Appearance section's own bespoke picker, not something worth rebuilding a
 *  second time in this editor for v1. */
const VALUE_FIELDS: {
  key: SchedulableSettingKey
  label: string
  render: (value: unknown, onChange: (v: unknown) => void) => React.JSX.Element
}[] = [
  {
    key: 'appTheme',
    label: 'App appearance',
    render: (v, onChange) => (
      <Select className="w-40" value={(v as string) ?? 'auto'} onChange={(e) => onChange(e.target.value)}>
        <option value="auto">Auto</option>
        <option value="dark">Dark</option>
        <option value="light">Light</option>
      </Select>
    )
  },
  {
    key: 'accent',
    label: 'Accent colour',
    render: (v, onChange) => (
      <input
        type="color"
        aria-label="Accent colour"
        className="h-8 w-14 cursor-pointer rounded-md border border-border bg-bg p-0.5"
        value={(v as string) || DEFAULT_SETTINGS.accent}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  },
  {
    key: 'terminalTheme',
    label: 'Terminal colour theme',
    render: (v, onChange) => (
      <ThemeSelect value={(v as string) || DEFAULT_SETTINGS.terminalTheme} onChange={(id) => onChange(id)} />
    )
  },
  {
    key: 'fontFamily',
    label: 'Terminal font',
    render: (v, onChange) => (
      <Input className="w-64" value={(v as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
    )
  },
  {
    key: 'fontSize',
    label: 'Font size',
    render: (v, onChange) => (
      <Input
        type="number"
        min={6}
        max={96}
        className="w-20"
        value={(v as number) ?? DEFAULT_SETTINGS.fontSize}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    )
  },
  {
    key: 'fontWeight',
    label: 'Font weight',
    render: (v, onChange) => (
      <Input
        type="number"
        min={100}
        max={900}
        step={100}
        className="w-20"
        value={(v as number) ?? DEFAULT_SETTINGS.fontWeight}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    )
  },
  {
    key: 'fontWeightBold',
    label: 'Bold font weight',
    render: (v, onChange) => (
      <Input
        type="number"
        min={100}
        max={900}
        step={100}
        className="w-20"
        value={(v as number) ?? DEFAULT_SETTINGS.fontWeightBold}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    )
  },
  {
    key: 'drawBoldTextInBrightColors',
    label: 'Bold text uses bright colours',
    render: (v, onChange) => (
      <Switch
        checked={(v as boolean) ?? DEFAULT_SETTINGS.drawBoldTextInBrightColors}
        onChange={onChange}
        ariaLabel="Bold text uses bright colours"
      />
    )
  },
  {
    key: 'terminalMinContrast',
    label: 'Minimum contrast',
    render: (v, onChange) => (
      <Input
        type="number"
        min={1}
        max={21}
        step={0.5}
        className="w-20"
        value={(v as number) ?? DEFAULT_SETTINGS.terminalMinContrast}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    )
  },
  {
    key: 'cursorStyle',
    label: 'Cursor shape',
    render: (v, onChange) => (
      <Select className="w-32" value={(v as string) ?? 'block'} onChange={(e) => onChange(e.target.value)}>
        <option value="block">Block</option>
        <option value="bar">Bar</option>
        <option value="underline">Underline</option>
      </Select>
    )
  },
  {
    key: 'cursorInactiveStyle',
    label: 'Cursor shape (unfocused)',
    render: (v, onChange) => (
      <Select className="w-32" value={(v as string) ?? 'outline'} onChange={(e) => onChange(e.target.value)}>
        <option value="outline">Outline</option>
        <option value="block">Block</option>
        <option value="bar">Bar</option>
        <option value="underline">Underline</option>
        <option value="none">None</option>
      </Select>
    )
  },
  {
    key: 'cursorBlink',
    label: 'Cursor blink',
    render: (v, onChange) => (
      <Switch checked={(v as boolean) ?? DEFAULT_SETTINGS.cursorBlink} onChange={onChange} ariaLabel="Cursor blink" />
    )
  },
  {
    key: 'terminalLineHeight',
    label: 'Line height',
    render: (v, onChange) => (
      <Input
        type="number"
        min={0.5}
        max={3}
        step={0.05}
        className="w-20"
        value={(v as number) ?? DEFAULT_SETTINGS.terminalLineHeight}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    )
  },
  {
    key: 'terminalLetterSpacing',
    label: 'Letter spacing',
    render: (v, onChange) => (
      <Input
        type="number"
        min={-5}
        max={20}
        step={0.5}
        className="w-20"
        value={(v as number) ?? DEFAULT_SETTINGS.terminalLetterSpacing}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    )
  },
  {
    key: 'terminalGpuRendering',
    label: 'GPU rendering',
    render: (v, onChange) => (
      <Select className="w-28" value={(v as string) ?? 'auto'} onChange={(e) => onChange(e.target.value)}>
        <option value="auto">Auto</option>
        <option value="on">On</option>
        <option value="off">Off</option>
        <option value="shared">Shared</option>
      </Select>
    )
  }
]

function ValuesEditor({
  values,
  onChange
}: {
  values: SchedulableSettingsPatch
  onChange: (values: SchedulableSettingsPatch) => void
}): React.JSX.Element {
  const untyped = values as Record<string, unknown>
  return (
    <div className="space-y-2">
      {VALUE_FIELDS.map(({ key, label, render }) => {
        const included = key in untyped
        return (
          <div key={key} className="flex items-center gap-3">
            <input
              type="checkbox"
              className="size-4 shrink-0"
              checked={included}
              onChange={(e) => {
                const next = { ...untyped }
                if (e.target.checked) next[key] = DEFAULT_SETTINGS[key]
                else delete next[key]
                onChange(next as SchedulableSettingsPatch)
              }}
              aria-label={`Include ${label} in this rule`}
            />
            <span className={cn('w-48 shrink-0 text-[13px]', included ? 'text-text' : 'text-muted-2')}>
              {label}
            </span>
            <fieldset
              disabled={!included}
              className={cn('m-0 min-w-0 border-0 p-0', !included && 'opacity-40')}
            >
              {render(untyped[key] ?? DEFAULT_SETTINGS[key], (v) =>
                onChange({ ...untyped, [key]: v } as SchedulableSettingsPatch)
              )}
            </fieldset>
          </div>
        )
      })}
      {Object.keys(values).length === 0 && (
        <p className="text-[12px] text-muted-2">
          No settings selected yet — this rule would do nothing when active.
        </p>
      )}
    </div>
  )
}

function RuleCard({
  rule,
  index,
  count,
  isActive,
  hasToken,
  status,
  onPatch,
  onRemove,
  onMove,
  onSetToken,
  onRetry
}: {
  rule: ScheduleRule
  index: number
  count: number
  isActive: boolean
  hasToken: boolean
  status: ScheduledSettingsSourceStatus | undefined
  onPatch: (patch: Partial<ScheduleRule>) => void
  onRemove: () => void
  onMove: (delta: -1 | 1) => void
  onSetToken: (token: string | null) => void
  onRetry: () => void
}): React.JSX.Element {
  return (
    <div className="space-y-4 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Switch checked={rule.enabled} onChange={(v) => onPatch({ enabled: v })} ariaLabel="Enabled" />
        <Input
          className="min-w-0 flex-1"
          placeholder="Rule name"
          value={rule.label}
          onChange={(e) => onPatch({ label: e.target.value })}
          aria-label="Rule name"
        />
        {isActive && (
          <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
            Active now
          </span>
        )}
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label="Move rule up (higher precedence)"
            title="Move up — earlier rules win when more than one matches"
          >
            ↑
          </Button>
          <Button
            variant="ghost"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            aria-label="Move rule down (lower precedence)"
            title="Move down — earlier rules win when more than one matches"
          >
            ↓
          </Button>
          <Button variant="ghost" onClick={onRemove} aria-label={`Remove ${rule.label || 'rule'}`}>
            Remove
          </Button>
        </div>
      </div>

      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-2">When</p>
        <WindowEditor window={rule.window} onChange={(window) => onPatch({ window })} />
      </div>

      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-2">Source</p>
        <SourceEditor
          source={rule.source}
          hasToken={hasToken}
          status={status}
          onChange={(source) => onPatch({ source })}
          onSetToken={onSetToken}
          onRetry={onRetry}
        />
      </div>

      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-2">
          {rule.source.kind === 'api' ? 'Local fallback (before the first fetch)' : 'Apply while active'}
        </p>
        <ValuesEditor values={rule.values} onChange={(values) => onPatch({ values })} />
      </div>
    </div>
  )
}

export function ScheduleSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const file = useScheduledSettings((s) => s.file)
  const hydrated = useScheduledSettings((s) => s.hydrated)
  const loadError = useScheduledSettings((s) => s.loadError)
  const saveError = useScheduledSettings((s) => s.saveError)
  const active = useScheduledSettings((s) => s.active)
  const tokenStatus = useScheduledSettings((s) => s.tokenStatus)
  const update = useScheduledSettings((s) => s.update)
  const setHomeAssistantToken = useScheduledSettings((s) => s.setHomeAssistantToken)
  const refreshRule = useScheduledSettings((s) => s.refreshRule)
  const settingsHydrated = useSettings((s) => s.hydrated)

  const patchRule = (id: string, patch: Partial<ScheduleRule>): void => {
    const next: ScheduledSettingsFile = {
      ...file,
      rules: file.rules.map((r) => (r.id === id ? { ...r, ...patch } : r))
    }
    update(next)
  }
  const removeRule = (id: string): void => {
    update({ ...file, rules: file.rules.filter((r) => r.id !== id) })
  }
  const moveRule = (id: string, delta: -1 | 1): void => {
    const i = file.rules.findIndex((r) => r.id === id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= file.rules.length) return
    const rules = file.rules.slice()
    const tmp = rules[i]
    rules[i] = rules[j]
    rules[j] = tmp
    update({ ...file, rules })
  }
  const addRule = (): void => {
    update({ ...file, rules: [...file.rules, newScheduleRule(uuid())] })
  }

  if (!hydrated || !settingsHydrated) {
    return (
      <SettingsSection id="schedule" title="Schedule" isActive={isActive} searchEntries={ENTRIES}>
        <p className="text-[13px] text-muted">Loading…</p>
      </SettingsSection>
    )
  }

  if (loadError) {
    return (
      <SettingsSection
        id="schedule"
        title="Schedule"
        description="Scheduled appearance overrides are disabled until the saved schedule can be read safely."
        isActive={isActive}
        searchEntries={ENTRIES}
      >
        <div
          role="alert"
          className="space-y-2 rounded-md border border-[color:var(--warn)] bg-[color:var(--warn)]/10 px-3 py-3 text-[13px] text-[color:var(--warn)]"
        >
          <p>
            Scheduled settings are off because the saved file is {loadError.kind === 'corrupt'
              ? 'not valid JSON'
              : 'unreadable'}{loadError.code ? ` (${loadError.code})` : ''}.
          </p>
          <p>
            The original evidence was left untouched at <code>{loadError.path}</code>. Repair or
            move that file, then restart nodeterm. Editing stays locked so this recovery copy
            cannot be overwritten.
          </p>
        </div>
      </SettingsSection>
    )
  }

  return (
    <SettingsSection
      id="schedule"
      title="Schedule"
      description="Automatically switch appearance settings for a date/time window, or gate them on a Home Assistant entity. Nothing here ever changes your saved settings — an active rule is an overlay, and turns off on its own the moment its window (or its Home Assistant entity) ends."
      isActive={isActive}
      searchEntries={ENTRIES}
    >
      <SearchableRow {...ROWS.timezone}>
        <Labeled
          label="Timezone"
          hint="Every rule's date and time is interpreted in this ONE IANA timezone (e.g. Europe/London). Daylight saving is handled automatically for zones that observe it. Type the zone's standard name; an unrecognized value falls back to this computer's own timezone."
        >
          <Input
            className="w-64"
            value={file.timezone}
            onChange={(e) => update({ ...file, timezone: e.target.value })}
            spellCheck={false}
          />
        </Labeled>
      </SearchableRow>

      <SearchableRow {...ROWS.rules}>
        <div className="space-y-4">
          {saveError && (
            <p className="rounded-md border border-[color:var(--warn)] bg-[color:var(--warn)]/10 px-3 py-2 text-[13px] text-[color:var(--warn)]">
              Could not save: {saveError}
            </p>
          )}
          {file.rules.length === 0 && (
            <p className="text-[13px] text-muted">
              No rules yet. Add one to switch appearance settings automatically for a time of day,
              a date range, or a Home Assistant entity.
            </p>
          )}
          {file.rules.map((rule, index) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              index={index}
              count={file.rules.length}
              isActive={active?.active?.ruleId === rule.id}
              hasToken={tokenStatus[rule.id] === true}
              status={active?.sources[rule.id]}
              onPatch={(patch) => patchRule(rule.id, patch)}
              onRemove={() => removeRule(rule.id)}
              onMove={(delta) => moveRule(rule.id, delta)}
              onSetToken={(token) => void setHomeAssistantToken(rule.id, token)}
              onRetry={() => void refreshRule(rule.id)}
            />
          ))}
          <Button onClick={addRule}>Add rule</Button>
        </div>
      </SearchableRow>
    </SettingsSection>
  )
}
