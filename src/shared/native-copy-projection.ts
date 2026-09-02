/**
 * The deliberately small projection sent from the renderer to the Electron host for native
 * chrome. Runtime values, paths, identifiers, and provider responses never belong here.
 */

export const NATIVE_COPY_PROTOCOL = 1 as const

/** Every slot is named once so additions cannot accidentally widen the native text boundary. */
export const NATIVE_COPY_SLOTS = [
  'menu.file',
  'menu.edit',
  'menu.view',
  'menu.window',
  'menu.settings',
  'menu.snapToGrid',
  'menu.fitView',
  'menu.toggleKanban',
  'menu.quit',
  'quit.title',
  'quit.message',
  'quit.cancel',
  'quit.confirm',
  'quit.detail.prefix',
  'quit.detail.suffix',
  'update.available',
  'update.ready',
  'update.restart',
  'update.later',
  'alarm.title',
  'alarm.body',
  'archive.picker.title',
  'archive.picker.button',
  'archive.picker.filter',
  'icon.picker.title',
  'icon.picker.button',
  'icon.picker.filter',
  'standing-host.title',
  'standing-host.body'
] as const

export type NativeCopySlot = (typeof NATIVE_COPY_SLOTS)[number]

export type NativeSegment =
  | { kind: 'copy'; value: string }
  | { kind: 'fact'; value: string }

export interface NativeCopyEntry {
  slot: NativeCopySlot
  segments: NativeSegment[]
}

export interface NativeCopyProjection {
  protocol: typeof NATIVE_COPY_PROTOCOL
  epoch: number
  entries: NativeCopyEntry[]
}

export const NATIVE_COPY_MAX_ENTRIES = NATIVE_COPY_SLOTS.length
export const NATIVE_COPY_MAX_SEGMENTS = 8
export const NATIVE_COPY_MAX_SEGMENT_CHARS = 4096
export const NATIVE_COPY_MAX_TOTAL_CHARS = 64 * 1024

const SLOT_SET = new Set<string>(NATIVE_COPY_SLOTS)

export function isNativeCopySlot(value: unknown): value is NativeCopySlot {
  return typeof value === 'string' && SLOT_SET.has(value)
}

/** Join the typed pieces without ever applying a map in the host process. */
export function joinNativeSegments(segments: readonly NativeSegment[]): string {
  return segments.map((segment) => segment.value).join('')
}

export interface NativeCopyValidationOk {
  ok: true
  projection: NativeCopyProjection
}

export interface NativeCopyValidationError {
  ok: false
  reason: string
}

export type NativeCopyValidation = NativeCopyValidationOk | NativeCopyValidationError

/**
 * Validate the complete wire shape. The exact slot set is intentional: accepting a partial
 * projection would leave stale host copy active after a clear or School-mode transition.
 */
export function validateNativeCopyProjection(
  input: unknown,
  expectedEpoch?: number
): NativeCopyValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, reason: 'projection must be an object' }
  const value = input as { protocol?: unknown; epoch?: unknown; entries?: unknown }
  if (value.protocol !== NATIVE_COPY_PROTOCOL) return { ok: false, reason: 'unsupported projection protocol' }
  if (typeof value.epoch !== 'number' || !Number.isSafeInteger(value.epoch) || value.epoch < 0) {
    return { ok: false, reason: 'invalid projection epoch' }
  }
  if (expectedEpoch !== undefined && value.epoch !== expectedEpoch) return { ok: false, reason: 'stale projection epoch' }
  if (!Array.isArray(value.entries) || value.entries.length !== NATIVE_COPY_MAX_ENTRIES) {
    return { ok: false, reason: 'projection must contain every native-copy slot exactly once' }
  }

  const seen = new Set<string>()
  let totalChars = 0
  const entries: NativeCopyEntry[] = []
  for (const rawEntry of value.entries) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return { ok: false, reason: 'invalid projection entry' }
    const entry = rawEntry as { slot?: unknown; segments?: unknown }
    if (!isNativeCopySlot(entry.slot)) return { ok: false, reason: 'unknown native-copy slot' }
    if (seen.has(entry.slot)) return { ok: false, reason: 'duplicate native-copy slot' }
    seen.add(entry.slot)
    if (!Array.isArray(entry.segments) || entry.segments.length === 0 || entry.segments.length > NATIVE_COPY_MAX_SEGMENTS) {
      return { ok: false, reason: 'invalid native-copy segments' }
    }
    const segments: NativeSegment[] = []
    for (const rawSegment of entry.segments) {
      if (!rawSegment || typeof rawSegment !== 'object' || Array.isArray(rawSegment)) return { ok: false, reason: 'invalid native-copy segment' }
      const segment = rawSegment as { kind?: unknown; value?: unknown }
      if (segment.kind !== 'copy' && segment.kind !== 'fact') return { ok: false, reason: 'invalid native-copy segment kind' }
      if (typeof segment.value !== 'string' || segment.value.length > NATIVE_COPY_MAX_SEGMENT_CHARS) return { ok: false, reason: 'native-copy segment exceeds bounds' }
      totalChars += segment.value.length
      if (totalChars > NATIVE_COPY_MAX_TOTAL_CHARS) return { ok: false, reason: 'native-copy projection exceeds bounds' }
      segments.push({ kind: segment.kind, value: segment.value })
    }
    entries.push({ slot: entry.slot, segments })
  }
  if (seen.size !== NATIVE_COPY_MAX_ENTRIES || NATIVE_COPY_SLOTS.some((slot) => !seen.has(slot))) {
    return { ok: false, reason: 'projection is missing a native-copy slot' }
  }
  return { ok: true, projection: { protocol: NATIVE_COPY_PROTOCOL, epoch: value.epoch, entries } }
}

export function isNativeCopyProjection(input: unknown, expectedEpoch?: number): input is NativeCopyProjection {
  return validateNativeCopyProjection(input, expectedEpoch).ok
}

export function emptyNativeCopyProjection(epoch: number): NativeCopyProjection {
  return {
    protocol: NATIVE_COPY_PROTOCOL,
    epoch,
    entries: NATIVE_COPY_SLOTS.map((slot) => ({ slot, segments: [{ kind: 'fact', value: '' }] }))
  }
}

