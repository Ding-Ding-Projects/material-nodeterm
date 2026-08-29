/**
 * server.properties — read, typed-edit, write. Vanilla Minecraft's own config format: comment
 * lines starting with `#`, blank lines, and `key=value` pairs with no escaping. This module
 * parses it into an ordered structure that round-trips byte-for-byte for anything it does not
 * touch, so editing three fields through the GUI never silently reformats or reorders the other
 * two hundred a real world's file accumulates.
 *
 * MANAGED_PROPERTY_FIELDS is the honest subset the GUI renders typed controls for. Everything
 * else in the file is still preserved and still readable/writable as a raw string (see
 * `parseProperties`/`applyPropertyUpdates`), it just doesn't get a dedicated widget — server.
 * properties has dozens of keys and pretending to cover all of them with typed controls would
 * mean silently mis-typing the ones nobody thought of.
 */

// The field catalog (MANAGED_PROPERTY_FIELDS / fieldSpec) lives in shared/minecraft.ts, not here —
// the renderer builds the typed properties editor from it and may only ever import `@shared/*`,
// never `core/*` directly. Re-exported here so a core-side caller can keep importing it from this
// module without reaching into shared/minecraft.ts itself.
export {
  MANAGED_PROPERTY_FIELDS,
  minecraftFieldSpec as fieldSpec,
  type MinecraftPropertyFieldKind as PropertyFieldKind,
  type MinecraftPropertyFieldSpec as PropertyFieldSpec
} from '../../shared/minecraft'

type PropertyLine =
  | { kind: 'raw'; text: string }
  | { kind: 'kv'; key: string; value: string }

interface ParsedProperties {
  lines: PropertyLine[]
}

/** Parses raw server.properties text into an ordered line list. Never throws — an empty or
 *  unparseable file just parses as an empty document, since a fresh server writes this file's
 *  full default content on its own first launch and there is nothing useful to reject here. */
export function parseProperties(raw: string): ParsedProperties {
  if (raw === '') return { lines: [] }
  const lines: PropertyLine[] = []
  for (const text of raw.split(/\r?\n/)) {
    const trimmed = text.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      lines.push({ kind: 'raw', text })
      continue
    }
    const eq = text.indexOf('=')
    if (eq === -1) {
      lines.push({ kind: 'raw', text })
      continue
    }
    lines.push({ kind: 'kv', key: text.slice(0, eq).trim(), value: text.slice(eq + 1) })
  }
  return { lines }
}

/** Every current key=value pair as a flat map — what the GUI reads to populate its controls. */
export function propertiesToRecord(doc: ParsedProperties): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of doc.lines) if (line.kind === 'kv') out[line.key] = line.value
  return out
}

/** Applies `updates` onto `doc`, preserving every other line's position and text exactly. A key
 *  that already exists is edited in place; a key that does not is appended at the end. Returns
 *  the full file text, ready to write. */
export function applyPropertyUpdates(raw: string, updates: Record<string, string>): string {
  const doc = parseProperties(raw)
  const remaining = new Map(Object.entries(updates))
  const lines = doc.lines.map((line) => {
    if (line.kind === 'kv' && remaining.has(line.key)) {
      const value = remaining.get(line.key) as string
      remaining.delete(line.key)
      return `${line.key}=${value}`
    }
    return line.kind === 'raw' ? line.text : `${line.key}=${line.value}`
  })
  for (const [key, value] of remaining) lines.push(`${key}=${value}`)
  return lines.join('\n')
}
