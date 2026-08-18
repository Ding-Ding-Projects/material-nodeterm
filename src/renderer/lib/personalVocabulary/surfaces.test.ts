import { describe, expect, it } from 'vitest'
import type { MenuItem } from '../../components/ContextMenu'
import type { Command } from '../../components/CommandPalette'
import { applyVocabularyToCommands, applyVocabularyToMenuItems, type VocabularyMap } from './surfaces'
import { applyVocabulary } from './apply'

/** The real matcher, wired the way the hooks wire it — never a stand-in that could pass on a
 *  transform the shipped one would not perform. */
const entries = { terminal: 'shell box', Delete: 'Yeet', Push: 'Yeet up', hint: 'clue' }
const map: VocabularyMap = <T extends string | undefined | null>(text: T): T =>
  typeof text === 'string' ? (applyVocabulary(text, entries) as T) : text
const identity: VocabularyMap = <T extends string | undefined | null>(text: T): T => text

describe('applyVocabularyToMenuItems', () => {
  it('translates row labels, submenu labels, section headings and disabled hints', () => {
    const items: MenuItem[] = [
      { type: 'label', label: 'terminal actions' },
      { label: 'Delete', onClick: () => {}, danger: true },
      { label: 'Open', onClick: () => {}, disabled: true, hint: 'a hint here' },
      {
        type: 'submenu',
        label: 'New terminal',
        children: [{ label: 'Delete this', onClick: () => {} }]
      }
    ]
    const out = applyVocabularyToMenuItems(items, map)
    expect(out[0]).toMatchObject({ type: 'label', label: 'shell box actions' })
    expect(out[1]).toMatchObject({ label: 'Yeet', danger: true })
    expect(out[2]).toMatchObject({ label: 'Open', hint: 'a clue here' })
    const submenu = out[3] as Extract<MenuItem, { type: 'submenu' }>
    expect(submenu.label).toBe('New shell box')
    expect(submenu.children[0]).toMatchObject({ label: 'Yeet this' })
  })

  it('leaves shortcut tokens, colour rows and separators byte-identical', () => {
    // A shortcut is a keyboard CONTRACT re-emitted verbatim through `aria-keyshortcuts`. Rewriting
    // 'Delete' → 'Yeet' here would announce a chord no key listener answers.
    const colors: MenuItem = { type: 'colors', onPick: () => {}, value: '#Delete' }
    const items: MenuItem[] = [
      // The label MUST be one the vocabulary rewrites, or this row returns early untouched and the
      // assertion below passes against an implementation that does translate shortcut tokens.
      { label: 'Delete', onClick: () => {}, shortcut: ['⌘', 'Delete'] },
      { type: 'separator' },
      colors
    ]
    const out = applyVocabularyToMenuItems(items, map)
    expect(out[0]).toMatchObject({ label: 'Yeet' })
    expect((out[0] as { shortcut?: string[] }).shortcut).toEqual(['⌘', 'Delete'])
    expect(out[1]).toBe(items[1])
    expect(out[2]).toBe(colors)
  })

  it('returns the SAME array and item references when nothing changed', () => {
    // Reference stability is load-bearing: `useVocabularyMenuItems`/`useVocabularyCommands` feed
    // memoized consumers, and a fresh array on every render rebuilds the palette's filtered list
    // on every keystroke and defeats the menu's own memoization.
    const items: MenuItem[] = [
      { label: 'Rename', onClick: () => {} },
      { type: 'submenu', label: 'Move to', children: [{ label: 'Inbox', onClick: () => {} }] }
    ]
    expect(applyVocabularyToMenuItems(items, identity)).toBe(items)
    expect(applyVocabularyToMenuItems(items, map)).toBe(items)
  })

  it('keeps untouched siblings identical while replacing only the changed rows', () => {
    const items: MenuItem[] = [
      { label: 'Rename', onClick: () => {} },
      { label: 'Delete', onClick: () => {} }
    ]
    const out = applyVocabularyToMenuItems(items, map)
    expect(out).not.toBe(items)
    expect(out[0]).toBe(items[0])
    expect(out[1]).not.toBe(items[1])
  })
})

describe('applyVocabularyToCommands', () => {
  it('translates label, hint, note, section, secondary label and control prose', () => {
    const commands: Command[] = [
      {
        id: 'new-terminal',
        label: 'New terminal',
        hint: 'terminal',
        note: 'Delete first',
        section: 'terminal',
        secondaryLabel: 'Delete',
        run: () => {},
        control: {
          type: 'select',
          value: 'terminal',
          options: [{ label: 'terminal', value: 'terminal' }],
          onChange: () => {},
          ariaLabel: 'Delete mode'
        }
      }
    ]
    const [out] = applyVocabularyToCommands(commands, map)
    expect(out.label).toBe('New shell box')
    expect(out.hint).toBe('shell box')
    expect(out.note).toBe('Yeet first')
    expect(out.section).toBe('shell box')
    expect(out.secondaryLabel).toBe('Yeet')
    const control = out.control as Extract<NonNullable<Command['control']>, { type: 'select' }>
    expect(control.ariaLabel).toBe('Yeet mode')
    expect(control.options[0].label).toBe('shell box')
  })

  it('never rewrites the id, the searchable content body, or a control option value', () => {
    // `id` is an identifier (React key + caller lookups); `content` is a terminal's own visible
    // output; `value` is what gets WRITTEN to settings.json when the row is cycled. A substitution
    // in any of the three escapes the display boundary.
    const commands: Command[] = [
      {
        id: 'terminal:Delete',
        label: 'Close',
        content: 'terminal: Delete /tmp/x',
        run: () => {},
        control: {
          type: 'select',
          value: 'terminal',
          options: [{ label: 'Delete', value: 'Delete' }],
          onChange: () => {}
        }
      }
    ]
    const [out] = applyVocabularyToCommands(commands, map)
    expect(out.id).toBe('terminal:Delete')
    expect(out.content).toBe('terminal: Delete /tmp/x')
    const control = out.control as Extract<NonNullable<Command['control']>, { type: 'select' }>
    expect(control.value).toBe('terminal')
    expect(control.options[0]).toMatchObject({ label: 'Yeet', value: 'Delete' })
  })

  it('preserves the run/onSecondary closures and the array identity when nothing changed', () => {
    const run = () => {}
    const commands: Command[] = [{ id: 'x', label: 'Rename', run }]
    expect(applyVocabularyToCommands(commands, map)).toBe(commands)
    const changed = applyVocabularyToCommands(
      [{ id: 'x', label: 'Delete', run }],
      map
    )
    expect(changed[0].run).toBe(run)
    expect(changed[0].label).toBe('Yeet')
  })

  it('translates a toggle control accessible name without touching its checked state', () => {
    const commands: Command[] = [
      {
        id: 't',
        label: 'x',
        run: () => {},
        control: { type: 'toggle', checked: true, onToggle: () => {}, ariaLabel: 'Delete on close' }
      }
    ]
    const control = applyVocabularyToCommands(commands, map)[0].control as Extract<
      NonNullable<Command['control']>,
      { type: 'toggle' }
    >
    expect(control.ariaLabel).toBe('Yeet on close')
    expect(control.checked).toBe(true)
  })
})
