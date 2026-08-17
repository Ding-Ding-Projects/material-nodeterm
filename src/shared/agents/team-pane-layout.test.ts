import { describe, it, expect } from 'vitest'
import {
  decideLeadPaneCorrection,
  resizeLeadPaneArgs,
  LEAD_PANE_INDEX
} from './team-pane-layout'

const cfg = { enabled: true, percent: 60 }

describe('decideLeadPaneCorrection', () => {
  it('disabled → never acts, whatever the pane count', () => {
    expect(decideLeadPaneCorrection(1, { ...cfg, enabled: false })).toEqual({ act: false })
    expect(decideLeadPaneCorrection(5, { ...cfg, enabled: false })).toEqual({ act: false })
  })

  it('a single pane (no team) → never acts, even when enabled', () => {
    expect(decideLeadPaneCorrection(1, cfg)).toEqual({ act: false })
  })

  it('zero or negative pane counts (unknown/error reads) → never acts', () => {
    expect(decideLeadPaneCorrection(0, cfg)).toEqual({ act: false })
    expect(decideLeadPaneCorrection(-1, cfg)).toEqual({ act: false })
  })

  it('a non-integer pane count → never acts (never guess)', () => {
    expect(decideLeadPaneCorrection(1.5, cfg)).toEqual({ act: false })
    expect(decideLeadPaneCorrection(NaN, cfg)).toEqual({ act: false })
  })

  it('two or more panes (a team exists) + enabled → acts, with the rounded percent argument', () => {
    expect(decideLeadPaneCorrection(2, cfg)).toEqual({ act: true, widthArg: '60%' })
    expect(decideLeadPaneCorrection(7, cfg)).toEqual({ act: true, widthArg: '60%' })
  })

  it('rounds a fractional configured percent', () => {
    expect(decideLeadPaneCorrection(2, { enabled: true, percent: 59.6 })).toEqual({
      act: true,
      widthArg: '60%'
    })
  })

  it('an unreadable percent (hand-edited settings.json) reads as off, not a guess', () => {
    for (const percent of [0, -10, 100, 150, NaN, null as unknown as number, undefined as unknown as number]) {
      expect(decideLeadPaneCorrection(2, { enabled: true, percent }), String(percent)).toEqual({
        act: false
      })
    }
  })

  it('is a pure function of its inputs — re-asking with the same inputs answers the same way', () => {
    // This is the whole re-application mechanism: Claude Code re-narrows the lead pane on every
    // later teammate spawn, so the caller re-decides on every observation rather than remembering
    // "already corrected". Calling this twice in a row with an unchanged pane count must not
    // suppress the second answer.
    const first = decideLeadPaneCorrection(3, cfg)
    const second = decideLeadPaneCorrection(3, cfg)
    expect(first).toEqual(second)
    expect(second).toEqual({ act: true, widthArg: '60%' })
  })
})

describe('resizeLeadPaneArgs', () => {
  it('targets pane index 0 on the given socket + session, with the caller-supplied width', () => {
    expect(resizeLeadPaneArgs('node-terminal', 'nt-abc123', '60%')).toEqual([
      '-L',
      'node-terminal',
      'resize-pane',
      '-t',
      'nt-abc123.0',
      '-x',
      '60%'
    ])
    expect(LEAD_PANE_INDEX).toBe(0)
  })

  it('carries whatever width string it is given, unmodified', () => {
    const args = resizeLeadPaneArgs('sock', 'nt-x', '35%')
    expect(args[args.length - 1]).toBe('35%')
  })
})
