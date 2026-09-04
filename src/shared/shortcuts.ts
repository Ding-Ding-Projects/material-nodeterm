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

import { matchesShortcut, parseShortcut } from './shortcut'
import type { ShortcutKeyEvent } from './shortcut'

/** Stable ids — one per configurable hotkey. Mouse gestures (right-click, drags,
 *  double-click, wheel zoom) are NOT here: they have no combo string to configure and
 *  stay fixed; ShortcutsPanel still documents them as reference rows. */
export type ShortcutAction =
  | 'commandPalette' // Ctrl+K
  | 'settings' // Ctrl+,
  | 'shortcutsPanel' // Ctrl+/
  | 'undo' // Ctrl+Z
  | 'redo' // Ctrl+Shift+Z (Ctrl+Y kept as a legacy alias in the handler)
  | 'goBack' // Ctrl+[ — breadcrumb trail camera back
  | 'goForward' // Ctrl+] — breadcrumb trail camera forward
  | 'newTerminal' // Ctrl+T
  | 'newAgent' // Ctrl+Shift+C
  | 'closeNode' // Ctrl+W — intercepted in main, forwarded to the renderer
  | 'reopenLastClosed' // Ctrl+Shift+T — the last closed project tab or deleted node batch
  | 'toggleMarkdown' // Ctrl+M — intercepted in main (the default menu's minimize is repurposed)
  | 'toggleExplorer' // Ctrl+Shift+E
  | 'toggleSourceControl' // Ctrl+Shift+G
  | 'toggleViewMode' // Ctrl+Shift+B
  | 'toggleSessionsPin' // Ctrl+Shift+L
  | 'toggleFocusMode' // Ctrl+Shift+F — one node fills the window, chrome yields
  | 'maximizeNode' // Ctrl+Shift+Enter — resize the focused node and restore it
  | 'findInTerminal' // Ctrl+F
  | 'commitStaged' // Ctrl+↵ (inside the Source Control textarea)
  | 'copySelection' // Ctrl+C (markdown-view copy fallback)

/** `Record<ShortcutAction, string>` — the shape stored in `Settings.shortcuts`. */
export type ShortcutMap = Record<ShortcutAction, string>

/** Group titles for the settings section + ShortcutsPanel (same ordering). */
export type ShortcutGroup = 'General' | 'Canvas' | 'Terminal' | 'Source Control'

/**
 * The focus context a bound chord actually dispatches from. `app` and `canvas` share one
 * window-level keydown listener (Canvas.tsx) and therefore compete for the same keys even
 * though their labels differ; `terminal` fires only while an xterm view owns the key, and
 * `scm` fires only from the Source Control commit composer's own onKeyDown. Two actions in
 * DIFFERENT dispatch contexts can safely share a chord — a Ctrl+F bound to `findInTerminal`
 * never contends with a canvas-scoped Ctrl+F, because only one of them can ever see the
 * keydown for a given focus state. See `conflictBucket` and `resolveShortcutAction` below.
 */
export type ShortcutScope = 'app' | 'canvas' | 'terminal' | 'scm'

export interface ShortcutDef {
  id: ShortcutAction
  group: ShortcutGroup
  /** Human label — the ShortcutsPanel row name and the settings row title. */
  label: string
  /** The combo the app ships with. Changing the default here = changing the shipped hotkey. */
  default: string
  /** Settings-search keywords. */
  keywords: string[]
  /** Which focus context actually dispatches this action — see `ShortcutScope`. */
  scope: ShortcutScope
  /** May fire while a real input/textarea/contentEditable has focus. Defaults to false: a
   *  bound chord always requires the primary modifier (captureToShortcut enforces this), so
   *  this is about intent, not accidental text-mangling — most actions still have no business
   *  firing mid-edit. */
  allowWhileTyping?: boolean
  /** May fire while an xterm terminal view has focus. `scope: 'terminal'` implies this; state
   *  it explicitly for an `app`-scope action that is meant to reach through a terminal (e.g.
   *  the command palette). Defaults to false. */
  allowInTerminal?: boolean
}

// Defaults are stored in the canonical `Cmd+…` notation (see shared/shortcut.ts). Pre-rewire
// settings.json values using `Command+…` remain parseable as aliases.
export const SHORTCUT_DEFS: ShortcutDef[] = [
  { id: 'commandPalette', group: 'General', label: 'Command palette', default: 'Cmd+K', keywords: ['command', 'palette', 'quick', 'open'], scope: 'app', allowInTerminal: true },
  { id: 'settings', group: 'General', label: 'Settings', default: 'Cmd+,', keywords: ['settings', 'preferences', 'open'], scope: 'app', allowInTerminal: true },
  { id: 'shortcutsPanel', group: 'General', label: 'Shortcuts panel', default: 'Cmd+/', keywords: ['shortcuts', 'panel', 'help', 'reference'], scope: 'app', allowInTerminal: true },
  { id: 'undo', group: 'General', label: 'Undo', default: 'Cmd+Z', keywords: ['undo', 'revert'], scope: 'canvas' },
  { id: 'redo', group: 'General', label: 'Redo', default: 'Cmd+Shift+Z', keywords: ['redo', 'forward', 'y'], scope: 'canvas' },
  // Camera history (breadcrumb trail), not node-array history. `[`/`]` are the literal keys
  // `e.key` reports on every layout tested — a canonical word-form spelling does not exist for
  // brackets (shortcut.ts's KEY_ALIASES only covers Comma/Slash/Period), so the combo string
  // spells the character itself, exactly like the existing Cmd+, and Cmd+/ defaults above.
  { id: 'goBack', group: 'Canvas', label: 'Go back', default: 'Cmd+[', keywords: ['back', 'breadcrumb', 'navigate', 'history'], scope: 'canvas' },
  { id: 'goForward', group: 'Canvas', label: 'Go forward', default: 'Cmd+]', keywords: ['forward', 'breadcrumb', 'navigate', 'history'], scope: 'canvas' },
  { id: 'newTerminal', group: 'Canvas', label: 'New terminal', default: 'Cmd+T', keywords: ['terminal', 'new', 'create', 'node'], scope: 'canvas' },
  { id: 'newAgent', group: 'Canvas', label: 'New agent', default: 'Cmd+Shift+C', keywords: ['agent', 'claude', 'codex', 'gemini', 'new', 'add'], scope: 'canvas' },
  { id: 'closeNode', group: 'Canvas', label: 'Close selected node', default: 'Cmd+W', keywords: ['close', 'node', 'window'], scope: 'app', allowInTerminal: true, allowWhileTyping: true },
  { id: 'reopenLastClosed', group: 'General', label: 'Reopen last closed', default: 'Cmd+Shift+T', keywords: ['reopen', 'undo', 'closed', 'restore', 'tab'], scope: 'app', allowInTerminal: true },
  { id: 'toggleExplorer', group: 'Canvas', label: 'Toggle explorer', default: 'Cmd+Shift+E', keywords: ['explorer', 'files', 'sidebar'], scope: 'app', allowInTerminal: true },
  { id: 'toggleSourceControl', group: 'Source Control', label: 'Open Source Control', default: 'Cmd+Shift+G', keywords: ['source', 'control', 'git', 'scm'], scope: 'app', allowInTerminal: true },
  { id: 'toggleViewMode', group: 'Canvas', label: 'Toggle view mode', default: 'Cmd+Shift+B', keywords: ['view', 'mode', 'canvas', 'kanban', 'board'], scope: 'app', allowInTerminal: true },
  { id: 'toggleSessionsPin', group: 'Canvas', label: 'Pin sessions sidebar', default: 'Cmd+Shift+L', keywords: ['sessions', 'pin', 'sidebar', 'collapse'], scope: 'app', allowInTerminal: true },
  { id: 'toggleFocusMode', group: 'Canvas', label: 'Toggle focus mode', default: 'Cmd+Shift+F', keywords: ['focus', 'mode', 'fullscreen', 'zen', 'zoom'], scope: 'canvas' },
  { id: 'toggleMarkdown', group: 'Terminal', label: 'Toggle markdown view', default: 'Cmd+M', keywords: ['markdown', 'md', 'toggle', 'view'], scope: 'app', allowInTerminal: true, allowWhileTyping: true },
  { id: 'findInTerminal', group: 'Terminal', label: 'Find in terminal', default: 'Cmd+F', keywords: ['find', 'search', 'terminal'], scope: 'terminal', allowInTerminal: true },
  { id: 'commitStaged', group: 'Source Control', label: 'Commit staged changes', default: 'Cmd+Enter', keywords: ['commit', 'staged', 'push', 'enter'], scope: 'scm', allowWhileTyping: true },
  { id: 'copySelection', group: 'Terminal', label: 'Copy selection (markdown view)', default: 'Cmd+C', keywords: ['copy', 'selection', 'markdown', 'clipboard'], scope: 'canvas' },
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

/** `'app'`/`'canvas'` share the single window-level keydown listener (one physical
 *  dispatch surface), so they collapse into one `'global'` bucket; `'terminal'` and `'scm'`
 *  each dispatch from their own focused surface and never see a keydown the others do. Two
 *  actions in different buckets can share a chord with no real ambiguity — only same-bucket
 *  collisions are reachable from one keypress. */
export function conflictBucket(scope: ShortcutScope): 'global' | 'terminal' | 'scm' {
  return scope === 'app' || scope === 'canvas' ? 'global' : scope
}

function shortcutScope(id: ShortcutAction): ShortcutScope {
  return SHORTCUT_DEFS.find((d) => d.id === id)?.scope ?? 'app'
}

export function findShortcutConflicts(map: ShortcutMap): [ShortcutAction, ShortcutAction][] {
  const chordKey = (combo: string): string => {
    const p = parseShortcut(combo)
    return `${p.cmd ? 'C' : ''}${p.alt ? 'A' : ''}${p.shift ? 'S' : ''}+${p.key ?? ''}`
  }
  // Bucketed: two actions with the same chord only conflict when their dispatch contexts can
  // actually collide (see `conflictBucket`). Grouping by chord alone would flag e.g. a
  // terminal-only find combo against an unrelated canvas combo that share no focus state.
  const byBucketAndCombo = new Map<string, ShortcutAction[]>()
  for (const [id, combo] of Object.entries(map) as [ShortcutAction, string][]) {
    const key = `${conflictBucket(shortcutScope(id))} ${chordKey(combo)}`
    const list = byBucketAndCombo.get(key) ?? []
    list.push(id)
    byBucketAndCombo.set(key, list)
  }
  const conflicts: [ShortcutAction, ShortcutAction][] = []
  for (const list of byBucketAndCombo.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) conflicts.push([list[i], list[j]])
    }
  }
  return conflicts
}

/** `typing` and `terminal` are expected to be DISJOINT — xterm's own input surface is a
 *  terminal, not a typing surface, so a caller classifying focus must not report both. If one
 *  does anyway, `typing` is checked first and every terminal-scope action becomes unreachable. */
export interface ShortcutDispatchContext {
  /** A real input/textarea/contentEditable has focus (an xterm view excluded). */
  typing: boolean
  /** An xterm terminal view has focus. */
  terminal: boolean
  /** The kanban board is open for the active project (canvas-scope actions are inert there). */
  kanbanOpen: boolean
}

/**
 * Pure dispatch core: the first action (registry source order) whose bound chord in `map`
 * matches `e` and whose scope/flags permit `ctx`. Mirrors what Canvas.tsx's window listener,
 * TerminalNode's find-bar listener, and SourceControlPanel's commit composer already do by
 * hand at each call site (see `shortcuts-dispatch-wiring.test.ts`) — this is the SAME decision
 * expressed once, for a future single dispatcher or for a caller that wants to ask "what would
 * fire here" without re-deriving the per-site guards. It does not replace any of those wired
 * call sites in this change; each keeps its own `matchesShortcut(e, shortcuts.<id>, isMac)`
 * check today.
 *
 * `scm`-scope actions are never returned here: they dispatch from their own focused composer's
 * local onKeyDown, never from a window-level listener — resolving `commitStaged` here would
 * fire a commit with no composer focused.
 */
export function resolveShortcutAction(
  e: ShortcutKeyEvent,
  ctx: ShortcutDispatchContext,
  map: ShortcutMap,
  isMac: boolean
): ShortcutAction | null {
  for (const def of SHORTCUT_DEFS) {
    if (def.scope === 'scm') continue
    if (ctx.typing && !def.allowWhileTyping) continue
    if (ctx.terminal && !(def.scope === 'terminal' || def.allowInTerminal)) continue
    if (!ctx.terminal && def.scope === 'terminal') continue
    if (ctx.kanbanOpen && def.scope === 'canvas') continue
    if (matchesShortcut(e, map[def.id], isMac)) return def.id
  }
  return null
}
