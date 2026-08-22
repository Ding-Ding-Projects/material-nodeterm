import { describe, expect, it } from 'vitest'
import { canEscapeToWidget } from './widget-escape'

const local = { browserRuntime: false, remoteSession: false, sessionSource: 'local' as const }

describe('canEscapeToWidget', () => {
  it('allows a plain local desktop terminal', () => {
    expect(canEscapeToWidget(local)).toBe(true)
  })

  it('refuses a Server Edition browser tab — there is no OS window to open', () => {
    expect(canEscapeToWidget({ ...local, browserRuntime: true })).toBe(false)
  })

  it('refuses an SSH session — the widget only ever reaches the LOCAL core', () => {
    expect(canEscapeToWidget({ ...local, remoteSession: true })).toBe(false)
  })

  // The two remote terms are independent; a relay tab is NOT an SSH session and would sail
  // straight past `remoteSession` alone.
  for (const source of ['relay', 'server'] as const) {
    it(`refuses a ${source} tab, whose core is another machine`, () => {
      expect(canEscapeToWidget({ ...local, sessionSource: source })).toBe(false)
    })
  }
})
