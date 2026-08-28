// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { useSettings } from '../state/settings'
import { useSchoolMode } from '../state/schoolMode'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { LanguageSection } from '../components/settings/sections/LanguageSection'
import { useI18n } from './i18n'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Behavioral suite for the "Show emojis in dialogs and message boxes" switch
 * (docs/language-modes.md §6). The contract: when ON, each dialog/message box carries a relevant
 * NON-SEMANTIC emoji; when OFF, the identical factual copy remains without it; and emoji never
 * appear in buttons, action labels, field labels, accessible names, or other control text —
 * the last clause is the one a refactor breaks silently, so it gets the sharpest assertions.
 *
 * `i18n.test.tsx` (sibling) owns the funny-level/School-mode boundary; this file owns the emoji
 * switch only.
 */

// Extended_Pictographic covers 🗑 (1F5D1), ℹ (2139) and ❓ (2753); FE0F is the variation selector
// that rides beside them, included so a refactor that strips the base char but leaves the
// selector behind still trips the scan.
const EMOJI_RE = /[\p{Extended_Pictographic}\u{FE0F}]/u

let host: HTMLElement
let root: Root

function setEmojiSetting(on: boolean): void {
  const current = useSettings.getState()
  const next = { ...current.settings, showEmojiInDialogs: on }
  useSettings.setState({ settings: next, base: next })
}

/** The text a screen reader would take from a node: everything except aria-hidden subtrees. */
function accessibleText(node: Element): string {
  const clone = node.cloneNode(true) as Element
  for (const hidden of Array.from(clone.querySelectorAll('[aria-hidden="true"]'))) hidden.remove()
  return (clone.textContent ?? '').trim()
}

beforeEach(() => {
  ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
    settings: { save: vi.fn(async () => undefined) }
  }
  const configured = { ...DEFAULT_SETTINGS }
  useSettings.setState({ settings: configured, base: configured, hydrated: true })
  // Hydrated + OFF: language features allowed, so the Language section renders its controls.
  useSchoolMode.setState({ enabled: false, hydrated: true, name: 'School mode' })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useSettings.setState({ settings: DEFAULT_SETTINGS, base: DEFAULT_SETTINGS, hydrated: false })
  useSchoolMode.setState({ enabled: false, hydrated: false, name: 'School mode' })
})

function EmojiProbe(): React.JSX.Element {
  const i18n = useI18n()
  return (
    <pre data-emoji-probe="">
      {JSON.stringify({ show: i18n.showEmojiInDialogs, char: i18n.emoji('\u{1F5D1}\u{FE0F}') })}
    </pre>
  )
}

function probe(): { show: boolean; char: string } {
  return JSON.parse(host.querySelector('[data-emoji-probe]')?.textContent ?? '{}') as {
    show: boolean
    char: string
  }
}

describe('the emoji() boundary in useI18n', () => {
  it('ships OFF by default and returns the empty string until the user opts in', () => {
    expect(DEFAULT_SETTINGS.showEmojiInDialogs).toBe(false)
    act(() => root.render(<EmojiProbe />))
    expect(probe()).toEqual({ show: false, char: '' })
  })

  it('returns the given emoji once the toggle is on — live, and reverts live', () => {
    act(() => root.render(<EmojiProbe />))
    act(() => setEmojiSetting(true))
    expect(probe()).toEqual({ show: true, char: '\u{1F5D1}\u{FE0F}' })
    act(() => setEmojiSetting(false))
    expect(probe()).toEqual({ show: false, char: '' })
  })
})

describe('dialogs carry the decoration when ON, and the identical factual copy when OFF', () => {
  const noop = (): void => {}

  it('decorates the message outside the accessible name, and OFF leaves the same words', () => {
    setEmojiSetting(true)
    act(() =>
      root.render(<ConfirmDialog message="Delete this file?" onConfirm={noop} onCancel={noop} />)
    )
    const msg = document.querySelector('.confirm__msg')
    expect(msg).not.toBeNull()
    // The decoration is present…
    expect(msg?.textContent ?? '').toContain('\u{1F5D1}\u{FE0F}')
    // …but it is not part of the message's accessible text.
    expect(accessibleText(msg as Element)).toBe('Delete this file?')

    // Flip OFF live: the SAME factual copy remains, with no emoji anywhere in the message.
    act(() => setEmojiSetting(false))
    const after = document.querySelector('.confirm__msg')
    expect((after?.textContent ?? '').trim()).toBe('Delete this file?')
    expect(EMOJI_RE.test(after?.textContent ?? '')).toBe(false)
  })

  it('the decoration is relevant to the dialog kind: alert ℹ️, danger 🗑️, plain question ❓', () => {
    setEmojiSetting(true)
    const msgText = (): string => document.querySelector('.confirm__msg')?.textContent ?? ''

    act(() => root.render(<ConfirmDialog message="Sure?" onConfirm={noop} onCancel={noop} />))
    expect(msgText()).toContain('\u{1F5D1}\u{FE0F}')

    act(() => root.render(<ConfirmDialog alert message="Heads up" onConfirm={noop} onCancel={noop} />))
    expect(msgText()).toContain('\u{2139}\u{FE0F}')

    act(() =>
      root.render(
        <ConfirmDialog danger={false} message="Proceed?" onConfirm={noop} onCancel={noop} />
      )
    )
    expect(msgText()).toContain('\u{2753}')
  })

  it('emoji NEVER enter buttons, the option label, or accessible names — even with the toggle ON', () => {
    setEmojiSetting(true)
    act(() =>
      root.render(
        <ConfirmDialog
          message="Delete this worktree?"
          option={{ label: 'Also delete the folder from disk', checked: false, onChange: noop }}
          onConfirm={noop}
          onCancel={noop}
        />
      )
    )
    const dialog = document.querySelector('.confirm')
    expect(dialog).not.toBeNull()

    const buttons = Array.from((dialog as Element).querySelectorAll('button'))
    // Guard against a vacuous scan: this dialog shape has exactly Cancel + Delete.
    expect(buttons.length).toBe(2)
    for (const button of buttons) {
      expect(EMOJI_RE.test(button.textContent ?? '')).toBe(false)
      expect(EMOJI_RE.test(button.getAttribute('aria-label') ?? '')).toBe(false)
    }
    const buttonLabels = buttons.map((b) => (b.textContent ?? '').trim())
    expect(buttonLabels).toHaveLength(2)
    expect(buttonLabels.every((label) => label.length > 0)).toBe(true)
    expect(buttonLabels.every((label) => !EMOJI_RE.test(label))).toBe(true)

    const option = (dialog as Element).querySelector('.confirm__option')
    expect(option).not.toBeNull()
    expect(option?.textContent ?? '').toContain('Also delete the folder from disk')
    expect(EMOJI_RE.test(option?.textContent ?? '')).toBe(false)

    // The decoration itself IS rendered (so the scans above are not passing on an emoji-free
    // dialog) and sits in an explicitly aria-hidden span.
    const decoration = (dialog as Element).querySelector('.confirm__msg span')
    expect(decoration).not.toBeNull()
    expect(decoration?.getAttribute('aria-hidden')).toBe('true')
    expect(EMOJI_RE.test(decoration?.textContent ?? '')).toBe(true)
  })
})

describe('the Settings → Language switch is the control', () => {
  const SWITCH_SELECTOR =
    'button[role="switch"][aria-label="Show emojis in dialogs and message boxes"]'

  it('renders as role="switch", reflects the stored state, and writes it on click', () => {
    act(() => root.render(<LanguageSection isActive />))
    const before = host.querySelector(SWITCH_SELECTOR)
    expect(before).not.toBeNull()
    expect(before?.getAttribute('aria-checked')).toBe('false')
    // Its own control text carries no emoji (the hard rule applies to the toggle too).
    expect(EMOJI_RE.test(before?.textContent ?? '')).toBe(false)

    act(() => (before as HTMLButtonElement).click())
    expect(useSettings.getState().settings.showEmojiInDialogs).toBe(true)
    expect(host.querySelector(SWITCH_SELECTOR)?.getAttribute('aria-checked')).toBe('true')

    act(() => (host.querySelector(SWITCH_SELECTOR) as HTMLButtonElement).click())
    expect(useSettings.getState().settings.showEmojiInDialogs).toBe(false)
    expect(host.querySelector(SWITCH_SELECTOR)?.getAttribute('aria-checked')).toBe('false')
  })
})

describe('every emoji() consumer is registered here', () => {
  // The behavioral tests above prove the shipped consumers keep emoji out of control text. A
  // behavioral test cannot see a consumer that was never tested at all, so this
  // hand-written inventory fails the suite when a NEW call site appears — the author must add its
  // own control-text coverage and then register it. (Matching includes comments on purpose: a
  // false trip on a commented example costs a minute; a silent new consumer costs the contract.)
  const EXPECTED_CONSUMERS = ['components/ConfirmDialog.tsx', 'components/NodeCatalogDialog.tsx', 'lib/i18n.ts'].sort()

  it('no unregistered emoji() call sites exist under src/renderer', () => {
    const rendererRoot = join(__dirname, '..')
    const hits: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'assets') continue
          walk(full)
          continue
        }
        if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) continue
        if (/\bemoji\(/.test(readFileSync(full, 'utf8'))) {
          hits.push(relative(rendererRoot, full).replace(/\\/g, '/'))
        }
      }
    }
    walk(rendererRoot)
    // Non-vacuous by construction: an empty hit list means the feature itself disappeared, and
    // that fails too.
    expect(hits.sort()).toEqual(EXPECTED_CONSUMERS)
  })
})
