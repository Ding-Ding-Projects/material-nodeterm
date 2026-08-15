// Hand-rolled, dependency-free codecs for the "structured data" mesh (JSON, YAML, TOML, XML, CSV,
// TSV) that src/shared/converter.ts's buildStructuredMesh() turns into catalog rows. Every codec
// parses TEXT -> a JSON-compatible `StructuredValue` and serializes `StructuredValue` -> TEXT, so
// the registry (registry.ts) composes any pair of them through that one shared shape.
//
// These are deliberately a SUBSET of their real specs, not full parsers — see docs/file-converter.md
// for exactly what each one supports. Every conversion is validated by round-tripping the produced
// text back through the SAME format's own parser before it is accepted (see registry.ts), so a
// shape this codec cannot represent surfaces as a clear failure rather than silently-wrong output.

export type StructuredValue =
  | null
  | boolean
  | number
  | string
  | StructuredValue[]
  | { [key: string]: StructuredValue }

export class StructuredCodecError extends Error {}

// ---------------------------------------------------------------------------------------------
// JSON — the reference shape, native.
// ---------------------------------------------------------------------------------------------

export function parseJson(text: string): StructuredValue {
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new StructuredCodecError(`Invalid JSON: ${(e as Error).message}`)
  }
}

export function serializeJson(value: StructuredValue): string {
  return JSON.stringify(value, null, 2) + '\n'
}

// ---------------------------------------------------------------------------------------------
// YAML — block style only (no anchors/aliases/tags/multi-document streams).
// ---------------------------------------------------------------------------------------------

function yamlScalar(v: string | number | boolean | null): string {
  if (v === null) return 'null'
  if (typeof v === 'boolean' || typeof v === 'number') return String(v)
  if (v === '') return "''"
  const needsQuote =
    /^[\s]|[\s]$/.test(v) ||
    /^(true|false|null|~|yes|no)$/i.test(v) ||
    /^-?\d+(\.\d+)?$/.test(v) ||
    /[:#\[\]{}&*!|>'"%@`,]/.test(v) ||
    v.includes('\n') ||
    v.startsWith('-') ||
    v.startsWith('?')
  if (!needsQuote) return v
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

function dumpYaml(value: StructuredValue, indent: number): string {
  const pad = '  '.repeat(indent)
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return yamlScalar(value)
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return value
      .map((item) => {
        const nonEmptyNested =
          item !== null &&
          typeof item === 'object' &&
          (Array.isArray(item) ? item.length > 0 : Object.keys(item).length > 0)
        if (nonEmptyNested) {
          // dumpYaml(item, indent+1) renders EVERY line with exactly (indent+1)*2 leading spaces.
          // `marker` (pad + "- ") is exactly that many characters, so slicing it off the FRONT of
          // the whole string removes only the first line's own leading spaces — every later line's
          // indentation is untouched, keeping the nested mapping/sequence's keys aligned with each
          // other (not just with the dash). Do not "simplify" this by touching line 1 alone.
          const marker = `${pad}- `
          const inner = dumpYaml(item, indent + 1)
          return marker + inner.slice(marker.length)
        }
        return `${pad}- ${dumpYaml(item, indent + 1)}`
      })
      .join('\n')
  }
  const keys = Object.keys(value)
  if (keys.length === 0) return '{}'
  return keys
    .map((k) => {
      const v = value[k]
      const key = /^[\w.\-]+$/.test(k) ? k : yamlScalar(k)
      if (v !== null && typeof v === 'object' && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0)) {
        return `${pad}${key}:\n${dumpYaml(v, indent + 1)}`
      }
      return `${pad}${key}: ${dumpYaml(v, indent + 1)}`
    })
    .join('\n')
}

export function serializeYaml(value: StructuredValue): string {
  if (value === null || typeof value !== 'object') return `${yamlScalar(value as any)}\n`
  return dumpYaml(value, 0) + '\n'
}

function yamlParseScalar(raw: string): StructuredValue {
  const s = raw.trim()
  if (s === '' || s === '~' || /^null$/i.test(s)) return null
  if (/^true$/i.test(s)) return true
  if (/^false$/i.test(s)) return false
  if (/^-?\d+$/.test(s)) return parseInt(s, 10)
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s)
  if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2)) {
    return s.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1).replace(/''/g, "'")
  if (s.startsWith('[') && s.endsWith(']')) return yamlParseFlow(s)
  if (s.startsWith('{') && s.endsWith('}')) return yamlParseFlow(s)
  return s
}

/** Minimal flow-collection parser: splits on top-level commas (respecting one level of bracket/
 *  quote nesting) and recurses. Does not support nested flow collections inside flow collections. */
function yamlParseFlow(s: string): StructuredValue {
  const inner = s.slice(1, -1).trim()
  if (inner === '') return s.startsWith('[') ? [] : {}
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let cur = ''
  for (const ch of inner) {
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
      continue
    }
    if (ch === '[' || ch === '{') depth++
    if (ch === ']' || ch === '}') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) parts.push(cur)
  if (s.startsWith('[')) return parts.map((p) => yamlParseScalar(p))
  const obj: Record<string, StructuredValue> = {}
  for (const p of parts) {
    const idx = p.indexOf(':')
    if (idx === -1) continue
    obj[p.slice(0, idx).trim()] = yamlParseScalar(p.slice(idx + 1))
  }
  return obj
}

interface YamlLine {
  indent: number
  text: string
}

function yamlLines(text: string): YamlLine[] {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('#') && l.trim() !== '---')
    .map((l) => ({ indent: l.length - l.trimStart().length, text: l.trim() }))
}

/** True when `rest` (the text right after "- " in a sequence item) starts a "- key: value" inline
 *  mapping rather than being a plain scalar. Mirrors YAML's own disambiguation rule: a colon only
 *  introduces a mapping when it is followed by whitespace or end-of-line — "http://example.com" is
 *  a scalar (no space after either colon), but "url: http://example.com" is a mapping. A quoted
 *  scalar (starts with `"`/`'`) is never a mapping key here either — our own serializer quotes any
 *  string containing a colon, so without this guard a quoted URL would misparse the same way. */
function isInlineMappingStart(rest: string): boolean {
  if (rest[0] === '"' || rest[0] === "'") return false
  const idx = rest.indexOf(':')
  if (idx === -1) return false
  const after = rest.slice(idx + 1)
  return after === '' || /^\s/.test(after)
}

function yamlParseBlock(lines: YamlLine[], start: number, indent: number): [StructuredValue, number] {
  if (start >= lines.length || lines[start].indent < indent) return [null, start]
  const first = lines[start]
  if (first.text.startsWith('- ') || first.text === '-') {
    const arr: StructuredValue[] = []
    let i = start
    while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith('- ') || lines[i].text === '-')) {
      const rest = lines[i].text === '-' ? '' : lines[i].text.slice(2)
      if (rest === '') {
        const [v, next] = yamlParseBlock(lines, i + 1, indent + 1)
        arr.push(v)
        i = next
      } else if (isInlineMappingStart(rest)) {
        // Inline "- key: value" starts a mapping at this same indent level, first key on the dash
        // line, remaining keys (if any) indented one level deeper than the dash.
        const synthetic: YamlLine[] = [{ indent: indent + 1, text: rest }, ...lines.slice(i + 1)]
        const [v, consumed] = yamlParseBlock(synthetic, 0, indent + 1)
        arr.push(v)
        i = i + 1 + (consumed - 1)
      } else {
        arr.push(yamlParseScalar(rest))
        i++
      }
    }
    return [arr, i]
  }
  const obj: Record<string, StructuredValue> = {}
  let i = start
  while (i < lines.length && lines[i].indent === indent) {
    const line = lines[i].text
    const idx = line.indexOf(':')
    if (idx === -1) throw new StructuredCodecError(`Invalid YAML mapping line: "${line}"`)
    let key = line.slice(0, idx).trim()
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
      key = key.slice(1, -1)
    }
    const rest = line.slice(idx + 1).trim()
    if (rest === '') {
      const [v, next] = yamlParseBlock(lines, i + 1, indent + 1)
      obj[key] = next > i + 1 ? v : null
      i = next > i + 1 ? next : i + 1
    } else {
      obj[key] = yamlParseScalar(rest)
      i++
    }
  }
  return [obj, i]
}

export function parseYaml(text: string): StructuredValue {
  const lines = yamlLines(text)
  if (lines.length === 0) return null
  const [value] = yamlParseBlock(lines, 0, lines[0].indent)
  return value
}

// ---------------------------------------------------------------------------------------------
// TOML — flat + nested tables via [section]/[section.sub], array-of-tables via [[section]].
// No `null` (TOML has none — dropped on serialize, documented as lossy in the catalog).
// ---------------------------------------------------------------------------------------------

function tomlScalar(v: StructuredValue): string {
  if (v === null) throw new StructuredCodecError('TOML has no null')
  if (typeof v === 'boolean' || typeof v === 'number') return String(v)
  if (typeof v === 'string') return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
  if (Array.isArray(v)) return `[${v.map((x) => tomlScalar(x)).join(', ')}]`
  throw new StructuredCodecError('Nested object cannot appear as a TOML inline value')
}

function isPlainObject(v: StructuredValue): v is Record<string, StructuredValue> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isArrayOfTables(v: StructuredValue): v is Record<string, StructuredValue>[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => isPlainObject(x))
}

function dumpTomlTable(value: Record<string, StructuredValue>, path: string[], out: string[]): void {
  const scalars: [string, StructuredValue][] = []
  const tables: [string, Record<string, StructuredValue>][] = []
  const arrayTables: [string, Record<string, StructuredValue>[]][] = []
  for (const [k, v] of Object.entries(value)) {
    if (v === null) continue // TOML has no null — dropped (documented lossy conversion)
    if (isArrayOfTables(v)) arrayTables.push([k, v])
    else if (isPlainObject(v)) tables.push([k, v])
    else scalars.push([k, v])
  }
  if (path.length > 0) out.push(`[${path.join('.')}]`)
  for (const [k, v] of scalars) out.push(`${/^[\w-]+$/.test(k) ? k : `"${k}"`} = ${tomlScalar(v)}`)
  for (const [k, v] of tables) dumpTomlTable(v, [...path, k], out)
  for (const [k, arr] of arrayTables) {
    for (const item of arr) {
      out.push(`[[${[...path, k].join('.')}]]`)
      dumpTomlTable(item, [], out)
    }
  }
}

export function serializeToml(value: StructuredValue): string {
  if (!isPlainObject(value)) {
    throw new StructuredCodecError('TOML can only represent a top-level object (table)')
  }
  const out: string[] = []
  dumpTomlTable(value, [], out)
  return out.join('\n') + '\n'
}

function tomlParseValue(raw: string): StructuredValue {
  const s = raw.trim()
  if (/^true$/i.test(s)) return true
  if (/^false$/i.test(s)) return false
  if (/^-?\d+$/.test(s)) return parseInt(s, 10)
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s)
  if (s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1)
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim()
    if (inner === '') return []
    return splitTopLevel(inner).map((p) => tomlParseValue(p))
  }
  return s
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let cur = ''
  for (const ch of s) {
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
      continue
    }
    if (ch === '[') depth++
    if (ch === ']') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts
}

function tomlTableAt(root: Record<string, StructuredValue>, path: string[]): Record<string, StructuredValue> {
  let cur = root
  for (const key of path) {
    if (!isPlainObject(cur[key])) cur[key] = {}
    cur = cur[key] as Record<string, StructuredValue>
  }
  return cur
}

export function parseToml(text: string): StructuredValue {
  const root: Record<string, StructuredValue> = {}
  let cursor: Record<string, StructuredValue> = root
  const arrayTableCounts = new Map<string, number>()
  for (const rawLine of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const arrTableMatch = line.match(/^\[\[([\w.\-"' ]+)\]\]$/)
    if (arrTableMatch) {
      const path = arrTableMatch[1].split('.').map((p) => p.trim().replace(/^["']|["']$/g, ''))
      const key = path.join('.')
      const count = (arrayTableCounts.get(key) ?? 0) + 1
      arrayTableCounts.set(key, count)
      const parentPath = path.slice(0, -1)
      const leafKey = path[path.length - 1]
      const parent = tomlTableAt(root, parentPath)
      if (!Array.isArray(parent[leafKey])) parent[leafKey] = []
      const entry: Record<string, StructuredValue> = {}
      ;(parent[leafKey] as StructuredValue[]).push(entry)
      cursor = entry
      continue
    }
    const tableMatch = line.match(/^\[([\w.\-"' ]+)\]$/)
    if (tableMatch) {
      const path = tableMatch[1].split('.').map((p) => p.trim().replace(/^["']|["']$/g, ''))
      cursor = tomlTableAt(root, path)
      continue
    }
    const idx = line.indexOf('=')
    if (idx === -1) throw new StructuredCodecError(`Invalid TOML line: "${line}"`)
    let key = line.slice(0, idx).trim()
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
      key = key.slice(1, -1)
    }
    cursor[key] = tomlParseValue(line.slice(idx + 1))
  }
  return root
}

// ---------------------------------------------------------------------------------------------
// XML — this app's own JSON<->XML convention: object keys become child elements, arrays repeat
// the same element name, primitives become text content. No attributes, no namespaces, no
// mixed content, no comments/CDATA preserved on the way OUT (all disclosed as lossy in the
// catalog). Parsing IN accepts ordinary well-formed XML and drops anything it can't represent.
// ---------------------------------------------------------------------------------------------

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function dumpXmlValue(value: StructuredValue, tag: string, indent: number): string {
  const pad = '  '.repeat(indent)
  if (value === null) return `${pad}<${tag}/>`
  if (typeof value !== 'object') return `${pad}<${tag}>${xmlEscape(String(value))}</${tag}>`
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}<${tag}/>`
    return value.map((item) => dumpXmlValue(item, tag, indent)).join('\n')
  }
  const keys = Object.keys(value)
  if (keys.length === 0) return `${pad}<${tag}/>`
  const inner = keys.map((k) => dumpXmlValue(value[k], k, indent + 1)).join('\n')
  return `${pad}<${tag}>\n${inner}\n${pad}</${tag}>`
}

export function serializeXml(value: StructuredValue, rootTag = 'root'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${dumpXmlValue(value, rootTag, 0)}\n`
}

interface XmlElement {
  tag: string
  children: XmlElement[]
  text: string
}

function xmlTokenize(text: string): XmlElement {
  let i = 0
  const src = text
  function skipWs(): void {
    while (i < src.length && /\s/.test(src[i])) i++
  }
  function skipProlog(): void {
    skipWs()
    while (src.startsWith('<?', i) || src.startsWith('<!--', i) || src.startsWith('<!', i)) {
      if (src.startsWith('<!--', i)) {
        const end = src.indexOf('-->', i)
        i = end === -1 ? src.length : end + 3
      } else {
        const end = src.indexOf('>', i)
        i = end === -1 ? src.length : end + 1
      }
      skipWs()
    }
  }
  function readTagName(): string {
    const start = i
    while (i < src.length && !/[\s/>]/.test(src[i])) i++
    return src.slice(start, i)
  }
  function skipAttrs(): void {
    while (i < src.length && src[i] !== '>' && src[i] !== '/') i++
  }
  function parseElement(): XmlElement {
    skipWs()
    if (src[i] !== '<') throw new StructuredCodecError('Malformed XML: expected "<"')
    i++
    const tag = readTagName()
    skipAttrs()
    if (src[i] === '/' && src[i + 1] === '>') {
      i += 2
      return { tag, children: [], text: '' }
    }
    if (src[i] !== '>') throw new StructuredCodecError('Malformed XML: unterminated open tag')
    i++
    const children: XmlElement[] = []
    let text = ''
    while (i < src.length) {
      if (src.startsWith('<!--', i)) {
        const end = src.indexOf('-->', i)
        i = end === -1 ? src.length : end + 3
        continue
      }
      if (src.startsWith(`</${tag}`, i)) {
        const end = src.indexOf('>', i)
        i = end === -1 ? src.length : end + 1
        break
      }
      if (src[i] === '<') {
        children.push(parseElement())
      } else {
        const start = i
        while (i < src.length && src[i] !== '<') i++
        text += src.slice(start, i)
      }
    }
    return { tag, children, text: text.trim() }
  }
  skipProlog()
  return parseElement()
}

function xmlUnescape(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

function xmlElementToValue(el: XmlElement): StructuredValue {
  if (el.children.length === 0) {
    if (el.text === '') return null
    const t = xmlUnescape(el.text)
    if (/^true$/i.test(t)) return true
    if (/^false$/i.test(t)) return false
    if (/^-?\d+$/.test(t)) return parseInt(t, 10)
    if (/^-?\d+\.\d+$/.test(t)) return parseFloat(t)
    return t
  }
  const groups = new Map<string, XmlElement[]>()
  for (const child of el.children) {
    const g = groups.get(child.tag) ?? []
    g.push(child)
    groups.set(child.tag, g)
  }
  const obj: Record<string, StructuredValue> = {}
  for (const [tag, els] of groups) {
    obj[tag] = els.length > 1 ? els.map(xmlElementToValue) : xmlElementToValue(els[0])
  }
  return obj
}

export function parseXml(text: string): StructuredValue {
  const root = xmlTokenize(text)
  return xmlElementToValue(root)
}

// ---------------------------------------------------------------------------------------------
// CSV / TSV — array of flat objects only. Reading coerces "true"/"false" and plain integers/
// decimals for a friendlier JSON round trip; everything else stays a string (documented).
// ---------------------------------------------------------------------------------------------

function splitDelimited(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === delim) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
}

function csvCoerce(raw: string): StructuredValue {
  if (raw === '') return ''
  if (/^true$/i.test(raw)) return true
  if (/^false$/i.test(raw)) return false
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10)
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw)
  return raw
}

function parseDelimited(text: string, delim: string): StructuredValue {
  const lines = text.replace(/\r\n/g, '\n').replace(/﻿/, '').split('\n').filter((l) => l.length > 0)
  if (lines.length === 0) return []
  const headers = splitDelimited(lines[0], delim)
  const rows: Record<string, StructuredValue>[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = splitDelimited(lines[i], delim)
    const row: Record<string, StructuredValue> = {}
    headers.forEach((h, idx) => {
      row[h] = csvCoerce(cells[idx] ?? '')
    })
    rows.push(row)
  }
  return rows
}

function csvCellFor(v: StructuredValue, delim: string): string {
  const s = v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (s.includes(delim) || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
  return s
}

function serializeDelimited(value: StructuredValue, delim: string): string {
  if (!Array.isArray(value) || !value.every((v) => isPlainObject(v))) {
    throw new StructuredCodecError('Only a flat array of objects can be written as CSV/TSV')
  }
  const rows = value as Record<string, StructuredValue>[]
  const headerSet = new Set<string>()
  for (const row of rows) for (const k of Object.keys(row)) headerSet.add(k)
  const headers = [...headerSet]
  const lines = [headers.map((h) => csvCellFor(h, delim)).join(delim)]
  for (const row of rows) lines.push(headers.map((h) => csvCellFor(row[h] ?? '', delim)).join(delim))
  return lines.join('\n') + '\n'
}

export function parseCsv(text: string): StructuredValue {
  return parseDelimited(text, ',')
}
export function serializeCsv(value: StructuredValue): string {
  return serializeDelimited(value, ',')
}
export function parseTsv(text: string): StructuredValue {
  return parseDelimited(text, '\t')
}
export function serializeTsv(value: StructuredValue): string {
  return serializeDelimited(value, '\t')
}
