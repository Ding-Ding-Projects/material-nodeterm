import { describe, expect, it } from 'vitest'
import { CATALOG } from './i18n/catalog'
import { t } from './i18n/resolve'

const IDS = [
  'torrent.title', 'torrent.rename', 'torrent.nodeName', 'torrent.runtime', 'torrent.magnet',
  'torrent.destination', 'torrent.browse', 'torrent.addMagnet', 'torrent.chooseFile',
  'torrent.runtimeChecking', 'torrent.runtimeUnavailable', 'torrent.runtimeMissing',
  'torrent.networkConsent', 'torrent.tasks', 'torrent.search', 'torrent.regex', 'torrent.noTasks',
  'torrent.exportDisclosure', 'torrent.exportError', 'torrent.bulkResult'
  , 'torrent.bulk.pause', 'torrent.bulk.resume', 'torrent.bulk.cancel', 'torrent.bulk.retry', 'torrent.bulk.remove', 'torrent.bulk.export', 'torrent.exportSummary', 'torrent.status.queued', 'torrent.status.metadata', 'torrent.status.downloading', 'torrent.status.paused', 'torrent.status.recoverable-paused', 'torrent.status.completed', 'torrent.status.seeding', 'torrent.status.stopped', 'torrent.status.cancelled', 'torrent.status.failed', 'torrent.files', 'torrent.peers', 'torrent.eta', 'torrent.seed.never', 'torrent.seed.ratio', 'torrent.seed.minutes', 'torrent.seed.indefinite'
] as const

const VARIANT_LENGTHS = [5, 10]

describe('torrent localization contract', () => {
  it('has matched English and Cantonese variant rows for every torrent product message', () => {
    for (const id of IDS) {
      const entry = CATALOG[id]
      expect(entry, id).toBeDefined()
      // A row is either a legacy five-variant entry or a ten-variant one (FiveVariants |
      // FunnyVariants). Both are the shipped contract; what must never differ is the two
      // languages' lengths, which is how a half-migrated row renders blank at a high level.
      expect(VARIANT_LENGTHS, id).toContain(entry.en.length)
      expect(entry.yue, id).toHaveLength(entry.en.length)
    }
  })

  it('resolves English, Cantonese and bilingual modes while preserving factual placeholders', () => {
    for (const mode of ['en', 'yue', 'bilingual'] as const) {
      const resolved = t('torrent.bulkResult', '{action}: {succeeded} succeeded, {failed} skipped or failed.', mode, { en: 1, yue: 5 })
      expect(resolved.primary).toContain('{action}')
      if (mode === 'bilingual') expect(resolved.secondary).toBeTruthy()
    }
  })
})
