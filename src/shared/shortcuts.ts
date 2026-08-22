/**
 * The configurable keyboard-shortcut registry. One entry per hotkey the app ships with;
 * the canonical combo string (see `shared/shortcut.ts`) is the value, keyed by a stable
 * action id so settings survive renames and the UI never has to know a combo by heart.
 *
 * Kept OUT of `shared/types.ts` so the registry (labels, groups, defaults, conflict
 * detection) stays with the shortcut engine it describes; `types.ts` only imports the
 * `ShortcutMap` type and `DEFAULT_SHORTCUTS` to seed `Settings.shortcuts`.
 *
 * A shortcut becomes user-configurable by (1) adding its action here with the CURRENT
 * hardcoded combo as the default, (2) wiring the dispatch site to
 * `settings.shortcuts.<action>` via `matchesShortcut`, and (3) the section renders it
 * automatically from SHORTCUT_DEFS.
 */

import { parseShortcut } from './shortcut'

/** Stable ids — one per configurable hotkey. Mouse gestures (right-click, drags,
 *  double-click, wheel zoom) are NOT here: they have no combo string to configure and
 *  stay fixed; ShortcutsPanel still documents them as reference rows. */
export type ShortcutAction =
  | 'commandPalette' // Ctrl+K
  | 'settings' // Ctrl+,
  | 'shortcutsPanel' // Ctrl+/
  | 'undo' // Ctrl+Z
  | 'redo' // Ctrl+Shift+Z (Ctrl+Y kept as a legacy alias in the handler)
  | 'newTerminal' // Ctrl+T
  | 'newAgent' // Ctrl+Shift+C
  | 'closeNode' // Ctrl+W — intercepted in main, forwarded to the renderer
  | 'toggleMarkdown' // Ctrl+M — intercepted in main (the default menu's minimize is repurposed)
  | 'toggleExplorer' // Ctrl+Shift+E
  | 'toggleSourceControl' // Ctrl+Shift+G
  | 'toggleViewMode' // Ctrl+Shift+B
  | 'toggleSessionsPin' // Ctrl+Shift+L
  | 'toggleFocusMode' // Ctrl+Shift+F — one node fills the window, chrome yields
  | 'findInTerminal' // Ctrl+F
  | 'commitStaged' // Ctrl+↵ (inside the Source Control textarea)
  | 'copySelection' // Ctrl+C (markdown-view copy fallback)

/** `Record<ShortcutAction, string>` — the shape stored in `Settings.shortcuts`. */
export type ShortcutMap = Record<ShortcutAction, string>

/** Group titles for the settings section + ShortcutsPanel (same ordering). */
export type ShortcutGroup = 'General' | 'Canvas' | 'Terminal' | 'Source Control'

export interface ShortcutDef {
  id: ShortcutAction
  group: ShortcutGroup
  /** Human label — the ShortcutsPanel row name and the settings row title. */
  label: string
  /** The combo the app ships with. Changing the default here = changing the shipped hotkey. */
  default: string
  /** Settings-search keywords. */
  keywords: string[]
}

// Defaults are stored in the canonical `Ctrl+…` notation (see shared/shortcut.ts): `Ctrl` still
// means the platform primary modifier at match time (⌘ for a Server Edition browser tab on a real
// Mac), so these are the same chords as the pre-rewire `Cmd+…` strings — only the canonical
// spelling changed. Pre-rewire settings.json values keep working through the parse-only alias.
export const SHORTCUT_DEFS: ShortcutDef[] = [
  { id: 'commandPalette', group: 'General', label: 'Command palette', default: 'Ctrl+K', keywords: ['command', 'palette', 'quick', 'open'] },
  { id: 'settings', group: 'General', label: 'Settings', default: 'Ctrl+,', keywords: ['settings', 'preferences', 'open'] },
  { id: 'shortcutsPanel', group: 'General', label: 'Shortcuts panel', default: 'Ctrl+/', keywords: ['shortcuts', 'panel', 'help', 'reference'] },
  { id: 'undo', group: 'General', label: 'Undo', default: 'Ctrl+Z', keywords: ['undo', 'revert'] },
  { id: 'redo', group: 'General', label: 'Redo', default: 'Ctrl+Shift+Z', keywords: ['redo', 'forward', 'y'] },
  { id: 'newTerminal', group: 'Canvas', label: 'New terminal', default: 'Ctrl+T', keywords: ['terminal', 'new', 'create', 'node'] },
  { id: 'newAgent', group: 'Canvas', label: 'New agent', default: 'Ctrl+Shift+C', keywords: ['agent', 'claude', 'codex', 'gemini', 'new', 'add'] },
  { id: 'closeNode', group: 'Canvas', label: 'Close selected node', default: 'Ctrl+W', keywords: ['close', 'node', 'window'] },
  { id: 'toggleExplorer', group: 'Canvas', label: 'Toggle explorer', default: 'Ctrl+Shift+E', keywords: ['explorer', 'files', 'sidebar'] },
  { id: 'toggleSourceControl', group: 'Source Control', label: 'Open Source Control', default: 'Ctrl+Shift+G', keywords: ['source', 'control', 'git', 'scm'] },
  { id: 'toggleViewMode', group: 'Canvas', label: 'Toggle view mode', default: 'Ctrl+Shift+B', keywords: ['view', 'mode', 'canvas', 'kanban', 'board'] },
  { id: 'toggleSessionsPin', group: 'Canvas', label: 'Pin sessions sidebar', default: 'Ctrl+Shift+L', keywords: ['sessions', 'pin', 'sidebar', 'collapse'] },
  { id: 'toggleFocusMode', group: 'Canvas', label: 'Toggle focus mode', default: 'Ctrl+Shift+F', keywords: ['focus', 'mode', 'fullscreen', 'zen', 'zoom'] },
  { id: 'toggleMarkdown', group: 'Terminal', label: 'Toggle markdown view', default: 'Ctrl+M', keywords: ['markdown', 'md', 'toggle', 'view'] },
  { id: 'findInTerminal', group: 'Terminal', label: 'Find in terminal', default: 'Ctrl+F', keywords: ['find', 'search', 'terminal'] },
  { id: 'commitStaged', group: 'Source Control', label: 'Commit staged changes', default: 'Ctrl+Enter', keywords: ['commit', 'staged', 'push', 'enter'] },
  { id: 'copySelection', group: 'Terminal', label: 'Copy selection (markdown view)', default: 'Ctrl+C', keywords: ['copy', 'selection', 'markdown', 'clipboard'] }
]

/** The shipped map — seeds `DEFAULT_SETTINGS.shortcuts` and the section's Reset buttons. */
export const DEFAULT_SHORTCUTS: ShortcutMap = Object.fromEntries(
  SHORTCUT_DEFS.map((d) => [d.id, d.default])
) as ShortcutMap

/** `'commandPalette'` -> `'Command palette'`. */
export function shortcutLabel(id: ShortcutAction): string {
  return SHORTCUT_DEFS.find((d) => d.id === id)?.label ?? id
}

/** Groups in display order, each with its defs. */
export function shortcutGroups(): { title: ShortcutGroup; defs: ShortcutDef[] }[] {
  const order: ShortcutGroup[] = ['General', 'Canvas', 'Terminal', 'Source Control']
  return order.map((title) => ({ title, defs: SHORTCUT_DEFS.filter((d) => d.group === title) }))
}

/**
 * Pairs of actions that share a chord (duplicates) in `map`. The settings section
 * flags these so a user who maps two hotkeys to the same keys sees the collision — the
 * first matched dispatch site wins at runtime, so a silent duplicate is a real trap.
 * Pure + structural so it is unit-testable without a DOM.
 *
 * Keyed by the PARSED chord, not the raw string: after the Windows rewire a map can hold mixed
 * notation — a pre-rewire settings.json keeps `"Cmd+K"` while a fresh rebind stores `"Ctrl+K"` —
 * and those are the same chord at match time. Raw-string grouping would call that pair
 * conflict-free while both actions fight over one keydown.
 */
export function findShortcutConflicts(map: ShortcutMap): [ShortcutAction, ShortcutAction][] {
  const chordKey = (combo: string): string => {
    const p = parseShortcut(combo)
    return `${p.cmd ? 'C' : ''}${p.alt ? 'A' : ''}${p.shift ? 'S' : ''}+${p.key ?? ''}`
  }
  const byCombo = new Map<string, ShortcutAction[]>()
  for (const [id, combo] of Object.entries(map) as [ShortcutAction, string][]) {
    const key = chordKey(combo)
    const list = byCombo.get(key) ?? []
    list.push(id)
    byCombo.set(key, list)
  }
  const conflicts: [ShortcutAction, ShortcutAction][] = []
  for (const list of byCombo.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) conflicts.push([list[i], list[j]])
    }
  }
  return conflicts
}
