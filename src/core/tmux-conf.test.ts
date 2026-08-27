import { DEFAULT_WORD_SEPARATORS } from '@shared/word-separators'
import { describe, it, expect } from 'vitest'

import { ACCOUNT_SCOPE_UPDATE_ENV, tmuxConf } from './pty-manager'
import { leadPaneHookLines } from '../shared/tmux-lead-pane'

describe('tmuxConf', () => {
  const c = tmuxConf(50000, DEFAULT_WORD_SEPARATORS)

  it('leaves the mouse ON — tmux owns scrolling and selection', () => {
    // The wheel scrolls tmux's own history and the pane stays on the alternate screen (so a TUI's
    // input box stays put). The previous design (mouse off, emulator-owned scrollback) leaked
    // tmux's repaints into the scrollback as black bands and duplicated screens.
    expect(c).toContain('set -g mouse on')
    expect(c).not.toContain('set -g mouse off')
  })

  it('does not blank smcup/rmcup/indn — the alternate screen is the native, wanted behavior', () => {
    expect(c).not.toContain('smcup@')
    expect(c).not.toContain('rmcup@')
    expect(c).not.toContain('indn@')
  })

  it('enables OSC 52 via terminal-features, NOT the Ms= override (a no-op on tmux 3.2+)', () => {
    // Measured on tmux 3.4: with `terminal-overrides ,xterm*:Ms=...` a copy emitted ZERO OSC 52 to
    // the attached client; with the `clipboard` terminal-feature it emitted the correct payload.
    expect(c).toContain('set -g set-clipboard on')
    expect(c).toContain('set -as terminal-features ",*:clipboard"')
    expect(c).not.toContain('Ms=')
  })

  it('declares RGB via terminal-features so truecolor is not clamped to 256 colors (issue #78)', () => {
    // Without an RGB terminal-features (or Tc) entry for the outer terminal, tmux quantizes every
    // 24-bit SGR to the 256-color palette — canvas terminals never match the user's real terminal.
    expect(c).toContain('set -as terminal-features ",*:RGB"')
    // Only via terminal-features: the overrides array must stay unset (see the MIGRATION note).
    expect(c).not.toMatch(/set -a[gs]? terminal-overrides/)
  })

  it('declares hyperlinks via terminal-features so OSC 8 links reach the renderer', () => {
    // tmux strips the OSC 8 escape unless the outer terminal declares support, leaving only the
    // label text — a link whose URL is not also printed can then never be opened.
    expect(c).toContain('set -as terminal-features ",*:hyperlinks"')
  })

  it('copies mouse selections through tmux (OSC 52), with no macOS-only pbcopy pipe', () => {
    expect(c).toContain('bind -T copy-mode    MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel')
    expect(c).toContain('bind -T copy-mode-vi MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel')
    expect(c).toContain('DoubleClick1Pane send-keys -X select-word')
    expect(c).toContain('TripleClick1Pane send-keys -X select-line')
    // pbcopy is macOS-only — half of why copying never worked elsewhere or over SSH.
    expect(c).not.toContain('pbcopy')
  })

  it('floors history-limit at 1000', () => {
    expect(tmuxConf(10, DEFAULT_WORD_SEPARATORS)).toContain('set -g history-limit 1000')
    expect(c).toContain('set -g history-limit 50000')
  })

  it('lead-pane width OFF (default/0/invalid) is byte-identical and carries no set-hook (issue #119)', () => {
    // The opt-in guarantee enes set for the feature: with the setting off, the generated conf is
    // bit-for-bit the pre-feature output — nodeterm ships no tmux hooks unless asked to.
    expect(tmuxConf(50000, 0)).toBe(c)
    expect(tmuxConf(50000, NaN)).toBe(c)
    expect(tmuxConf(50000, -3)).toBe(c)
    expect(c).not.toContain('set-hook')
  })

  it('lead-pane width ON only APPENDS the shared guarded hook pair — nothing above changes', () => {
    const on = tmuxConf(50000, 72)
    expect(on.startsWith(c)).toBe(true)
    expect(on).toContain(leadPaneHookLines(72))
    // Same builder as remoteTmuxConf, so the local and SSH sockets cannot drift.
    expect(on).toContain('set-hook -g after-resize-pane')
    expect(on).toContain('set-hook -g after-split-window')
  })

  it('lists every account-scope env name in update-environment (issue #419)', () => {
    // The REMOVAL half of update-environment's contract is the fix: the shared server's global
    // env is inherited from whichever client STARTED it, so without these names a server seeded
    // by a managed-account client leaked that account's CLAUDE_CONFIG_DIR into every session
    // created without a `-e` override — system-account nodes silently ran as a managed account.
    const line = c.split('\n').find((l) => l.startsWith('set -g update-environment '))
    expect(line).toBeDefined()
    for (const name of ACCOUNT_SCOPE_UPDATE_ENV) expect(line).toContain(name)
    // Deduped: the overlap names (ANTHROPIC_AUTH_TOKEN is in the gateway list AND the claude
    // auth strip; OPENAI_API_KEY likewise) must appear exactly once.
    for (const dup of ['ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY']) {
      expect(line!.split(dup).length - 1).toBe(1)
    }
  })
})

describe('word separators reach the local conf (issue #349)', () => {
  // tmux owns the mouse in this app, so a double-click is tmux's `select-word`, governed by tmux's
  // own `word-separators` — whose DEFAULT is " -_@", i.e. it breaks on hyphen, underscore AND
  // at-sign. That default IS the reported bug. Setting only xterm's `wordSeparator` would have
  // been a no-op for the common case, so these assert the line actually lands in the conf.

  /**
   * The VALUE, not the whole line.
   *
   * The line itself contains hyphens — in `-g` and in `word-separators` — so asserting "no hyphen"
   * against it fails on perfectly correct output. That is exactly how this test first went red,
   * and it is worth the extra helper: an assertion that fails on correct code gets "fixed" by
   * weakening it, which is how a test quietly stops testing.
   */
  const separatorValue = (conf: string): string => {
    const line = conf.split('\n').find((l) => l.startsWith('set -g word-separators ')) ?? ''
    const m = /^set -g word-separators "(.*)"$/.exec(line)
    return m ? m[1] : ''
  }

  it('emits a word-separators line', () => {
    expect(separatorValue(tmuxConf(50000, DEFAULT_WORD_SEPARATORS)).length).toBeGreaterThan(0)
  })

  it('keeps hyphen, underscore and at-sign inside a word — the whole point of the issue', () => {
    const value = separatorValue(tmuxConf(50000, DEFAULT_WORD_SEPARATORS))
    expect(value.length).toBeGreaterThan(0)
    for (const ch of ['-', '_', '@', '.', '/', '~', '+', ':']) {
      expect(value).not.toContain(ch)
    }
  })

  it('passes a custom set through', () => {
    expect(separatorValue(tmuxConf(50000, ' ,;'))).toBe(' ,;')
  })

  // Re-validated where it is interpolated, not merely where it is typed: a newline here would
  // append an attacker-chosen tmux command to a config file — for an SSH project, one written
  // onto somebody else's host.
  it('refuses a forged value at the interpolation site rather than trusting its type', () => {
    const forged = ' "' + String.fromCharCode(10) + 'set -g default-command "evil'
    const conf = tmuxConf(50000, forged)
    expect(conf).not.toContain('default-command')
    expect(separatorValue(conf)).toBe(separatorValue(tmuxConf(50000, DEFAULT_WORD_SEPARATORS)))
  })
})
