import type { AppearancePreset, AppearanceTextStyle, ElementAppearanceEntry } from '@shared/types'
import { useSettings } from './settings'
import { isStyleEmpty } from '@renderer/lib/appearance/apply'

/**
 * Reads and writes into `Settings.elementAppearance` / `Settings.appearancePresets` — a thin
 * layer over the existing settings store rather than a second source of truth, so persistence,
 * coalesced saves and hydration are exactly the ones the rest of the app already relies on.
 */

function nowMs(): number {
  return Date.now()
}

export function genPresetId(): string {
  return `preset-${nowMs().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Patches one element's style (merging into whatever it already has), creating the entry on
 *  first edit. Setting a property to `undefined` REMOVES that key — that's how "reset per
 *  property" is expressed, rather than writing a value that forces a baseline. */
export function setElementStyle(
  id: string,
  label: string,
  kind: string,
  patch: Partial<AppearanceTextStyle>
): void {
  const { settings, update } = useSettings.getState()
  const existing = settings.elementAppearance[id]
  const nextStyle: AppearanceTextStyle = { ...(existing?.style ?? {}) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete (nextStyle as Record<string, unknown>)[k]
    else (nextStyle as Record<string, unknown>)[k] = v
  }
  const entry: ElementAppearanceEntry = {
    label: existing?.label ?? label,
    kind: existing?.kind ?? kind,
    style: nextStyle,
    inheritFrom: existing?.inheritFrom,
    updatedAt: nowMs()
  }
  const nextMap = { ...settings.elementAppearance }
  if (isStyleEmpty(nextStyle) && !entry.inheritFrom) {
    delete nextMap[id]
  } else {
    nextMap[id] = entry
  }
  update({ elementAppearance: nextMap })
}

export function setElementInheritFrom(id: string, label: string, kind: string, inheritFrom: string | undefined): void {
  const { settings, update } = useSettings.getState()
  const existing = settings.elementAppearance[id]
  const entry: ElementAppearanceEntry = {
    label: existing?.label ?? label,
    kind: existing?.kind ?? kind,
    style: existing?.style ?? {},
    inheritFrom,
    updatedAt: nowMs()
  }
  const nextMap = { ...settings.elementAppearance }
  if (isStyleEmpty(entry.style) && !inheritFrom) {
    delete nextMap[id]
  } else {
    nextMap[id] = entry
  }
  update({ elementAppearance: nextMap })
}

/** Resets ONE property on ONE element — the "reset per property" granularity. */
export function resetElementProperty(id: string, key: keyof AppearanceTextStyle): void {
  setElementStyle(id, '', '', { [key]: undefined } as Partial<AppearanceTextStyle>)
}

/** Resets an entire element back to platform default (drops the entry, keeps no residue). */
export function resetElement(id: string): void {
  const { settings, update } = useSettings.getState()
  if (!(id in settings.elementAppearance)) return
  const nextMap = { ...settings.elementAppearance }
  delete nextMap[id]
  update({ elementAppearance: nextMap })
}

/** Global reset: every element back to platform default. Presets are left untouched — they are a
 *  separate library, not "what's currently applied". */
export function resetAllElements(): void {
  useSettings.getState().update({ elementAppearance: {} })
}

export function applyPresetToElement(id: string, label: string, kind: string, preset: AppearancePreset): void {
  const { settings, update } = useSettings.getState()
  const existing = settings.elementAppearance[id]
  const entry: ElementAppearanceEntry = {
    label: existing?.label ?? label,
    kind: existing?.kind ?? kind,
    style: { ...preset.style },
    inheritFrom: undefined,
    updatedAt: nowMs()
  }
  update({ elementAppearance: { ...settings.elementAppearance, [id]: entry } })
}

export function saveStyleAsPreset(name: string, style: AppearanceTextStyle): AppearancePreset {
  const preset: AppearancePreset = { id: genPresetId(), name, style: { ...style }, createdAt: nowMs() }
  const { settings, update } = useSettings.getState()
  update({ appearancePresets: [...settings.appearancePresets, preset] })
  return preset
}

export function deletePreset(id: string): void {
  const { settings, update } = useSettings.getState()
  update({ appearancePresets: settings.appearancePresets.filter((p) => p.id !== id) })
}

export function renamePreset(id: string, name: string): void {
  const { settings, update } = useSettings.getState()
  update({
    appearancePresets: settings.appearancePresets.map((p) => (p.id === id ? { ...p, name } : p))
  })
}

// ---- Export / import as a standalone file (docs/appearance.md § Presets) ----------------------

export const APPEARANCE_EXPORT_VERSION = 1

export interface AppearanceExportFile {
  version: number
  exportedAt: string
  presets: AppearancePreset[]
}

export function buildExportFile(presets: AppearancePreset[]): AppearanceExportFile {
  return { version: APPEARANCE_EXPORT_VERSION, exportedAt: new Date().toISOString(), presets }
}

export interface ImportResult {
  imported: AppearancePreset[]
  skippedInvalid: number
  skippedDuplicateNames: number
}

/** Tolerant, bounded parse of an imported presets file — never throws, never partially applies a
 *  single malformed entry (it's just skipped and counted), and never silently drops a WHOLE file
 *  full of otherwise-good presets because one entry is bad. */
export function parseImportFile(raw: string, existing: readonly AppearancePreset[]): ImportResult {
  const existingNames = new Set(existing.map((p) => p.name))
  const out: ImportResult = { imported: [], skippedInvalid: 0, skippedDuplicateNames: 0 }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return out
  }
  const presets = (data as { presets?: unknown })?.presets
  if (!Array.isArray(presets)) return out
  const MAX_ENTRIES = 500
  for (const raw of presets.slice(0, MAX_ENTRIES)) {
    if (!raw || typeof raw !== 'object') {
      out.skippedInvalid++
      continue
    }
    const p = raw as Record<string, unknown>
    if (typeof p.name !== 'string' || !p.name.trim() || typeof p.style !== 'object' || p.style === null) {
      out.skippedInvalid++
      continue
    }
    const name = p.name.trim().slice(0, 80)
    if (existingNames.has(name)) {
      out.skippedDuplicateNames++
      continue
    }
    existingNames.add(name)
    out.imported.push({
      id: typeof p.id === 'string' && p.id ? p.id : genPresetId(),
      name,
      style: sanitizeStyle(p.style as Record<string, unknown>),
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : nowMs()
    })
  }
  return out
}

const NUMERIC_KEYS = new Set([
  'fontSizePx', 'fontWeight', 'baselineShiftPx', 'outlineWidthPx', 'shadowBlurPx',
  'shadowOffsetXPx', 'shadowOffsetYPx', 'glowBlurPx', 'letterSpacingPx', 'wordSpacingPx',
  'lineHeight', 'borderRadiusPx'
])
const STRING_KEYS = new Set([
  'fontFamily', 'underline', 'underlineColor', 'strikethrough', 'capitalization',
  'verticalAlign', 'color', 'highlightColor', 'outlineColor', 'shadowColor', 'glowColor',
  'direction', 'textAlign', 'backgroundColor', 'borderColor'
])

/** Drops any key/value pair that doesn't match the documented `AppearanceTextStyle` contract
 *  (wrong type, unknown key, out-of-bound length) rather than trusting a hand-edited file. */
function sanitizeStyle(input: Record<string, unknown>): AppearanceTextStyle {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (k === 'italic' || k === 'overline') {
      if (typeof v === 'boolean') out[k] = v
    } else if (NUMERIC_KEYS.has(k)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    } else if (STRING_KEYS.has(k)) {
      if (typeof v === 'string' && v.length <= 200) out[k] = v
    } else if (k === 'fontAxes' && v && typeof v === 'object') {
      const axes: Record<string, number> = {}
      for (const [ak, av] of Object.entries(v as Record<string, unknown>)) {
        if (typeof av === 'number' && Number.isFinite(av)) axes[ak] = av
      }
      if (Object.keys(axes).length) out.fontAxes = axes
    }
  }
  return out as AppearanceTextStyle
}
