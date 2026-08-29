import { describe, expect, it } from 'vitest'
import { CATALOG } from '@shared/i18n/catalog'
import { formatText, t } from '@shared/i18n'
import type { FunnyLevel, LanguageMode } from '@shared/i18n'
import {
  annotatesStatusDuringUpdateError,
  clearsAfterUpToDateTimeout,
  progressPercent,
  preservesStatusDuringManualCheck,
  statusFromAvailable,
  statusFromDownloaded,
  updateCardControls,
  updateBodyCopy,
  type UpdateBodyKind
} from './update-card-state'

describe('update card transfer truth', () => {
  it('renders Squirrel transfers as indeterminate instead of inventing 0%', () => {
    expect(statusFromAvailable({ indeterminateProgress: true })).toEqual({
      kind: 'available',
      version: undefined,
      percent: null
    })
  })

  it('never converts an indeterminate transfer into byte progress', () => {
    expect(progressPercent(null, 68.5)).toBeNull()
    expect(progressPercent(0, 68.5)).toBe(68.5)
  })

  it('keeps a staged update reachable when Settings checks again', () => {
    expect(updateCardControls('downloaded')).toEqual({
      canMinimize: true,
      canDismiss: false
    })
    expect(preservesStatusDuringManualCheck('downloaded')).toBe(true)
    expect(preservesStatusDuringManualCheck('idle')).toBe(false)
  })

  it('keeps mandatory update truth non-dismissible across an offline update error', () => {
    expect(annotatesStatusDuringUpdateError('required')).toBe(true)
    expect(annotatesStatusDuringUpdateError('checking')).toBe(false)
    expect(updateCardControls('required').canDismiss).toBe(false)
    expect(updateCardControls('error').canDismiss).toBe(true)
  })

  it('keeps Restart reachable while annotating a retryable install failure', () => {
    expect(annotatesStatusDuringUpdateError('downloaded')).toBe(true)
    expect(updateCardControls('downloaded')).toEqual({ canMinimize: true, canDismiss: false })
  })

  it('never lets a stale up-to-date timer erase a newer update result', () => {
    expect(clearsAfterUpToDateTimeout('upToDate')).toBe(true)
    for (const kind of ['available', 'manual', 'downloaded', 'error', 'required'] as const) {
      expect(clearsAfterUpToDateTimeout(kind)).toBe(false)
    }
  })

  it('preserves known versions on automatic, manual, and downloaded paths', () => {
    expect(statusFromAvailable({ version: '1.2.3' })).toEqual({
      kind: 'available',
      version: '1.2.3',
      percent: 0
    })
    expect(statusFromAvailable({ version: '1.2.3', manual: true })).toEqual({
      kind: 'manual',
      version: '1.2.3'
    })
    expect(statusFromDownloaded({ version: '1.2.3' })).toEqual({
      kind: 'downloaded',
      version: '1.2.3'
    })
  })

  it('makes no proximity claim at any funny level when byte progress is indeterminate', () => {
    const unmeasuredProximityClaim =
      /\b(?:almost|nearly|soon|close to|any moment|final stretch)\b|就嚟|就快|差唔多|快完成|最後直路/i
    let inspectedVariants = 0

    for (const version of [undefined, '1.2.3']) {
      const status = statusFromAvailable({ version, indeterminateProgress: true })
      expect(status.kind).toBe('available')
      if (status.kind !== 'available') throw new Error('Expected an automatic update status')
      expect(status.percent).toBeNull()

      const copy = updateBodyCopy(status.kind, status.version)
      const entry = CATALOG[copy.id]
      for (const language of ['en', 'yue'] as const) {
        for (const variant of entry[language]) {
          const rendered = formatText(variant, copy.params ?? {})
          expect(rendered).not.toMatch(unmeasuredProximityClaim)
          inspectedVariants += 1
        }
      }
    }

    expect(inspectedVariants).toBe(20)
  })
})

describe('update card version copy', () => {
  const kinds: UpdateBodyKind[] = ['available', 'manual', 'downloaded']
  const modes: LanguageMode[] = ['en', 'yue', 'bilingual']
  const levels: FunnyLevel[] = [1, 2, 3, 4, 5]

  it('formats the real version on every known-version path', () => {
    for (const kind of kinds) {
      const copy = updateBodyCopy(kind, ' 1.2.3 ')
      expect(copy.params).toEqual({ version: '1.2.3' })
      expect(formatText(copy.fallback, copy.params!)).toContain('1.2.3')
      expect(copy.id).not.toMatch(/Unknown$/)
    }
  })

  it('uses factual generic copy for absent or blank versions', () => {
    for (const kind of kinds) {
      for (const version of [undefined, '', '   ']) {
        const copy = updateBodyCopy(kind, version)
        expect(copy.id).toMatch(/Unknown$/)
        expect(copy.params).toBeUndefined()
        expect(copy.fallback).not.toMatch(/undefined|\{version\}/)
      }
    }
  })

  it('covers all language modes and five funny levels without losing update facts', () => {
    for (const kind of kinds) {
      const copy = updateBodyCopy(kind)
      const entry = CATALOG[copy.id]
      expect(entry.en).toHaveLength(5)
      expect(entry.yue).toHaveLength(5)

      for (const mode of modes) {
        for (const level of levels) {
          const resolved = t(copy.id, copy.fallback, mode, {
            en: level,
            yue: level
          })
          const rendered = [resolved.primary, resolved.secondary].filter(Boolean).join(' ')
          expect(rendered).toMatch(/nodeterm/i)
          expect(rendered).not.toMatch(/undefined|\{version\}/)
        }
      }
    }
  })
})
