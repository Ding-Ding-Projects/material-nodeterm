// Shared types for the export module (src/shared/export). Importable from every process — main,
// core, server and renderer — because the encoders are pure string builders with no Node/DOM/
// Electron dependency. See docs/exports.md for the format matrix and the lossy-disclosure rule.

/** Every format the export module can emit. Not every format is offered for every datum — see
 *  `FORMATS_FOR_KIND` in `catalog.ts`: a format is offered only when it can carry that KIND of
 *  data without silently dropping something. */
export type ExportFormat =
  | 'json'
  | 'jsonl'
  | 'yaml'
  | 'toml'
  | 'xml'
  | 'csv'
  | 'tsv'
  | 'markdown'
  | 'html'
  | 'sql'

/** What shape the underlying data has, which decides which formats are even offered.
 *  - `tabular`   — a list of flat-ish records with a shared set of columns (session rows,
 *                  history entries, notification lists). Offered: csv, tsv, json, jsonl, yaml,
 *                  markdown, html, sql, xml.
 *  - `structured`— one arbitrary JSON-shaped document (a settings object, a single record with
 *                  deep nesting). Offered: json, yaml, toml, xml, markdown, html.
 *  - `prose`     — plain text / long-form content (a note, a transcript). Offered: markdown,
 *                  html, json. */
export type ExportKind = 'tabular' | 'structured' | 'prose'

export interface ExportColumn {
  /** Object key this column reads from each row. */
  key: string
  /** Human label for headers. Defaults to `key`. */
  label?: string
}

/** The data to export, in the shape every encoder in this module understands. Rows may hold any
 *  JSON-safe value (string | number | boolean | null | array | plain object); `undefined`,
 *  functions and symbols are never JSON-safe and are treated as "field genuinely cannot be
 *  carried" by every format, not only the narrow ones — callers should not put them in `rows`. */
export interface ExportTable {
  /** Used as the filename stem, the XML root tag, the SQL table name, the Markdown/HTML title.
   *  Sanitized internally wherever the target format needs a restricted identifier. */
  name: string
  columns: ExportColumn[]
  rows: Record<string, unknown>[]
}

/** A single JSON-shaped document (settings, one record) rather than a list of rows. */
export interface ExportDocument {
  name: string
  data: Record<string, unknown>
}

export interface ExportFormatInfo {
  id: ExportFormat
  label: string
  extension: string
  mimeType: string
  /** True for formats this module cannot faithfully round-trip on IMPORT even though it can
   *  WRITE them (e.g. Markdown/HTML are write-only presentations here). Still shown in the
   *  picker — export is still an export — but the UI should not claim "re-importable". */
  writeOnly?: boolean
}

/** One thing a chosen format cannot carry faithfully, surfaced to the user BEFORE the export
 *  runs (never after, and never a silent truncation). `field` is a column key or `'*'` for a
 *  whole-document note. */
export interface LossyNote {
  field: string
  reason: string
}

/** The result of building an export: exactly what a caller needs to persist or preview it. Text
 *  formats always report `encoding: 'utf-8'` and `lineEnding` explicitly, in the file itself where
 *  the format allows a comment and in this record always — so a file this module wrote is
 *  self-describing to a tool other than nodeterm. */
export interface BuiltExport {
  filename: string
  mimeType: string
  content: string
  encoding: 'utf-8'
  lineEnding: 'LF' | 'CRLF'
  /** Every field this export could not carry faithfully in the chosen format. Empty when nothing
   *  was lost. Computed BEFORE encoding (see `describeLossage`), carried here so a caller that
   *  skipped the pre-export disclosure UI still has the facts. */
  lossy: LossyNote[]
}
