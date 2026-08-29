// Encoders for a list of same-shaped records (`ExportTable`) — session rows, history entries,
// notification lists. See document.ts for the single-structured-document sibling.

import type { ExportTable, ExportFormat } from './types'
import { safeIdentifier } from './catalog'
import { toYamlDocument } from './yaml-block'
import {
  csvCell,
  mdCell,
  htmlEscape,
  xmlEscape,
  sqlLiteral,
  sqlColumnType
} from './scalars'

function columnLabel(c: ExportTable['columns'][number]): string {
  return c.label ?? c.key
}

function metaComment(table: ExportTable, format: ExportFormat, start: string, end = ''): string {
  return (
    `${start} nodeterm export — schema nodeterm-export/v1, format ${format}${end}\n` +
    `${start} table: ${table.name}, ${table.rows.length} row(s), exported ${new Date().toISOString()}, encoding utf-8${end}\n`
  )
}

function delimited(table: ExportTable, sep: ',' | '\t'): string {
  const header = table.columns.map((c) => csvCell(columnLabel(c), sep)).join(sep)
  const lines = table.rows.map((r) => table.columns.map((c) => csvCell(r[c.key], sep)).join(sep))
  const eol = sep === ',' ? '\r\n' : '\n'
  return [header, ...lines].join(eol) + eol
}

function toMarkdownTable(table: ExportTable): string {
  const header = `| ${table.columns.map(columnLabel).join(' | ')} |`
  const sep = `| ${table.columns.map(() => '---').join(' | ')} |`
  const rows = table.rows.map(
    (r) => `| ${table.columns.map((c) => mdCell(r[c.key])).join(' | ')} |`
  )
  return [header, sep, ...rows].join('\n') + '\n'
}

function toHtmlTable(table: ExportTable): string {
  const thead = `<thead><tr>${table.columns.map((c) => `<th>${htmlEscape(columnLabel(c))}</th>`).join('')}</tr></thead>`
  const tbody = `<tbody>${table.rows
    .map(
      (r) =>
        `<tr>${table.columns
          .map((c) => {
            const v = r[c.key]
            const text = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v)
            return `<td>${htmlEscape(text)}</td>`
          })
          .join('')}</tr>`
    )
    .join('')}</tbody>`
  return `<table>\n${thead}\n${tbody}\n</table>\n`
}

function toXmlTable(table: ExportTable): string {
  const root = safeIdentifier(table.name, 'rows')
  const rowTag = 'row'
  const rows = table.rows
    .map((r) => {
      const cells = table.columns
        .map((c) => {
          const key = safeIdentifier(c.key, 'field')
          const v = r[c.key]
          if (v === null || v === undefined) return `    <${key}/>\n`
          if (typeof v === 'object')
            return `    <${key}><![CDATA[${JSON.stringify(v)}]]></${key}>\n`
          return `    <${key}>${xmlEscape(String(v))}</${key}>\n`
        })
        .join('')
      return `  <${rowTag}>\n${cells}  </${rowTag}>\n`
    })
    .join('')
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!-- nodeterm export — schema nodeterm-export/v1, ${table.rows.length} row(s), exported ${new Date().toISOString()} -->\n` +
    `<${root}>\n${rows}</${root}>\n`
  )
}

function toSql(table: ExportTable): string {
  const tableName = safeIdentifier(table.name, 'export_rows')
  const columnTypes = table.columns.map((c) => ({
    name: safeIdentifier(c.key, 'col'),
    type: sqlColumnType(table.rows.map((r) => r[c.key]))
  }))
  const create =
    `CREATE TABLE IF NOT EXISTS "${tableName}" (\n` +
    columnTypes.map((c) => `  "${c.name}" ${c.type}`).join(',\n') +
    `\n);\n`
  const columnList = columnTypes.map((c) => `"${c.name}"`).join(', ')
  const inserts = table.rows
    .map((r) => {
      const values = table.columns.map((c) => sqlLiteral(r[c.key])).join(', ')
      return `INSERT INTO "${tableName}" (${columnList}) VALUES (${values});`
    })
    .join('\n')
  return (
    `-- nodeterm export — schema nodeterm-export/v1, ${table.rows.length} row(s), exported ${new Date().toISOString()}, encoding utf-8\n` +
    create +
    (inserts ? inserts + '\n' : '')
  )
}

export function encodeTable(table: ExportTable, format: ExportFormat): string {
  switch (format) {
    case 'csv':
      return metaCsvComment(table) + delimited(table, ',')
    case 'tsv':
      return delimited(table, '\t')
    case 'json':
      return (
        JSON.stringify(
          {
            $schema: 'nodeterm-export/v1',
            $table: table.name,
            $exportedAt: new Date().toISOString(),
            $encoding: 'utf-8',
            columns: table.columns.map((c) => ({ key: c.key, label: columnLabel(c) })),
            rows: table.rows
          },
          null,
          2
        ) + '\n'
      )
    case 'jsonl':
      // Pure JSONL — no embedded header line, so every line stays a uniform record (see
      // docs/exports.md for why the metadata rides in the returned BuiltExport instead).
      return table.rows.map((r) => JSON.stringify(r)).join('\n') + (table.rows.length ? '\n' : '')
    case 'yaml':
      return (
        metaComment(table, format, '#') +
        '\n' +
        toYamlDocument({ table: table.name, rows: table.rows })
      )
    case 'markdown':
      return (
        `<!-- nodeterm export: ${table.name}, ${table.rows.length} row(s), ${new Date().toISOString()} -->\n\n` +
        `# ${table.name}\n\n` +
        toMarkdownTable(table)
      )
    case 'html':
      return (
        `<!doctype html>\n<html lang="en"><head><meta charset="utf-8">` +
        `<title>${htmlEscape(table.name)}</title></head><body>\n` +
        `<!-- nodeterm export: ${table.name}, ${table.rows.length} row(s), ${new Date().toISOString()} -->\n` +
        `<h1>${htmlEscape(table.name)}</h1>\n${toHtmlTable(table)}</body></html>\n`
      )
    case 'sql':
      return toSql(table)
    case 'xml':
      return toXmlTable(table)
    default:
      throw new Error(`${format} does not support a tabular export`)
  }
}

// CSV cannot start with a `#` comment line without corrupting a naive reader's header detection
// (some tools treat the first `#`-line as a comment, most don't). We keep CSV metadata-free in
// the FILE and rely on the returned BuiltExport for the facts — this helper exists only so the
// intent is visible at the call site above rather than a silently-empty string.
function metaCsvComment(_table: ExportTable): string {
  return ''
}
