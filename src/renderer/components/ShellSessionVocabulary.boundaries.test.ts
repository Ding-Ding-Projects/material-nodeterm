import { describe, expect, it } from 'vitest'
import { mapTemplate } from './UpdateCard'
import { phonePairCodeLabel } from './PhonePairPopover'
import { renderStatusSummary, statusSearchCorpus } from './StatusSurface'
import { vocabularyProvenanceLine } from './WelcomeScreen'
import { ptyPressureCopy } from './PtyPressureBanner'

const mapAuthored = (text: string): string =>
  text.replace('Update', 'Refresh').replace('built', 'assembled').replace('terminal', 'shell box')

describe('shell and session vocabulary boundaries', () => {
  it('maps update templates without changing version or percentage facts', () => {
    expect(
      mapTemplate('Update v{version} is downloading at {percent}%.', { version: '0.4.119', percent: '42' }, mapAuthored)
    ).toBe('Refresh v0.4.119 is downloading at 42%.')
  })

  it('maps only the TOTP accessibility prefix and preserves the live code', () => {
    expect(phonePairCodeLabel('123456', (text) => text.replace('TOTP', 'access'))).toBe('Current access code 123456')
  })

  it('renders typed status summary parts and searches the visible mapped corpus', () => {
    const card = {
      id: 'capture',
      title: 'Built terminal captures',
      state: 'verified' as const,
      summary: 'Built terminal captures from commit abc12345.',
      summaryParts: [
        { kind: 'authored' as const, text: 'Built terminal captures from commit ' },
        { kind: 'factual' as const, text: 'abc12345' }
      ],
      recordedAt: null,
      evidence: [{ label: 'Capture commit', value: 'abc12345' }],
      rows: []
    }
    const mapper = mapAuthored
    expect(renderStatusSummary(card, mapper)).toBe('Assembled shell box captures from commit abc12345')
    const corpus = statusSearchCorpus(card, { label: 'Verified' }, mapper)
    expect(corpus).toContain('Assembled shell box captures')
    expect(corpus).toContain('abc12345')
  })

  it('maps authored provenance words while retaining the stamped version and date facts', () => {
    const line = vocabularyProvenanceLine('0.4.119', undefined, (text) => text.replace('build time', 'stamp'))
    expect(line).toContain('v0.4.119')
    expect(line).toContain('stamp')
    expect(line).toContain('this build carries no build stamp')
  })

  it('keeps measured PTY counts factual while exposing typed authored body parts', () => {
    const copy = ptyPressureCopy({ level: 'critical', usage: 509, ceiling: 511 })
    expect(copy?.bodyParts.find((part) => part.kind === 'factual')?.text).toBe('(509 of 511 pty devices)')
    expect(copy?.body).toContain('(509 of 511 pty devices)')
  })
})
