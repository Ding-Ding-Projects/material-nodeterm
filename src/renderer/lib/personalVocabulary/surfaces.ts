import type { MenuItem } from '../../components/ContextMenu'
import type { Command, CommandControl } from '../../components/CommandPalette'

/**
 * The two structured user-facing surfaces that are built as DATA rather than as JSX: a context
 * menu's item tree and the command palette's command list. Both are assembled by dozens of
 * callers, so translating them here — once, where the structure is known — is what makes the
 * personal vocabulary reach every one of those callers without editing any of them.
 *
 * These are pure so the decision "which field is prose, which stays verbatim" is testable without
 * a renderer. The React bindings live in `useVocabularySurfaces.ts`.
 *
 * A `map` that is the identity (no file uploaded, or School mode suppressing the feature) must
 * return the ORIGINAL array/object references, not fresh copies: the palette memoizes its filtered
 * list on `commands`, and returning a new array every render would rebuild it on every keystroke
 * and defeat `PaletteRow`'s intersection-observer laziness.
 */
export type VocabularyMap = <T extends string | undefined | null>(text: T) => T

/**
 * Prose in a context-menu tree is exactly two fields: the row `label` (including a section
 * heading's and a submenu's own label) and the `hint` that explains why a row is disabled.
 *
 * Everything else is deliberately left byte-identical:
 * - `onClick` / `onPick` — behaviour, not text.
 * - `shortcut` — canonical key tokens (`'⌘'`, `'T'`). They are a keyboard contract that
 *   `aria-keyshortcuts` re-emits verbatim; a replacement here would announce a chord that does
 *   not exist and would drift from what the key listener actually does.
 * - `accountPresentation` — an account's identity (email, id) is a factual external record.
 * - `colors` rows — a colour value, never prose.
 */
export function applyVocabularyToMenuItems(items: MenuItem[], map: VocabularyMap): MenuItem[] {
  let changed = false
  const mapped = items.map((item) => {
    if (item.type === 'separator' || item.type === 'colors') return item
    if (item.type === 'submenu') {
      const label = map(item.label)
      const children = applyVocabularyToMenuItems(item.children, map)
      if (label === item.label && children === item.children) return item
      changed = true
      return { ...item, label, children }
    }
    if (item.type === 'label') {
      const label = map(item.label)
      if (label === item.label) return item
      changed = true
      return { ...item, label }
    }
    const label = map(item.label)
    const hint = map(item.hint)
    if (label === item.label && hint === item.hint) return item
    changed = true
    return { ...item, label, hint }
  })
  return changed ? mapped : items
}

/** A palette row's inline control: only its accessible name and the option labels a user reads. */
function applyVocabularyToControl(
  control: CommandControl | undefined,
  map: VocabularyMap
): CommandControl | undefined {
  if (!control) return control
  if (control.type === 'toggle') {
    const ariaLabel = map(control.ariaLabel)
    return ariaLabel === control.ariaLabel ? control : { ...control, ariaLabel }
  }
  const ariaLabel = map(control.ariaLabel)
  let optionsChanged = false
  const options = control.options.map((o) => {
    const label = map(o.label)
    if (label === o.label) return o
    optionsChanged = true
    // `value` is the persisted settings value — never translated, or the row would write a
    // vocabulary word into settings.json the next time it is cycled.
    return { ...o, label }
  })
  if (ariaLabel === control.ariaLabel && !optionsChanged) return control
  return { ...control, ariaLabel, options }
}

/**
 * Prose on a palette command: the `label`, the searchable `hint`, the non-searchable `note`
 * (a reason a row is disabled), the `section` heading, the secondary button's label, and the
 * inline control's accessible name / option labels.
 *
 * `id` and `content` are NOT translated. `id` is an identifier used as a React key and by the
 * callers' own lookups; `content` is a command's searchable BODY — terminal output and transcript
 * text, i.e. quoted output that must stay exactly as the machine produced it.
 *
 * Call this BEFORE filtering, never after: the user searches for the words they can see, so a
 * palette that displays the replacement but matches the original is a palette where the visible
 * row cannot be typed.
 */
export function applyVocabularyToCommands(commands: Command[], map: VocabularyMap): Command[] {
  let changed = false
  const mapped = commands.map((c) => {
    const label = map(c.label)
    const hint = map(c.hint)
    const note = map(c.note)
    const section = map(c.section)
    const secondaryLabel = map(c.secondaryLabel)
    const control = applyVocabularyToControl(c.control, map)
    if (
      label === c.label &&
      hint === c.hint &&
      note === c.note &&
      section === c.section &&
      secondaryLabel === c.secondaryLabel &&
      control === c.control
    ) {
      return c
    }
    changed = true
    return { ...c, label, hint, note, section, secondaryLabel, control }
  })
  return changed ? mapped : commands
}
