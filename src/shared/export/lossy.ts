// What a chosen format cannot carry faithfully — computed BEFORE the export runs so the picker
// can show it, per the rule: never offer a format that would silently drop a field. A format that
// merely FLATTENS a nested value into a JSON-text cell (CSV/TSV/SQL/Markdown/HTML/XML) is disclosed
// too — the bytes survive, but the structure a re-import would need does not, which is exactly the
// kind of surprise this exists to name up front rather than let a user discover after the fact.

import type { ExportFormat, ExportTable, ExportDocument, LossyNote } from './types'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNestedValue(v: unknown): boolean {
  return isPlainObject(v) || Array.isArray(v)
}

/** Every value across every row for `key`, deduped by JS-typeof-ish kind. Cheap: history/session
 *  lists this module exports are never large enough to warrant sampling. */
function columnHasKindAcross(rows: Record<string, unknown>[], key: string, test: (v: unknown) => boolean): boolean {
  return rows.some((r) => key in r && test(r[key]))
}

/** Lossage for a TABULAR export (`ExportTable`) in the chosen format. */
export function describeTableLossage(table: ExportTable, format: ExportFormat): LossyNote[] {
  const notes: LossyNote[] = []
  const nestedFlattened = (): boolean =>
    format === 'csv' || format === 'tsv' || format === 'sql' || format === 'markdown' || format === 'html'

  for (const col of table.columns) {
    const hasNested = columnHasKindAcross(table.rows, col.key, isNestedValue)
    const hasUndefined = columnHasKindAcross(table.rows, col.key, (v) => v === undefined)
    const hasNull = columnHasKindAcross(table.rows, col.key, (v) => v === null)

    if (hasNested && nestedFlattened()) {
      notes.push({
        field: col.key,
        reason: `Nested value flattened to a JSON-text cell — the structure will not survive re-import as ${format.toUpperCase()}.`
      })
    }
    if (hasNested && format === 'xml') {
      notes.push({
        field: col.key,
        reason: 'Nested value written as a CDATA JSON block inside its element, not as native XML child elements.'
      })
    }
    if (hasNested && format === 'toml') {
      notes.push({
        field: col.key,
        reason: 'Nested arrays/objects are written as inline TOML arrays/inline tables. Deeply irregular shapes may not stay valid TOML — prefer JSON/YAML for this data.'
      })
    }
    if (hasUndefined && format !== 'json' && format !== 'yaml') {
      notes.push({ field: col.key, reason: 'Missing (undefined) values become an empty field.' })
    }
    if (hasNull && format === 'toml') {
      notes.push({
        field: col.key,
        reason: 'TOML has no null type — rows where this is null OMIT the key entirely rather than writing an empty string.'
      })
    }
    if (hasNull && (format === 'csv' || format === 'tsv')) {
      notes.push({
        field: col.key,
        reason: 'Null is written as an empty field, indistinguishable from an empty string on re-import.'
      })
    }
  }
  return notes
}

/** Lossage for a STRUCTURED export (`ExportDocument`) in the chosen format. */
export function describeDocumentLossage(doc: ExportDocument, format: ExportFormat): LossyNote[] {
  const notes: LossyNote[] = []
  if (format === 'toml') {
    for (const [k, v] of Object.entries(doc.data)) {
      if (v === null) notes.push({ field: k, reason: 'TOML has no null type — this key is omitted.' })
    }
  }
  if (format === 'markdown' || format === 'html') {
    notes.push({
      field: '*',
      reason: `${format === 'markdown' ? 'Markdown' : 'HTML'} is a presentation of this document, not a re-importable data format.`
    })
  }
  return notes
}
