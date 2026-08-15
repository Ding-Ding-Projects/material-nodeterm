// Public surface of the export module. See docs/exports.md for the format matrix, the
// lossy-disclosure rule, and how a caller wires "Save" / "Open in VS Code" on top of this.

export * from './types'
export { FORMAT_INFO, FORMATS_FOR_KIND, formatsForKind, safeIdentifier } from './catalog'
export { describeTableLossage, describeDocumentLossage } from './lossy'
export { encodeTable } from './table'
export { encodeDocument } from './document'
export { buildZip, crc32, sanitizeZipPath, type ZipEntry } from './zip'

import type { BuiltExport, ExportDocument, ExportFormat, ExportTable } from './types'
import { FORMAT_INFO, safeIdentifier } from './catalog'
import { describeTableLossage, describeDocumentLossage } from './lossy'
import { encodeTable } from './table'
import { encodeDocument } from './document'
import { buildZip, type ZipEntry } from './zip'

const LINE_ENDING_BY_FORMAT: Record<ExportFormat, 'LF' | 'CRLF'> = {
  csv: 'CRLF',
  tsv: 'LF',
  json: 'LF',
  jsonl: 'LF',
  yaml: 'LF',
  toml: 'LF',
  xml: 'LF',
  markdown: 'LF',
  html: 'LF',
  sql: 'LF'
}

function filename(name: string, format: ExportFormat): string {
  return `${safeIdentifier(name, 'export')}.${FORMAT_INFO[format].extension}`
}

/** Build a complete, ready-to-save export of a list of records. Computes the lossy disclosure for
 *  the SAME format being encoded, so `lossy` on the result is always accurate for `content`. */
export function buildTableExport(table: ExportTable, format: ExportFormat): BuiltExport {
  return {
    filename: filename(table.name, format),
    mimeType: FORMAT_INFO[format].mimeType,
    content: encodeTable(table, format),
    encoding: 'utf-8',
    lineEnding: LINE_ENDING_BY_FORMAT[format],
    lossy: describeTableLossage(table, format)
  }
}

/** Build a complete, ready-to-save export of one structured document (e.g. settings.json). */
export function buildDocumentExport(doc: ExportDocument, format: ExportFormat): BuiltExport {
  return {
    filename: filename(doc.name, format),
    mimeType: FORMAT_INFO[format].mimeType,
    content: encodeDocument(doc, format),
    encoding: 'utf-8',
    lineEnding: LINE_ENDING_BY_FORMAT[format],
    lossy: describeDocumentLossage(doc, format)
  }
}

export interface ArchiveMember {
  /** Relative path INSIDE the archive (e.g. "sessions.csv", "settings/settings.json"). */
  path: string
  built: BuiltExport
}

/** Bundle several already-built exports into one ZIP, plus a MANIFEST.json naming every member,
 *  its format, its byte size and any lossy notes — the sidecar metadata a single JSONL/CSV file
 *  cannot carry inline (see table.ts's note on why JSONL stays header-free). Paths are sanitized
 *  by `buildZip` itself; this only shapes the manifest and the file list. */
export function buildArchive(name: string, members: ArchiveMember[]): { filename: string; mimeType: string; bytes: Uint8Array } {
  const encoder = new TextEncoder()
  const entries: ZipEntry[] = members.map((m) => ({ path: m.path, data: encoder.encode(m.built.content) }))
  const manifest = {
    $schema: 'nodeterm-export-manifest/v1',
    archive: name,
    exportedAt: new Date().toISOString(),
    encoding: 'utf-8',
    members: members.map((m) => ({
      path: m.path,
      filename: m.built.filename,
      mimeType: m.built.mimeType,
      lineEnding: m.built.lineEnding,
      bytes: m.built.content.length,
      lossy: m.built.lossy
    }))
  }
  entries.push({ path: 'MANIFEST.json', data: encoder.encode(JSON.stringify(manifest, null, 2) + '\n') })
  return {
    filename: `${safeIdentifier(name, 'export')}.zip`,
    mimeType: 'application/zip',
    bytes: buildZip(entries)
  }
}
