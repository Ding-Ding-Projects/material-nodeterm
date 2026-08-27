// Scheduled settings: a persisted set of rules that can override the app's own appearance /
// customization settings for a date+time window, gated by a local switch, a validated HTTPS API,
// or a Home Assistant boolean entity.
//
// Everything in this file is PURE (no fs, no network, no Date.now() calls except where an epoch
// is passed in explicitly) so it is usable identically from src/core (the main-process store +
// the background evaluator, on BOTH the Electron and Server Edition shells) and from the
// renderer (form validation, previewing "is this rule active right now?"). See
// docs/scheduled-settings.md for the full contract this module implements.

import type { Settings } from './types'
import { isFunnyLevel } from './i18n'

export const SCHEDULED_SETTINGS_SCHEMA_VERSION = 1 as const

// ── What can be scheduled ───────────────────────────────────────────────────────────────────────

/**
 * The settings this feature can schedule: the union of what the app's OWN Terminal and Appearance
 * settings sections already treat as appearance/customization (see
 * `renderer/lib/settingsReset.ts` `TERMINAL_RESET_KEYS` + `APPEARANCE_RESET_KEYS`). Kept as an
 * independent literal list — not imported from there — because that module is renderer-only,
 * while this one is shared with the main process, which uses it to ALLOWLIST an external API
 * response's fields before any of them are ever applied to a running app. If either of those
 * lists changes, revisit this one; they are deliberately meant to describe the same "appearance"
 * concept everywhere it appears.
 */
export const SCHEDULABLE_SETTING_KEYS = [
  'appTheme',
  'accent',
  'hiddenNodeMenuItems',
  'hiddenHeaderButtons',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontWeightBold',
  'drawBoldTextInBrightColors',
  'terminalMinContrast',
  'terminalTheme',
  'cursorStyle',
  'cursorInactiveStyle',
  'cursorBlink',
  'terminalLineHeight',
  'terminalLetterSpacing',
  'terminalGpuRendering',
  'funnyLevelEn',
  'funnyLevelYue'
] as const satisfies readonly (keyof Settings)[]

export type SchedulableSettingKey = (typeof SCHEDULABLE_SETTING_KEYS)[number]
export type SchedulableSettingsPatch = Partial<Pick<Settings, SchedulableSettingKey>>

type FieldValidator = (v: unknown) => boolean

/** Per-field validators used both to ALLOWLIST an external API's response (drop anything that
 *  doesn't pass) and to sanity-check a hand-edited scheduled-settings.json on load. Mirrors the
 *  bounds `Settings` itself is documented to accept; an unrecognized enum value or an out-of-range
 *  number is dropped rather than applied — never coerced to "the nearest legal value", which would
 *  be a guess wearing a validator's clothes. */
const FIELD_VALIDATORS: Record<SchedulableSettingKey, FieldValidator> = {
  appTheme: (v) => v === 'auto' || v === 'dark' || v === 'light',
  accent: (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v),
  hiddenNodeMenuItems: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  hiddenHeaderButtons: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  fontFamily: (v) => typeof v === 'string' && v.length > 0 && v.length <= 200,
  fontSize: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 6 && v <= 96,
  fontWeight: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 100 && v <= 900,
  fontWeightBold: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 100 && v <= 900,
  drawBoldTextInBrightColors: (v) => typeof v === 'boolean',
  terminalMinContrast: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 21,
  terminalTheme: (v) => typeof v === 'string' && v.length > 0 && v.length <= 100,
  cursorStyle: (v) => v === 'block' || v === 'bar' || v === 'underline',
  cursorInactiveStyle: (v) =>
    v === 'block' || v === 'bar' || v === 'underline' || v === 'outline' || v === 'none',
  cursorBlink: (v) => typeof v === 'boolean',
  terminalLineHeight: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0.5 && v <= 3,
  terminalLetterSpacing: (v) => typeof v === 'number' && Number.isFinite(v) && v >= -5 && v <= 20,
  terminalGpuRendering: (v) => v === 'auto' || v === 'on' || v === 'off' || v === 'shared',
  funnyLevelEn: isFunnyLevel,
  funnyLevelYue: isFunnyLevel
}

/** Drop any key not in `SCHEDULABLE_SETTING_KEYS` and any value that fails its validator. Used for
 *  both a hand-edited rule's stored `values` and an external API's fetched payload — the same
 *  allowlist either way. */
export function normalizeSchedulableValues(raw: unknown): SchedulableSettingsPatch {
  if (!raw || typeof raw !== 'object') return {}
  const out: SchedulableSettingsPatch = {}
  const src = raw as Record<string, unknown>
  for (const key of SCHEDULABLE_SETTING_KEYS) {
    if (!(key in src)) continue
    const v = src[key]
    if (FIELD_VALIDATORS[key](v)) (out as Record<string, unknown>)[key] = v
  }
  return out
}

// ── The schedule window ─────────────────────────────────────────────────────────────────────────

/** 0 = Sunday .. 6 = Saturday — `Date#getDay()`'s convention, so no translation is needed at the
 *  boundary where a JS Date meets this type. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface ScheduleWindow {
  /** Inclusive local calendar date, `YYYY-MM-DD`. Absent = no lower date bound. */
  startDate?: string
  /** Inclusive local calendar date, `YYYY-MM-DD`. Absent = no upper date bound. */
  endDate?: string
  /** Local time-of-day, 24h `HH:mm`. See `sameDayTimeMatch`'s doc for the exact semantics of each
   *  combination of start/end being present or absent. */
  startTime?: string
  endTime?: string
  /** `'every-day'` — every weekday, for the given time window; ONE rule, not seven duplicated
   *  ones. An explicit array restricts to exactly those weekdays. An EMPTY explicit array matches
   *  NO day — a user who unchecked every box gets "never", not silently "every day". */
  days: 'every-day' | Weekday[]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isValidScheduleDate(s: unknown): s is string {
  return typeof s === 'string' && DATE_RE.test(s)
}
export function isValidScheduleTime(s: unknown): s is string {
  return typeof s === 'string' && TIME_RE.test(s)
}

function timeToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

/** Shift a `YYYY-MM-DD` string by `deltaDays` calendar days. Pure calendar arithmetic anchored at
 *  UTC noon-of-nowhere — this never represents a real instant, only a calendar date, so no real
 *  timezone offset is needed once the caller already has the LOCAL date components (which
 *  `localClock` below is responsible for producing). */
function shiftDate(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + deltaDays)
  return dt.toISOString().slice(0, 10)
}

function weekdayOf(dateStr: string): Weekday {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as Weekday
}

function dateInRange(window: ScheduleWindow, dateStr: string): boolean {
  // ISO YYYY-MM-DD strings sort lexicographically exactly as they sort chronologically, so a
  // plain string compare is correct here and needs no Date parsing.
  if (isValidScheduleDate(window.startDate) && dateStr < window.startDate) return false
  if (isValidScheduleDate(window.endDate) && dateStr > window.endDate) return false
  return true
}

function dayAllowed(window: ScheduleWindow, dateStr: string): boolean {
  if (window.days === 'every-day') return true
  return window.days.includes(weekdayOf(dateStr))
}

/**
 * Whether `minutes` (0..1439, local minutes-since-midnight) falls inside a window instance that
 * STARTS on the day being tested — every combination is a deliberate, documented choice:
 *
 *  - Neither bound set        -> all day (always true).
 *  - Only `startTime` set     -> `[startTime, 24:00)`.
 *  - Only `endTime` set       -> `[00:00, endTime)`.
 *  - Both set, start < end    -> `[start, end)`, a same-day window (end EXCLUSIVE, so a rule
 *                                ending at 09:00 and one starting at 09:00 never overlap).
 *  - Both set, start === end  -> all day. A truly zero-length window is unusable, so equal bounds
 *                                are defined to mean "no time restriction" rather than "never".
 *  - Both set, start > end    -> the caller handles this (see `crossesMidnight` below); this
 *                                function is never reached for that case.
 *  - A malformed bound        -> treated as absent (that side is unbounded). `scheduleWindowActiveAt`
 *                                only ever passes validated minute values in here.
 */
function sameDayTimeMatch(startMin: number | null, endMin: number | null, minutes: number): boolean {
  if (startMin === null && endMin === null) return true
  if (startMin !== null && endMin === null) return minutes >= startMin
  if (startMin === null && endMin !== null) return minutes < endMin
  if (startMin === endMin) return true
  if (startMin! < endMin!) return minutes >= startMin! && minutes < endMin!
  return false // crosses midnight — handled by the caller
}

function crossesMidnight(startMin: number | null, endMin: number | null): boolean {
  return startMin !== null && endMin !== null && startMin > endMin
}

export interface LocalClock {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string
  /** Minutes since local midnight, 0..1439. */
  minutes: number
  /** Local day of week, 0=Sun..6=Sat. */
  weekday: Weekday
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Resolve `epochMs` to its wall-clock date/time/weekday in the IANA zone `timeZone`. Falls back
 * to the runtime's own local zone for a malformed/unknown zone name (`Intl` throws synchronously
 * on construction for those) — a fallback, not a silent wrong answer dressed up as a right one:
 * the caller (the main-process evaluator) logs nothing here, but the settings UI validates the
 * timezone string before it is ever saved, so this fallback should only ever fire for a
 * hand-edited file.
 */
export function localClock(epochMs: number, timeZone: string): LocalClock {
  let dtf: Intl.DateTimeFormat
  try {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short'
    })
  } catch {
    dtf = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short'
    })
  }
  const parts = dtf.formatToParts(new Date(epochMs))
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? ''
  const y = get('year')
  const mo = get('month')
  const d = get('day')
  let h = Number(get('hour'))
  if (h === 24) h = 0 // some locales render midnight as "24" rather than "00"
  const mi = Number(get('minute'))
  const wdIdx = WEEKDAY_SHORT.indexOf(get('weekday'))
  return {
    date: `${y}-${mo}-${d}`,
    minutes: h * 60 + mi,
    weekday: (wdIdx < 0 ? 0 : wdIdx) as Weekday
  }
}

/** Is `window` active at `epochMs`, interpreted in `timeZone`? Deterministic, and every corner
 *  documented: an empty window (no bounds, `days:'every-day'`) is active always; a window whose
 *  every field is set narrows from there. */
export function scheduleWindowActiveAt(window: ScheduleWindow, epochMs: number, timeZone: string): boolean {
  const now = localClock(epochMs, timeZone)
  const startMin = isValidScheduleTime(window.startTime) ? timeToMinutes(window.startTime) : null
  const endMin = isValidScheduleTime(window.endTime) ? timeToMinutes(window.endTime) : null

  if (!crossesMidnight(startMin, endMin)) {
    if (!dateInRange(window, now.date)) return false
    if (!dayAllowed(window, now.date)) return false
    return sameDayTimeMatch(startMin, endMin, now.minutes)
  }

  // Cross-midnight: the instance beginning TODAY covers [today startTime, tomorrow endTime); the
  // instance beginning YESTERDAY covers [yesterday startTime, today endTime). "Now" can fall in at
  // most one of the two — `minutes < endMin < startMin <= minutes` cannot hold on the same day —
  // so check today's instance, then yesterday's.
  if (now.minutes >= startMin!) {
    if (dateInRange(window, now.date) && dayAllowed(window, now.date)) return true
  }
  if (now.minutes < endMin!) {
    // The date-range/day-of-week check is evaluated against the START day: a window that begins
    // 22:00 Friday is a "Friday" window even though part of it falls on Saturday's calendar date.
    const y = shiftDate(now.date, -1)
    if (dateInRange(window, y) && dayAllowed(window, y)) return true
  }
  return false
}

export interface ScheduleWindowFieldErrors {
  startDate?: string
  endDate?: string
  startTime?: string
  endTime?: string
  /** Both dates are individually valid, but end precedes start. */
  dateOrder?: string
}

/** Inline-form validation: report EVERY problem field, never silently coerce or drop one. The
 *  persisted-rule evaluator above stays tolerant (a malformed bound reads as absent) precisely
 *  because a hand-edited settings file must never crash the app — but the editor UI that WROTE the
 *  file in the first place should never let a malformed value reach disk to begin with. */
export function validateScheduleWindow(window: ScheduleWindow): ScheduleWindowFieldErrors {
  const errors: ScheduleWindowFieldErrors = {}
  if (window.startDate !== undefined && !isValidScheduleDate(window.startDate)) {
    errors.startDate = 'Use the date picker, or type YYYY-MM-DD.'
  }
  if (window.endDate !== undefined && !isValidScheduleDate(window.endDate)) {
    errors.endDate = 'Use the date picker, or type YYYY-MM-DD.'
  }
  if (window.startTime !== undefined && !isValidScheduleTime(window.startTime)) {
    errors.startTime = 'Use the time picker, or type 24-hour HH:mm.'
  }
  if (window.endTime !== undefined && !isValidScheduleTime(window.endTime)) {
    errors.endTime = 'Use the time picker, or type 24-hour HH:mm.'
  }
  if (
    !errors.startDate &&
    !errors.endDate &&
    isValidScheduleDate(window.startDate) &&
    isValidScheduleDate(window.endDate) &&
    window.startDate! > window.endDate!
  ) {
    errors.dateOrder = 'The end date is before the start date.'
  }
  return errors
}

export function isScheduleWindowValid(window: ScheduleWindow): boolean {
  return Object.keys(validateScheduleWindow(window)).length === 0
}

export function defaultScheduleWindow(): ScheduleWindow {
  return { days: 'every-day' }
}

// ── The source a rule's values (or its on/off gate) come from ─────────────────────────────────

export type ScheduleSource =
  | { kind: 'local' }
  | { kind: 'api'; url: string; timeoutMs?: number }
  | { kind: 'home-assistant'; baseUrl: string; entityId: string }

/** A HA entity this feature will read. Only boolean-shaped domains, per the brief — no arbitrary
 *  sensor/entity can gate a rule. */
export const HOME_ASSISTANT_ENTITY_RE = /^(binary_sensor|input_boolean)\.[a-z0-9_]+$/

export function isValidHomeAssistantEntityId(id: string): boolean {
  return HOME_ASSISTANT_ENTITY_RE.test(id)
}

// ── A rule, and the file that holds them ────────────────────────────────────────────────────────

export interface ScheduleRule {
  id: string
  label: string
  enabled: boolean
  window: ScheduleWindow
  source: ScheduleSource
  /** The settings this rule applies while it is active. For an `'api'` source this is a LOCAL
   *  fallback shown in the editor before any fetch has completed — the live value actually applied
   *  is always whatever the source's last successful fetch produced (see `RuleSourceState` and
   *  `resolveActiveSchedule` below, and their caller in core/scheduled-settings-service.ts). */
  values: SchedulableSettingsPatch
}

export interface ScheduledSettingsFile {
  version: 1
  /** IANA timezone name, e.g. "Europe/London". Every rule's window is interpreted in this ONE
   *  timezone — not per-rule — so the whole schedule has a single, statable clock rather than each
   *  rule silently keeping whatever zone the machine that created it happened to be in. Defaults to
   *  the runtime's own resolved zone the first time this file is created (see
   *  `resolveDefaultTimezone`), and is user-editable in Settings → Schedule. */
  timezone: string
  /** Deterministic precedence: ARRAY ORDER. The FIRST enabled rule whose window is active *and*
   *  whose source is currently satisfied wins; every later rule is ignored whether or not it also
   *  matches. Reorder rules in the editor to change precedence — the same "order decides" contract
   *  this codebase already uses for project tabs and kanban columns. */
  rules: ScheduleRule[]
}

/** A failed startup read is not an empty schedule. The runtime serves `file` as a deliberately
 * disabled in-memory fallback so no automation can run, while `error` preserves the distinct
 * recovery fact for every renderer attached to either shell. The file named by `path` is never
 * renamed or overwritten while this state is active. */
export interface ScheduledSettingsLoadError {
  kind: 'corrupt' | 'unreadable'
  /** A bounded filesystem code such as EACCES/EIO/EISDIR when one exists. Raw exception text is
   * intentionally not sent over IPC because it can contain attacker-controlled path content. */
  code?: string
  path: string
  message: string
}

export type ScheduledSettingsLoadState =
  | { ok: true; file: ScheduledSettingsFile; error: null }
  | { ok: false; file: ScheduledSettingsFile; error: ScheduledSettingsLoadError }

export const SCHEDULE_LIMITS = {
  maxRules: 50,
  maxLabelLength: 120,
  maxUrlLength: 2048,
  maxEntityIdLength: 200
} as const

export function newScheduleRule(id: string): ScheduleRule {
  return {
    id,
    label: 'New rule',
    enabled: true,
    window: defaultScheduleWindow(),
    source: { kind: 'local' },
    values: {}
  }
}

export function resolveDefaultTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function defaultScheduledSettingsFile(): ScheduledSettingsFile {
  return { version: SCHEDULED_SETTINGS_SCHEMA_VERSION, timezone: resolveDefaultTimezone(), rules: [] }
}

/** A schedule with no rules at all never has an active override — the base settings are what
 *  render, exactly as if the feature had never been touched. */
export function hasAnyRule(file: ScheduledSettingsFile): boolean {
  return file.rules.length > 0
}

// ── Migration / bounding (settings.json's own "hand-editable, so be tolerant" convention) ──────

function normalizeWindow(raw: unknown): ScheduleWindow {
  const w = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const startDate = isValidScheduleDate(w.startDate) ? w.startDate : undefined
  const endDate = isValidScheduleDate(w.endDate) ? w.endDate : undefined
  const startTime = isValidScheduleTime(w.startTime) ? w.startTime : undefined
  const endTime = isValidScheduleTime(w.endTime) ? w.endTime : undefined
  let days: 'every-day' | Weekday[] = 'every-day'
  if (Array.isArray(w.days)) {
    days = w.days
      .filter((d): d is Weekday => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)
      .slice(0, 7)
  }
  return { startDate, endDate, startTime, endTime, days }
}

interface NormalizedSource {
  source: ScheduleSource
  /** Whether an enabled rule may safely remain enabled after tolerant disk migration. A broken
   *  external source must never degrade into an unconditional local source: that turns "could not
   *  check" into "yes" and can apply an override the operator explicitly gated on another system. */
  safeToEnable: boolean
}

function normalizeSource(raw: unknown): NormalizedSource {
  // Missing source predates external sources and therefore means the original local behavior.
  if (raw === undefined) return { source: { kind: 'local' }, safeToEnable: true }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { source: { kind: 'local' }, safeToEnable: false }
  }
  const s = raw as Record<string, unknown>
  if (s.kind === 'local') return { source: { kind: 'local' }, safeToEnable: true }
  if (s.kind === 'api') {
    const url = typeof s.url === 'string' ? s.url.slice(0, SCHEDULE_LIMITS.maxUrlLength) : ''
    const timeoutValid =
      s.timeoutMs === undefined ||
      (typeof s.timeoutMs === 'number' && Number.isFinite(s.timeoutMs) && s.timeoutMs > 0)
    return {
      source: {
        kind: 'api',
        url,
        timeoutMs: timeoutValid ? (s.timeoutMs as number | undefined) : undefined
      },
      safeToEnable:
        typeof s.url === 'string' &&
        s.url.length > 0 &&
        s.url.length <= SCHEDULE_LIMITS.maxUrlLength &&
        timeoutValid
    }
  }
  if (s.kind === 'home-assistant') {
    const baseUrl = typeof s.baseUrl === 'string' ? s.baseUrl.slice(0, SCHEDULE_LIMITS.maxUrlLength) : ''
    const entityId =
      typeof s.entityId === 'string' ? s.entityId.slice(0, SCHEDULE_LIMITS.maxEntityIdLength) : ''
    return {
      source: { kind: 'home-assistant', baseUrl, entityId },
      safeToEnable:
        typeof s.baseUrl === 'string' &&
        s.baseUrl.length > 0 &&
        s.baseUrl.length <= SCHEDULE_LIMITS.maxUrlLength &&
        typeof s.entityId === 'string' &&
        s.entityId.length <= SCHEDULE_LIMITS.maxEntityIdLength &&
        isValidHomeAssistantEntityId(s.entityId)
    }
  }
  return { source: { kind: 'local' }, safeToEnable: false }
}

function normalizeRule(raw: unknown): ScheduleRule | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  // An id-less rule cannot be addressed by the editor, the HA token store, or the "which rule is
  // active" push — rather than mint one and silently change what the file means, it is dropped.
  if (typeof r.id !== 'string' || !r.id) return null
  const normalizedSource = normalizeSource(r.source)
  const enabled = r.enabled === undefined ? true : r.enabled === true
  return {
    id: r.id,
    label: typeof r.label === 'string' ? r.label.slice(0, SCHEDULE_LIMITS.maxLabelLength) : '',
    // A malformed enabled value is not consent to turn a rule on. Likewise, keep a broken
    // external source visible/editable but disabled instead of silently converting its gate into
    // an always-satisfied local source.
    enabled: enabled && normalizedSource.safeToEnable,
    window: normalizeWindow(r.window),
    source: normalizedSource.source,
    values: normalizeSchedulableValues(r.values)
  }
}

/** Merge a possibly-partial/legacy/hand-edited file over a fresh default, the same way
 *  `settings-store.ts`'s `mergeSettings` treats `settings.json`: every field is independently
 *  tolerant, so one bad rule never sinks the whole schedule and one malformed field never sinks a
 *  whole rule. */
export function normalizeScheduledSettingsFile(raw: unknown): ScheduledSettingsFile {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const timezone =
    typeof obj.timezone === 'string' && obj.timezone.trim() ? obj.timezone : resolveDefaultTimezone()
  const rulesRaw = Array.isArray(obj.rules) ? obj.rules : []
  const rules = rulesRaw
    .slice(0, SCHEDULE_LIMITS.maxRules)
    .map(normalizeRule)
    .filter((r): r is ScheduleRule => r !== null)
  return { version: SCHEDULED_SETTINGS_SCHEMA_VERSION, timezone, rules }
}

/** Bounds a SAVE must satisfy (the UI should never let you get here, but the store re-checks
 *  before writing — the same "never trust the caller" discipline as everywhere else this app
 *  writes hand-editable JSON). Returns a human-readable reason, or null when the file is fine. */
export function validateScheduledSettingsFile(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'Malformed schedule file.'
  const file = raw as Record<string, unknown>
  if (file.version !== SCHEDULED_SETTINGS_SCHEMA_VERSION) return 'Unsupported schedule file version.'
  if (typeof file.timezone !== 'string' || !file.timezone.trim()) return 'The timezone is required.'
  if (!Array.isArray(file.rules)) return 'Malformed schedule file.'
  if (file.rules.length > SCHEDULE_LIMITS.maxRules) {
    return `A schedule can hold at most ${SCHEDULE_LIMITS.maxRules} rules.`
  }
  const seen = new Set<string>()
  for (const entry of file.rules) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'Malformed schedule rule.'
    const rule = entry as Record<string, unknown>
    if (typeof rule.id !== 'string' || !rule.id) return 'Every rule needs an id.'
    if (seen.has(rule.id)) return 'Two rules share the same id.'
    seen.add(rule.id)
    if (typeof rule.label !== 'string') return 'Every rule needs a label.'
    if (rule.label.length > SCHEDULE_LIMITS.maxLabelLength) {
      return `A rule's label is limited to ${SCHEDULE_LIMITS.maxLabelLength} characters.`
    }
    if (typeof rule.enabled !== 'boolean') return `"${rule.label || 'Untitled rule'}" has an invalid enabled value.`
    if (!rule.window || typeof rule.window !== 'object' || Array.isArray(rule.window)) {
      return `"${rule.label || 'Untitled rule'}" has an invalid date or time.`
    }
    const window = rule.window as Record<string, unknown>
    if (
      window.days !== 'every-day' &&
      (!Array.isArray(window.days) ||
        window.days.length > 7 ||
        window.days.some((day) => typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6))
    ) {
      return `"${rule.label || 'Untitled rule'}" has an invalid weekday selection.`
    }
    if (!isScheduleWindowValid(window as unknown as ScheduleWindow)) {
      return `"${rule.label || 'Untitled rule'}" has an invalid date or time.`
    }
    if (!rule.source || typeof rule.source !== 'object' || Array.isArray(rule.source)) {
      return `"${rule.label || 'Untitled rule'}" has an invalid source.`
    }
    const source = rule.source as Record<string, unknown>
    if (source.kind === 'api') {
      if (typeof source.url !== 'string' || !source.url) return 'The API URL is required.'
      if (source.url.length > SCHEDULE_LIMITS.maxUrlLength) return 'The API URL is too long.'
      if (
        source.timeoutMs !== undefined &&
        (typeof source.timeoutMs !== 'number' || !Number.isFinite(source.timeoutMs) || source.timeoutMs <= 0)
      ) {
        return 'The API timeout must be a positive number.'
      }
    } else if (source.kind === 'home-assistant') {
      if (typeof source.baseUrl !== 'string' || !source.baseUrl) return 'The Home Assistant URL is required.'
      if (source.baseUrl.length > SCHEDULE_LIMITS.maxUrlLength) return 'The Home Assistant URL is too long.'
      if (typeof source.entityId !== 'string' || !isValidHomeAssistantEntityId(source.entityId)) {
        return `"${rule.label || 'Untitled rule'}"'s entity id must be a binary_sensor.* or input_boolean.* entity.`
      }
    } else if (source.kind !== 'local') {
      return `"${rule.label || 'Untitled rule'}" has an invalid source.`
    }
    if (!rule.values || typeof rule.values !== 'object' || Array.isArray(rule.values)) {
      return `"${rule.label || 'Untitled rule'}" has invalid settings values.`
    }
    const values = rule.values as Record<string, unknown>
    for (const key of SCHEDULABLE_SETTING_KEYS) {
      if (key in values && !FIELD_VALIDATORS[key](values[key])) {
        return `"${rule.label || 'Untitled rule'}" has an invalid ${key} value.`
      }
    }
  }
  return null
}

// ── Resolution: which rule is active right now, and what it should apply ───────────────────────

/** What we know about an external source right now. `hasValue`/`values`/`on`/`lastSuccessMs` are
 *  updated ONLY on a successful fetch and are otherwise left exactly as they were — that is how
 *  "retain the last valid state" (a transient failure must not un-apply an already-active rule) is
 *  implemented: a rule that has EVER synced successfully keeps applying its last-known-good value
 *  through later failures, while `lastAttemptOk`/`error` independently reflect the MOST RECENT
 *  attempt so the UI can still show (and let the user retry) the live failure. */
export interface RuleSourceState {
  /** True once at least one fetch has ever succeeded — a rule whose source has never synced can
   *  never win (fail-safe: no result is never treated as "on"/valid). */
  hasValue: boolean
  /** api only — the values from the last SUCCESSFUL fetch. */
  values?: SchedulableSettingsPatch
  /** home-assistant only — the entity's boolean state from the last SUCCESSFUL fetch. */
  on?: boolean
  lastSuccessMs?: number
  /** Did the MOST RECENT attempt succeed? Independent of `hasValue` (a rule can be failing right
   *  now while still applying an older successful value). */
  lastAttemptOk: boolean
  lastAttemptMs?: number
  error?: string
}

export type RuleSourceStates = Record<string, RuleSourceState>

function ruleSourceSatisfied(rule: ScheduleRule, states: RuleSourceStates): boolean {
  if (rule.source.kind === 'local') return true
  const state = states[rule.id]
  if (!state || !state.hasValue) return false
  if (rule.source.kind === 'home-assistant') return state.on === true
  return true // 'api': satisfied once SOME successful fetch exists
}

function ruleEffectiveValues(rule: ScheduleRule, states: RuleSourceStates): SchedulableSettingsPatch {
  if (rule.source.kind === 'api') return states[rule.id]?.values ?? {}
  return rule.values
}

export interface ResolvedSchedule {
  ruleId: string
  values: SchedulableSettingsPatch
}

/** The per-rule external-source status pushed to the renderer (a status dot + "last synced Ns ago"
 *  + the Retry affordance) — the UI-facing counterpart of the richer, main-process-only
 *  `RuleSourceState` above. Only rules with an external source appear; a `'local'` rule has
 *  nothing to report. */
export interface ScheduledSettingsSourceStatus {
  /** Does this source have a value we could apply right now (possibly stale — see
   *  `lastSuccessMs`)? */
  ok: boolean
  lastAttemptMs?: number
  lastSuccessMs?: number
  /** Present only when the MOST RECENT attempt failed. */
  error?: string
}

/** The live resolved schedule, pushed to every attached UI whenever it changes (see
 *  `IPC.scheduledSettingsActiveChange`) and readable once via `IPC.scheduledSettingsActiveState`. */
export interface ScheduledSettingsActiveState {
  computedAtMs: number
  active: ResolvedSchedule | null
  sources: Record<string, ScheduledSettingsSourceStatus>
}

/**
 * The ONE rule in effect at `epochMs`, or `null` if none match — deterministic, array-order,
 * first-win (see `ScheduledSettingsFile.rules`'s doc). Pure: takes the current instant and the
 * already-resolved external-source states rather than reading a clock or the network itself, so
 * it is trivially testable and the evaluator can recompute it synchronously on every tick or fetch
 * completion without re-deriving "now" twice or racing a background fetch.
 */
export function resolveActiveSchedule(
  file: ScheduledSettingsFile,
  epochMs: number,
  states: RuleSourceStates
): ResolvedSchedule | null {
  for (const rule of file.rules) {
    if (!rule.enabled) continue
    if (!scheduleWindowActiveAt(rule.window, epochMs, file.timezone)) continue
    if (!ruleSourceSatisfied(rule, states)) continue
    return { ruleId: rule.id, values: ruleEffectiveValues(rule, states) }
  }
  return null
}

// ── The `kind:'api'` wire contract ──────────────────────────────────────────────────────────────

export const SCHEDULED_SETTINGS_API_VERSION = 1 as const

/** The shape a `kind:'api'` source's URL must return: `{"version":1,"settings":{...}}`, where
 *  `settings` is allowlisted+validated against `SCHEDULABLE_SETTING_KEYS` before it is ever
 *  applied. Anything else (wrong/missing version, non-object, unknown fields, oversized body) is a
 *  validation failure. */
export interface ScheduledSettingsApiResponse {
  version: 1
  settings: SchedulableSettingsPatch
}

export const SCHEDULED_SETTINGS_API_MAX_BYTES = 64 * 1024 // generous for ~17 scalar fields
export const SCHEDULED_SETTINGS_API_TIMEOUT_MS = 8_000
/** Background poll interval for an ENABLED rule with an external source. A rule also refreshes
 *  immediately the moment its window transitions from inactive to active ("refresh on
 *  activation"), so this interval only governs the steady background re-check while it stays
 *  active/pending. */
export const SCHEDULED_SETTINGS_REFRESH_INTERVAL_MS = 5 * 60_000

/** Parse+validate an `'api'` source's response body. Returns `null` on ANY shape mismatch — never
 *  a partial best-effort object — so the caller can tell "nothing usable came back" from "some
 *  fields were fine". */
export function parseScheduledSettingsApiResponse(text: string): SchedulableSettingsPatch | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (d.version !== SCHEDULED_SETTINGS_API_VERSION) return null
  if (!d.settings || typeof d.settings !== 'object') return null
  return normalizeSchedulableValues(d.settings)
}

// ── URL safety (SSRF / credential / redirect boundary) ─────────────────────────────────────────

export type UrlSafetyResult = { ok: true; url: URL } | { ok: false; error: string }

/** `https:` is always allowed. `http:` is allowed ONLY for an explicit loopback host — the
 *  brief's "bounded loopback development route" — so a real API or Home Assistant instance on the
 *  LAN or the internet must be reached over HTTPS. Credentials embedded in the URL
 *  (`user:pass@host`) are refused outright: they would ride into logs/history as part of the URL
 *  string, which the token vault below exists specifically to avoid. Only `http:`/`https:` are
 *  accepted at all — `file:` and any custom scheme are refused, closing the "arbitrary file
 *  access" hole the brief calls out. */
export function validateFetchUrl(raw: string): UrlSafetyResult {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, error: 'Not a valid URL.' }
  }
  if (url.username || url.password) {
    return { ok: false, error: 'The URL must not contain a username or password.' }
  }
  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if (url.protocol === 'https:') return { ok: true, url }
  if (url.protocol === 'http:' && isLoopback) return { ok: true, url }
  return {
    ok: false,
    error:
      url.protocol === 'http:'
        ? 'Plain HTTP is only allowed for localhost/127.0.0.1 (a local development route). Use HTTPS for a real server.'
        : `Unsupported URL scheme "${url.protocol}" — only https:// (or http:// on localhost) is allowed.`
  }
}
