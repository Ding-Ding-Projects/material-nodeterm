// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { UnlockLadderPanel, type LadderTransport } from './UnlockLadder'
import { usePersonalVocabulary } from '../../state/personalVocabulary'
import { useSchoolMode } from '../../state/schoolMode'

let host: HTMLDivElement
let root: Root

function render(transport: LadderTransport): void {
  act(() => root.render(<UnlockLadderPanel transport={transport} onCleared={() => {}} onDone={() => {}} />))
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
  useSchoolMode.setState({ enabled: false, hydrated: true, name: 'School mode' })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
  useSchoolMode.setState({ enabled: false, hydrated: true, name: 'School mode' })
})

describe('unlock ladder personal vocabulary boundary', () => {
  it('maps ladder copy while preserving equations, counters, and challenge payloads', async () => {
    usePersonalVocabulary.setState({
      entries: {
        'Ten easy sums. Every one has to be right.': 'Do ten sums.',
        'Check my sums': 'Check arithmetic',
        ' equals': ' is',
        'Winning ends the wait — nothing more. You still need the password. ': 'Wait cleared, password still needed. '
      },
      status: 'loaded',
      entryCount: 4
    })
    const transport: LadderTransport = {
      issue: vi.fn().mockResolvedValue({
        challenge: { kind: 'math', nonce: 'nonce-7', questions: ['7 + 5'], triesLeft: 3 },
        budgetLeft: 2
      }),
      verify: vi.fn()
    }

    render(transport)
    await settle()

    expect(document.querySelector('.toylock-ladder__prompt')?.textContent).toBe('Do ten sums.')
    expect(document.querySelector('.toylock-ladder__sum span')?.textContent).toBe('7 + 5 =')
    expect(document.querySelector('.toylock-ladder__sum input')?.getAttribute('aria-label')).toBe('7 + 5 is')
    expect(document.querySelector('.toylock-btn--primary')?.textContent?.trim()).toBe('Check arithmetic')
    expect(document.querySelector('.toylock-ladder__foot')?.textContent).toContain('2 skips left this hour.')
  })

  it('restores shipped ladder identity in School mode and never renders the dim-sum rung', async () => {
    usePersonalVocabulary.setState({
      entries: {
        'Ten easy sums. Every one has to be right.': 'Do ten sums.',
        'Which dish is ': 'Name the dish: '
      },
      status: 'loaded',
      entryCount: 2
    })
    useSchoolMode.setState({ enabled: true, hydrated: true, name: 'School mode' })
    const transport: LadderTransport = {
      issue: vi.fn().mockResolvedValue({
        challenge: { kind: 'dimsum', nonce: 'nonce-dish', prompt: '蝦餃', choices: ['蝦餃', '燒賣'], triesLeft: 5 },
        budgetLeft: 3
      }),
      verify: vi.fn()
    }

    render(transport)
    await settle()

    expect(document.querySelector('.toylock-ladder__prompt')).toBeNull()
    expect(document.body.textContent).not.toContain('蝦餃')
    expect(document.body.textContent).not.toContain('燒賣')
    expect(document.body.textContent).toContain('This challenge is unavailable in this mode.')
  })
})
