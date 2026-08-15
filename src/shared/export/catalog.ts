import type { ExportFormat, ExportFormatInfo, ExportKind } from './types'

/** One entry per format this module can write. `writeOnly` formats (Markdown, HTML) are
 *  presentations of the data, not something this module reads back — offered for humans and for
 *  handing to another tool, never claimed as round-trippable. */
export const FORMAT_INFO: Record<ExportFormat, ExportFormatInfo> = {
  json: { id: 'json', label: 'JSON', extension: 'json', mimeType: 'application/json' },
  jsonl: { id: 'jsonl', label: 'JSON Lines (NDJSON)', extension: 'jsonl', mimeType: 'application/x-ndjson' },
  yaml: { id: 'yaml', label: 'YAML', extension: 'yaml', mimeType: 'application/yaml' },
  toml: { id: 'toml', label: 'TOML', extension: 'toml', mimeType: 'application/toml' },
  xml: { id: 'xml', label: 'XML', extension: 'xml', mimeType: 'application/xml' },
  csv: { id: 'csv', label: 'CSV', extension: 'csv', mimeType: 'text/csv' },
  tsv: { id: 'tsv', label: 'TSV', extension: 'tsv', mimeType: 'text/tab-separated-values' },
  markdown: {
    id: 'markdown',
    label: 'Markdown',
    extension: 'md',
    mimeType: 'text/markdown',
    writeOnly: true
  },
  html: { id: 'html', label: 'HTML', extension: 'html', mimeType: 'text/html', writeOnly: true },
  sql: { id: 'sql', label: 'SQL (CREATE TABLE + INSERT)', extension: 'sql', mimeType: 'application/sql' }
}

/** Which formats are OFFERED for a given kind of data — chosen per datum, not per app, and never
 *  a format that would have to silently drop something structural. Tabular data (a list of
 *  same-shaped records) gets the row-oriented formats; a single structured document gets the
 *  document-oriented ones; prose gets the two presentations plus a JSON wrapper so it is still
 *  machine-readable. See docs/exports.md for the reasoning per format. */
export const FORMATS_FOR_KIND: Record<ExportKind, ExportFormat[]> = {
  tabular: ['csv', 'tsv', 'json', 'jsonl', 'yaml', 'markdown', 'html', 'sql', 'xml'],
  structured: ['json', 'yaml', 'toml', 'xml', 'markdown', 'html'],
  prose: ['markdown', 'html', 'json']
}

export function formatsForKind(kind: ExportKind): ExportFormatInfo[] {
  return FORMATS_FOR_KIND[kind].map((id) => FORMAT_INFO[id])
}

/** A safe identifier for formats that restrict what a name may contain (XML tag names, SQL
 *  identifiers, TOML bare keys). Falls back to `fallback` when nothing usable survives. */
export function safeIdentifier(name: string, fallback = 'row'): string {
  const cleaned = name
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^[^A-Za-z_]+/, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  return cleaned.length > 0 ? cleaned : fallback
}
