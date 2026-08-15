// site/app/shared/exportFormats.js
//
// Encoders shared by every "export your data" control on the site. Records
// are always a flat array of plain objects (nested values are JSON-stringified
// inline for the tabular formats, since CSV/TSV/Markdown/HTML tables cannot
// faithfully represent nesting — that loss is disclosed by the caller BEFORE
// export, per the contract, never silently).
//
// Everything here runs in the browser only; nothing is sent anywhere. The
// caller triggers a save with `downloadFile()`, which is an ordinary
// browser download of data the visitor already owns and generated locally
// — not a fetch of a remote file.

function fieldNames(records) {
  const set = new Set()
  for (const r of records) for (const k of Object.keys(r)) set.add(k)
  return [...set]
}

function cell(value) {
  if (value == null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function toJSON(records) {
  return JSON.stringify(records, null, 2)
}

export function toJSONL(records) {
  return records.map((r) => JSON.stringify(r)).join('\n')
}

function csvEscape(value, delim) {
  const s = cell(value)
  if (s.includes(delim) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

export function toDelimited(records, delim) {
  const fields = fieldNames(records)
  const lines = [fields.map((f) => csvEscape(f, delim)).join(delim)]
  for (const r of records) {
    lines.push(fields.map((f) => csvEscape(r[f], delim)).join(delim))
  }
  return lines.join('\r\n')
}
export const toCSV = (records) => toDelimited(records, ',')
export const toTSV = (records) => toDelimited(records, '\t')

function yamlScalar(value) {
  if (value == null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const s = String(value)
  if (s === '' || /[:#\-\[\]{}",\n]/.test(s) || /^\s|\s$/.test(s)) {
    return JSON.stringify(s)
  }
  return s
}
export function toYAML(records) {
  const lines = []
  for (const r of records) {
    const keys = Object.keys(r)
    if (keys.length === 0) {
      lines.push('- {}')
      continue
    }
    keys.forEach((k, i) => {
      const value = r[k]
      const rendered = typeof value === 'object' && value != null ? JSON.stringify(value) : yamlScalar(value)
      lines.push((i === 0 ? '- ' : '  ') + k + ': ' + rendered)
    })
  }
  return lines.join('\n')
}

function tomlKey(k) {
  return /^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k)
}
function tomlValue(value) {
  if (value == null) return '""'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') return JSON.stringify(JSON.stringify(value))
  return JSON.stringify(String(value))
}
export function toTOML(records) {
  const out = []
  records.forEach((r) => {
    out.push('[[record]]')
    for (const [k, v] of Object.entries(r)) out.push(`${tomlKey(k)} = ${tomlValue(v)}`)
    out.push('')
  })
  return out.join('\n').trim() + '\n'
}

function xmlEscape(value) {
  return cell(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
export function toXML(records, rootTag = 'records', itemTag = 'record') {
  const body = records
    .map((r) => {
      const fields = Object.entries(r)
        .map(([k, v]) => `    <${xmlTag(k)}>${xmlEscape(v)}</${xmlTag(k)}>`)
        .join('\n')
      return `  <${itemTag}>\n${fields}\n  </${itemTag}>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${rootTag}>\n${body}\n</${rootTag}>\n`
}
function xmlTag(name) {
  const cleaned = String(name).replace(/[^A-Za-z0-9_.-]/g, '_')
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : 'f_' + cleaned
}

export function toMarkdownTable(records) {
  const fields = fieldNames(records)
  const esc = (v) => cell(v).replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const head = '| ' + fields.join(' | ') + ' |'
  const sep = '| ' + fields.map(() => '---').join(' | ') + ' |'
  const rows = records.map((r) => '| ' + fields.map((f) => esc(r[f])).join(' | ') + ' |')
  return [head, sep, ...rows].join('\n')
}

function htmlEscape(value) {
  return cell(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
export function toHTMLTable(records, title = 'Export') {
  const fields = fieldNames(records)
  const head = fields.map((f) => `<th>${htmlEscape(f)}</th>`).join('')
  const rows = records
    .map((r) => '<tr>' + fields.map((f) => `<td>${htmlEscape(r[f])}</td>`).join('') + '</tr>')
    .join('\n')
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${htmlEscape(
    title,
  )}</title></head><body>\n<table border="1" cellspacing="0" cellpadding="4">\n<thead><tr>${head}</tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>\n</body></html>\n`
}

export const EXPORT_FORMATS = [
  { id: 'json', label: 'JSON', ext: 'json', mime: 'application/json', encode: toJSON, lossy: false },
  { id: 'jsonl', label: 'JSONL / NDJSON', ext: 'jsonl', mime: 'application/x-ndjson', encode: toJSONL, lossy: false },
  { id: 'yaml', label: 'YAML', ext: 'yaml', mime: 'text/yaml', encode: toYAML, lossy: false },
  { id: 'toml', label: 'TOML', ext: 'toml', mime: 'text/plain', encode: toTOML, lossy: false },
  { id: 'xml', label: 'XML', ext: 'xml', mime: 'application/xml', encode: (r) => toXML(r), lossy: false },
  {
    id: 'csv',
    label: 'CSV',
    ext: 'csv',
    mime: 'text/csv',
    encode: toCSV,
    lossy: true,
    lossNote: 'Nested values are flattened to their JSON text inside one cell.',
  },
  {
    id: 'tsv',
    label: 'TSV',
    ext: 'tsv',
    mime: 'text/tab-separated-values',
    encode: toTSV,
    lossy: true,
    lossNote: 'Nested values are flattened to their JSON text inside one cell.',
  },
  {
    id: 'markdown',
    label: 'Markdown',
    ext: 'md',
    mime: 'text/markdown',
    encode: toMarkdownTable,
    lossy: true,
    lossNote: 'Rendered as a table; nested values are flattened to their JSON text.',
  },
  {
    id: 'html',
    label: 'HTML',
    ext: 'html',
    mime: 'text/html',
    encode: (r) => toHTMLTable(r),
    lossy: true,
    lossNote: 'Rendered as a table; nested values are flattened to their JSON text.',
  },
]

export function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
