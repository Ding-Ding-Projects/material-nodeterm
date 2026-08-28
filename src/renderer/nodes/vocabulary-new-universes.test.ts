import { describe, expect, it } from 'vitest'
import type { RepositoryGraphSnapshot } from '@shared/repository-graph'
import { mapUniGetUiCount, mapUniGetUiDestructiveLabel, mapUniGetUiPageLabel, mapUniGetUiVersion } from '../components/unigetui/UniGetUiUniversePanel'
import { mapRepositoryGraphProgress, mapRepositoryGraphSummary } from './RepositoryGraphNode'
import { mapVeraCryptFavoriteLabel, mapVeraCryptMessage, mapVeraCryptOperationText } from './VeraCryptNode'

const replaceAuthored = (text: string): string => text.replaceAll('VeraCrypt', 'Vault').replaceAll('graph', 'map').replaceAll('entries', 'rows').replaceAll('operation', 'job').replaceAll('source', 'origin').replaceAll('shortcut', 'keybind').replaceAll('Version', 'Edition').replaceAll('Overview', 'Summary')

describe('new universe personal-vocabulary boundaries', () => {
  it('maps VeraCrypt authored fallback text while preserving host reasons and operation facts', () => {
    expect(mapVeraCryptMessage({ kind: 'copy', text: 'The VeraCrypt manager could not refresh its host state.' }, 'unused', replaceAuthored)).toBe('The Vault manager could not refresh its host state.')
    expect(mapVeraCryptMessage({ kind: 'fact', text: 'VeraCrypt executable missing at C:\\Tools\\VeraCrypt.exe' }, 'unused', replaceAuthored)).toBe('VeraCrypt executable missing at C:\\Tools\\VeraCrypt.exe')
    expect(mapVeraCryptMessage(null, 'Checking VeraCrypt availability…', replaceAuthored)).toBe('Checking Vault availability…')
    expect(mapVeraCryptFavoriteLabel('C:\\Vaults\\personal.hc', 'V', replaceAuthored)).toBe('personal.hc · V:')
    expect(mapVeraCryptOperationText('Mounted C:\\Vaults\\personal.hc', 'V', replaceAuthored)).toBe('Mounted C:\\Vaults\\personal.hc · V:')
  })

  it('keeps graph counts, revisions, progress, diagnostics, and identifiers exact', () => {
    const snapshot: RepositoryGraphSnapshot = {
      version: 1,
      projectId: 'project-42',
      mode: 'combined',
      status: 'ready',
      rootLabel: 'workspace',
      fingerprint: { revision: 'rev-7', files: 9, bytes: 100, contentHash: 'hash', generatedAt: 1 },
      nodes: Array.from({ length: 12 }, (_, index) => ({ id: `node-${index}`, kind: 'module' as const, label: `label-${index}` })),
      edges: Array.from({ length: 4 }, (_, index) => ({ id: `edge-${index}`, from: 'a', to: 'b', kind: 'imports' as const, confidence: 'high' as const, adapterId: 'a', adapterVersion: '1', sourceRevision: 'rev-7' })),
      adapters: [],
      omissions: ['Unsupported parser: custom-format'],
      createdAt: 1
    }
    expect(mapRepositoryGraphSummary(snapshot, replaceAuthored)).toBe('12 nodes, 4 edges, revision rev-7')
    expect(mapRepositoryGraphProgress(3, 12, replaceAuthored)).toBe('3 of 12 map items')
    expect(mapRepositoryGraphSummary({ ...snapshot, status: 'idle' }, replaceAuthored)).toBe('No verified snapshot. Refresh to index this project.')
  })

  it('maps page labels and authored count/version copy while preserving values', () => {
    expect(mapUniGetUiPageLabel('overview', replaceAuthored)).toBe('Summary')
    expect(mapUniGetUiCount(7, replaceAuthored)).toBe('7 rows shown')
    expect(mapUniGetUiVersion('4.2.1', replaceAuthored)).toBe('Edition 4.2.1')
    expect(mapUniGetUiCount(7, (text) => text)).toBe('7 entries shown')
  })

  it.each([
    ['uninstall', 'pkg-VeraCrypt', 'Uninstall pkg-VeraCrypt?'],
    ['forget', 'operation-42', 'Forget job operation-42?'],
    ['remove-source', 'source-VeraCrypt', 'Remove origin source-VeraCrypt?'],
    ['delete-shortcut', 'shortcut-42', 'Delete keybind shortcut-42?'],
    ['remove-bundle', 'pkg-VeraCrypt', 'Remove pkg-VeraCrypt from bundle?']
  ] as const)('maps the %s confirmation while preserving its value', (kind, value, expected) => {
    expect(mapUniGetUiDestructiveLabel(kind, value, replaceAuthored)).toBe(expected)
  })
})
