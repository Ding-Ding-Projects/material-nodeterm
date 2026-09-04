import { describe, expect, it } from 'vitest'
import {
  PORTABLE_PROJECT_SCHEMA,
  PORTABLE_PROJECT_SCHEMA_VERSION,
  parsePortableProjectV3Manifest,
  portableArchivePathKey,
  validatePortableArchivePath,
  migratePortableProject,
  type PortableProjectV3Manifest
} from './portable-project-v3'

const hash = 'a'.repeat(64)
const base = (): PortableProjectV3Manifest => ({
  schema: PORTABLE_PROJECT_SCHEMA,
  schemaVersion: PORTABLE_PROJECT_SCHEMA_VERSION,
  project: { name: 'Board' },
  entries: [
    { path: 'project.json', sha256: hash, rawBytes: 1, compressedBytes: 1, required: true },
    { path: 'history.bundle', sha256: hash, rawBytes: 1, compressedBytes: 1, required: true }
  ],
  omissions: []
})

describe('portable schema 3 manifest boundary', () => {
  it('rejects duplicate JSON keys before JSON.parse can hide the first value', () => {
    const json = JSON.stringify(base()).replace('"omissions":[]', '"omissions":[],"omissions":[]')
    expect(() => parsePortableProjectV3Manifest(new TextEncoder().encode(json))).toThrow(/duplicate JSON key/)
  })

  it('rejects unknown manifest, entry, and project keys', () => {
    expect(() => parsePortableProjectV3Manifest(new TextEncoder().encode(JSON.stringify({ ...base(), extra: true })))).toThrow(/unknown key/)
    const withEntry = base()
    ;(withEntry.entries[0] as unknown as Record<string, unknown>).extra = true
    expect(() => parsePortableProjectV3Manifest(new TextEncoder().encode(JSON.stringify(withEntry)))).toThrow(/unknown key/)
    const withProject = base()
    ;(withProject.project as Record<string, unknown>).extra = true
    expect(() => parsePortableProjectV3Manifest(new TextEncoder().encode(JSON.stringify(withProject)))).toThrow(/unknown key/)
  })

  it('uses the canonical NFC and case-folded Windows collision key', () => {
    expect(portableArchivePathKey('Assets/Media/A.PNG')).toBe('assets/media/a.png')
    expect(() => validatePortableArchivePath('Assets/e\u0301.txt')).toThrow()
    expect(() => validatePortableArchivePath('CON.txt')).toThrow()
    expect(() => validatePortableArchivePath('name.')).toThrow()
  })

  it('accepts explicit media and sidecar namespaces but refuses unknown optional entries', () => {
    const value = base()
    value.entries.push(
      { path: 'assets/media/' + hash + '.png', sha256: hash, rawBytes: 1, compressedBytes: 1, required: false },
      { path: 'comments/board-log.jsonl', sha256: hash, rawBytes: 1, compressedBytes: 1, required: false },
      { path: 'assets/attachments/session-part.bin', sha256: hash, rawBytes: 1, compressedBytes: 1, required: false }
    )
    expect(parsePortableProjectV3Manifest(new TextEncoder().encode(JSON.stringify(value))).entries).toHaveLength(5)
    const unknown = base()
    unknown.entries.push({ path: 'mystery/thing', sha256: hash, rawBytes: 1, compressedBytes: 1, required: false })
    expect(() => parsePortableProjectV3Manifest(new TextEncoder().encode(JSON.stringify(unknown)))).toThrow(/Unknown optional/)
  })

  it('preserves structural node and edge ids while stripping project authority', () => {
    const migrated = migratePortableProject(1, {
      id: 'machine-project',
      name: 'Board',
      nodes: [{ id: 'node-1', kind: 'sticky' }],
      relationships: [{ id: 'edge-1', source: 'node-1', target: 'node-1' }],
      cwd: 'C:/private',
      token: 'secret'
    })
    expect(migrated.id).toBeUndefined()
    expect((migrated.nodes as Array<{ id: string }>)[0].id).toBe('node-1')
    expect((migrated.relationships as Array<{ id: string }>)[0].id).toBe('edge-1')
    expect(migrated.cwd).toBeUndefined()
    expect(migrated.token).toBeUndefined()
  })
})
