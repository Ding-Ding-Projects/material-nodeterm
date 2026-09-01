// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatResetCountdown, formatTimeAgo, percentText } from './usageFormat'
import { setHostVocabularySchoolState } from './personalVocabulary/hostMessage'
import { useSchoolMode } from '../state/schoolMode'

const CACHE_KEY = 'nodeterm.personalVocabulary.v1'

function saveVocabulary(entries: Record<string, string>): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify({
    version: 1,
    entries,
    entryCount: Object.keys(entries).length,
    savedAt: Date.now()
  }))
}

describe('usage-format vocabulary boundaries', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'))
    localStorage.clear()
    useSchoolMode.setState({ enabled: false, hydrated: true })
    setHostVocabularySchoolState({ enabled: false, hydrated: true })
  })

  it('maps age wording while preserving its numeric value', () => {
    saveVocabulary({ 'm ago': ' minutes ago', 'h ago': ' hours ago', 'just now': 'right now' })

    expect(formatTimeAgo(Date.now() - 5 * 60_000)).toBe('5 minutes ago')
    expect(formatTimeAgo(Date.now() - 2 * 60 * 60_000)).toBe('2 hours ago')
    expect(formatTimeAgo(Date.now() - 10_000)).toBe('right now')
  })

  it('maps reset and percentage suffixes without rewriting numbers or percent signs', () => {
    saveVocabulary({
      'Resets in ': 'Tea break in ',
      'Resets now': 'Tea break now',
      '% left': '% remaining',
      '% used': '% consumed'
    })

    expect(formatResetCountdown(Date.now() + 65 * 60_000)).toBe('Tea break in 1h 5m')
    expect(formatResetCountdown(Date.now())).toBe('Tea break now')
    expect(percentText(42, 'remaining')).toBe('58% remaining')
    expect(percentText(42, 'used')).toBe('42% consumed')
  })

  it('restores the shipped wording immediately while School mode is enabled', () => {
    saveVocabulary({ 'Resets now': 'Tea break now', '% used': '% consumed' })

    expect(formatResetCountdown(Date.now())).toBe('Tea break now')
    expect(percentText(42, 'used')).toBe('42% consumed')

    useSchoolMode.setState({ enabled: true, hydrated: true })
    expect(formatResetCountdown(Date.now())).toBe('Resets now')
    expect(percentText(42, 'used')).toBe('42% used')
  })
})
