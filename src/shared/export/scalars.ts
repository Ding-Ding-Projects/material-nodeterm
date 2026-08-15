// Low-level, format-specific scalar/string escaping. Every encoder in table.ts/document.ts is
// built out of these so the escaping rules live in exactly one place each.

export function csvCell(value: unknown, sep: ',' | '\t'): string {
  const raw = stringifyCell(value)
  if (sep === ',') {
    if (/[",\r\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`
    return raw
  }
  // TSV has no quoting convention in general use — escape the characters that would otherwise
  // corrupt the column/row structure instead.
  return raw.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\n/g, '\\n')
}

/** How any JSON-safe value becomes ONE cell's text, for CSV/TSV/Markdown/HTML-table export.
 *  Nested values are flattened to their JSON text — see lossy.ts, which discloses this up front. */
export function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function htmlEscape(s: string): string {
  return xmlEscape(s)
}

export function mdCell(value: unknown): string {
  const raw = stringifyCell(value)
  // A pipe inside a GFM table cell breaks the column split; a literal newline breaks the row.
  return raw.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

/** A value as a YAML flow scalar/collection. Valid YAML 1.2 is a superset of JSON, so this is
 *  always correct even where it is not the prettiest possible YAML — used for values whose shape
 *  we do not want to hand-roll block emission for (see toYaml in document.ts for the block form
 *  used at the top levels a human actually edits). */
export function yamlFlow(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (typeof value === 'string') return yamlScalarString(value)
  return JSON.stringify(value)
}

const YAML_RESERVED = new Set(['null', 'Null', 'NULL', '~', 'true', 'True', 'TRUE', 'false', 'False', 'FALSE'])

export function yamlScalarString(s: string): string {
  const needsQuote =
    s.length === 0 ||
    YAML_RESERVED.has(s) ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) ||
    /: |:$/.test(s) ||
    /^\s|\s$/.test(s) ||
    /[\r\n\t]/.test(s) ||
    /^(-?\d+(\.\d+)?)$/.test(s)
  return needsQuote ? JSON.stringify(s) : s
}

export function tomlScalar(value: unknown): string | null {
  if (value === undefined || value === null) return null // caller omits the key entirely
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (typeof value === 'string') return tomlString(value)
  if (Array.isArray(value)) {
    const items = value.map((v) => tomlScalar(v)).filter((v): v is string => v !== null)
    return `[${items.join(', ')}]`
  }
  if (typeof value === 'object') {
    const parts = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        const rendered = tomlScalar(v)
        return rendered === null ? null : `${tomlKey(k)} = ${rendered}`
      })
      .filter((v): v is string => v !== null)
    return `{ ${parts.join(', ')} }`
  }
  return JSON.stringify(String(value))
}

export function tomlString(s: string): string {
  return `"${s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`
}

export function tomlKey(k: string): string {
  return /^[A-Za-z0-9_-]+$/.test(k) ? k : tomlString(k)
}

export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`
  // Nested value: stored as a JSON-encoded TEXT literal (disclosed as lossy — see lossy.ts).
  return `'${JSON.stringify(value).replace(/'/g, "''")}'`
}

/** Best-effort SQL column type from the values actually seen — INTEGER/REAL/BOOLEAN when every
 *  non-null value across every row agrees, TEXT otherwise (including for nested values, which are
 *  stored JSON-encoded). */
export function sqlColumnType(values: unknown[]): string {
  const present = values.filter((v) => v !== null && v !== undefined)
  if (present.length === 0) return 'TEXT'
  if (present.every((v) => typeof v === 'boolean')) return 'BOOLEAN'
  if (present.every((v) => typeof v === 'number' && Number.isInteger(v))) return 'INTEGER'
  if (present.every((v) => typeof v === 'number')) return 'REAL'
  return 'TEXT'
}
