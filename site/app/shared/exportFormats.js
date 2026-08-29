// site/app/shared/exportFormats.js
//
// The ten export shapes the "Take it home" room offers, and the function
// that actually serializes a list of plain-object records into each one.
// Every shape is attempted; the ones that cannot carry every field say so
// (FORMATS[].loss) instead of silently losing data.

import { FORMATS } from './data.js'

export const EXPORT_FORMATS = FORMATS

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function cellOf(record, key) {
  const v = record[key]
  if (v === undefined || v === null) return ''
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

export function emit(records, to) {
  const rows = records || []
  const keys = Array.from(
    rows.reduce((set, r) => {
      Object.keys(r || {}).forEach((k) => set.add(k))
      return set
    }, new Set()),
  )
  if (to === 'json') return JSON.stringify(rows, null, 2)
  if (to === 'jsonl') return rows.map((r) => JSON.stringify(r)).join('\n')
  if (to === 'yaml') return rows.map((r) => '- ' + keys.map((k) => k + ': ' + cellOf(r, k)).join('\n  ')).join('\n')
  if (to === 'toml') return rows.map((r) => '[[item]]\n' + keys.map((k) => k + ' = "' + cellOf(r, k).replace(/"/g, '\\"') + '"').join('\n')).join('\n\n')
  if (to === 'csv') return [keys.join(',')].concat(rows.map((r) => keys.map((k) => '"' + cellOf(r, k).replace(/"/g, '""') + '"').join(','))).join('\n')
  if (to === 'tsv') return [keys.join('\t')].concat(rows.map((r) => keys.map((k) => cellOf(r, k).replace(/\t/g, ' ')).join('\t'))).join('\n')
  if (to === 'xml')
    return (
      '<items>\n' +
      rows.map((r) => '  <item>\n' + keys.map((k) => '    <' + k + '>' + esc(cellOf(r, k)) + '</' + k + '>').join('\n') + '\n  </item>').join('\n') +
      '\n</items>'
    )
  if (to === 'md')
    return (
      '| ' + keys.join(' | ') + ' |\n| ' + keys.map(() => '---').join(' | ') + ' |\n' +
      rows.map((r) => '| ' + keys.map((k) => cellOf(r, k).replace(/\n/g, ' ')).join(' | ') + ' |').join('\n')
    )
  if (to === 'html')
    return (
      '<table>\n  <tr>' + keys.map((k) => '<th>' + esc(k) + '</th>').join('') + '</tr>\n' +
      rows.map((r) => '  <tr>' + keys.map((k) => '<td>' + esc(cellOf(r, k)) + '</td>').join('') + '</tr>').join('\n') +
      '\n</table>'
    )
  if (to === 'sql')
    return rows
      .map((r) => 'INSERT INTO items (' + keys.join(', ') + ') VALUES (' + keys.map((k) => "'" + cellOf(r, k).replace(/'/g, "''") + "'").join(', ') + ');')
      .join('\n')
  return rows.map((r) => keys.map((k) => cellOf(r, k)).join(' ')).join('\n')
}
