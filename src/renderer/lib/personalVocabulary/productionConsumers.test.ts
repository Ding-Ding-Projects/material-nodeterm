import { describe, expect, it } from 'vitest'
import { applyVocabulary } from './apply'
import { mapOwnedSentence } from './ownedCopy'
import { bulkPreviewMessageSegments } from '../../components/BulkActionPreview'
import { appearanceImportSummarySegments } from '../../components/appearance/AppearanceEditor'
import { detectionSummarySegments } from '../../components/converter/FileConverterPanel'
import { adapterSearchCorpus } from '../../components/converter/AdapterCatalog'
import { ollamaPageSummarySegments, catalogStalenessSegments } from '../../components/ollama/OllamaManagerPanel'
import { unreadCountSegments, projectStorageMessageSegments } from '../../components/ProjectSwitcher'
import { docsArticleCountSegments } from '../../components/DocsBrowser'
import { historyRestoreMessageSegments } from '../../components/LocalHistoryPanel'
import { changelogExportOutcomeSegments } from '../../components/changelog/ChangelogPanel'

const map = (text: string): string => applyVocabulary(text, {
  Showing: 'Displaying',
  Imported: 'Loaded',
  Detection: 'Sniff',
  Split: 'Divide',
  Restore: 'Rewind',
  exported: 'sent',
  article: 'paper',
  unread: 'unseen'
})

describe('production vocabulary consumers', () => {
  it('keeps BulkActionBar and BulkActionPreview labels single-mapped with exact counts', () => {
    expect(mapOwnedSentence(map, bulkPreviewMessageSegments('Export selected', 3, 5))).toBe(
      'Export selected: 3 of 5 selected will change.'
    )
  })

  it('keeps AppearanceEditor import counts exact while mapping copy', () => {
    expect(mapOwnedSentence(map, appearanceImportSummarySegments(4, 2, 1))).toBe(
      'Loaded 4. Skipped 2 invalid, 1 duplicate name(s).'
    )
  })

  it('keeps converter diagnostics and confidence facts exact', () => {
    expect(mapOwnedSentence(map, detectionSummarySegments('error at offset 256', 'high'))).toBe(
      'Sniff: error at offset 256 (confidence: high)'
    )
  })

  it('keeps adapter ids and technical labels in the search corpus', () => {
    expect(adapterSearchCorpus({ id: 'png-to-webp', label: 'PNG → WebP', unavailableReason: 'missing adapter' } as never)).toBe(
      'png-to-webp PNG → WebP missing adapter'
    )
  })

  it('keeps Ollama pagination and staleness numbers exact', () => {
    expect(mapOwnedSentence(map, ollamaPageSummarySegments({ from: 1, to: 2, total: 50, page: 1, pageCount: 25 } as never))).toBe(
      'Displaying 1–2 of 50 matching references (page 1 of 25).'
    )
    expect(mapOwnedSentence(map, catalogStalenessSegments({ staleness: 'fresh', indexFetchedAt: 0 } as never, 60_000))).toContain('Catalog fetched')
  })

  it('keeps ProjectSwitcher counts and restore storage facts exact', () => {
    expect(mapOwnedSentence(map, unreadCountSegments(7, ' unread in other projects'))).toBe('7 unseen in other projects')
    expect(mapOwnedSentence(map, projectStorageMessageSegments('split', 'Work project', 3, 'MB'))).toBe(
      'Divide "Work project" into 3 MB parts?'
    )
  })

  it('keeps DocsBrowser article counts exact while mapping surrounding copy', () => {
    expect(mapOwnedSentence(map, docsArticleCountSegments(12, 'articles match'))).toBe('12 papers match')
  })

  it('keeps LocalHistory restore labels and revisions exact', () => {
    expect(mapOwnedSentence(map, historyRestoreMessageSegments('Download/model', 'abcdef0123456789'))).toContain(
      'Rewind to "Download/model" (abcdef0)'
    )
  })

  it('keeps Changelog outcome counts exact while mapping outcome copy', () => {
    expect(mapOwnedSentence(map, changelogExportOutcomeSegments('exported', 9))).toBe('9 sent')
  })
})
