// Encoders for a single structured document (`ExportDocument`) — a settings object, one record
// with deep nesting. See table.ts for the row-oriented sibling.

import type { ExportDocument, ExportFormat } from './types'
import { safeIdentifier } from './catalog'
import { toYamlDocument } from './yaml-block'
import { tomlKey, tomlScalar, xmlEscape, htmlEscape, mdCell } from './scalars'

function metaHeader(name: string, format: ExportFormat, commentStart: string, commentEnd = ''): string {
  const iso = new Date().toISOString()
  return (
    `${commentStart} nodeterm export — schema nodeterm-export/v1, format ${format}` +
    `${commentEnd}\n` +
    `${commentStart} document: ${name}, exported ${iso}, encoding utf-8${commentEnd}\n`
  )
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function tomlSection(prefix: string, obj: Record<string, unknown>, out: string[]): void {
  const scalarLines: string[] = []
  const tables: [string, Record<string, unknown>][] = []
  for (const [k, v] of Object.entries(obj)) {
    if (isPlainObject(v)) {
      tables.push([k, v])
      continue
    }
    const rendered = tomlScalar(v)
    if (rendered !== null) scalarLines.push(`${tomlKey(k)} = ${rendered}`)
  }
  if (prefix) out.push(`\n[${prefix}]`)
  out.push(...scalarLines)
  for (const [k, v] of tables) tomlSection(prefix ? `${prefix}.${k}` : k, v, out)
}

function xmlNode(key: string, value: unknown, indent: string): string {
  const tag = safeIdentifier(key, 'field')
  if (value === null || value === undefined) return `${indent}<${tag}/>\n`
  if (isPlainObject(value)) {
    const inner = Object.entries(value)
      .map(([k, v]) => xmlNode(k, v, indent + '  '))
      .join('')
    return `${indent}<${tag}>\n${inner}${indent}</${tag}>\n`
  }
  if (Array.isArray(value)) {
    const inner = value.map((v) => xmlNode('item', v, indent + '  ')).join('')
    return `${indent}<${tag}>\n${inner}${indent}</${tag}>\n`
  }
  if (typeof value === 'object') {
    // Unreachable for JSON-safe input, kept for defensiveness.
    return `${indent}<${tag}><![CDATA[${JSON.stringify(value)}]]></${tag}>\n`
  }
  return `${indent}<${tag}>${xmlEscape(String(value))}</${tag}>\n`
}

function mdSection(obj: Record<string, unknown>, depth: number): string {
  let out = ''
  for (const [k, v] of Object.entries(obj)) {
    if (isPlainObject(v)) {
      out += `${'#'.repeat(Math.min(depth + 2, 6))} ${k}\n\n${mdSection(v, depth + 1)}`
    } else {
      out += `- **${k}**: ${mdCell(v)}\n`
    }
  }
  return out + '\n'
}

function htmlSection(obj: Record<string, unknown>): string {
  let out = '<dl>\n'
  for (const [k, v] of Object.entries(obj)) {
    out += `  <dt>${htmlEscape(k)}</dt>\n`
    out += isPlainObject(v)
      ? `  <dd>${htmlSection(v)}</dd>\n`
      : `  <dd>${htmlEscape(typeof v === 'string' ? v : JSON.stringify(v))}</dd>\n`
  }
  return out + '</dl>\n'
}

export function encodeDocument(doc: ExportDocument, format: ExportFormat): string {
  switch (format) {
    case 'json':
      return (
        JSON.stringify(
          {
            $schema: 'nodeterm-export/v1',
            $document: doc.name,
            $exportedAt: new Date().toISOString(),
            $encoding: 'utf-8',
            data: doc.data
          },
          null,
          2
        ) + '\n'
      )
    case 'yaml':
      return metaHeader(doc.name, format, '#') + '\n' + toYamlDocument(doc.data)
    case 'toml': {
      const lines: string[] = []
      tomlSection('', doc.data, lines)
      return metaHeader(doc.name, format, '#') + '\n' + lines.join('\n') + '\n'
    }
    case 'xml': {
      const root = safeIdentifier(doc.name, 'document')
      const inner = Object.entries(doc.data)
        .map(([k, v]) => xmlNode(k, v, '  '))
        .join('')
      return (
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<!-- nodeterm export — schema nodeterm-export/v1, exported ${new Date().toISOString()} -->\n` +
        `<${root}>\n${inner}</${root}>\n`
      )
    }
    case 'markdown':
      return (
        `<!-- nodeterm export: ${doc.name}, ${new Date().toISOString()}, format markdown (write-only — not re-importable) -->\n\n` +
        `# ${doc.name}\n\n` +
        mdSection(doc.data, 0)
      )
    case 'html':
      return (
        `<!doctype html>\n<html lang="en"><head><meta charset="utf-8">` +
        `<title>${htmlEscape(doc.name)}</title></head><body>\n` +
        `<!-- nodeterm export: ${doc.name}, ${new Date().toISOString()}, format html (write-only — not re-importable) -->\n` +
        `<h1>${htmlEscape(doc.name)}</h1>\n${htmlSection(doc.data)}</body></html>\n`
      )
    default:
      throw new Error(`${format} does not support a structured document export`)
  }
}
