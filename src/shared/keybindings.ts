/**
 * The keybinding registry + engine, shared by main, renderer, and the Server Edition bridge.
 * Registry, validation, effective-binding resolution, conflict detection, override
 * sanitization, and the pure event→command resolver all live in this one module so the
 * dispatchers, Settings UI, and ShortcutsPanel cannot drift apart. Builds on shortcut.ts —
 * canonical binding strings are shortcut.ts strings (`Ctrl` is the only emitted primary modifier,
 * historical `Cmd` and `Command` spellings are read-only migration input, and modifier-only
 * chords are hold-to-talk).
 */
import { AGENT_CONFIG } from './agents/config'
import {
  parseShortcut,
  serializeShortcut,
  resolvedModifiers,
  matchesShortcut,
  isHoldChord
} from './shortcut'
import type { ShortcutKeyEvent } from './shortcut'

export type CommandScope = 'app' | 'canvas' | 'terminal' | 'scm'
export type CommandGroup = 'General' | 'Canvas' | 'Nodes' | 'Terminal' | 'Source Control' | 'Speech'

export interface CommandDefinition {
  id: CommandId
  /** English row label for ShortcutsPanel and the Settings section. */
  title: string
  group: CommandGroup
  scope: CommandScope
  /** Canonical shortcut.ts strings. Empty array = unassigned. */
  defaultBindings: readonly string[]
  /** May fire while a real input/textarea/contentEditable is focused (xterm excluded). */
  allowWhileTyping?: boolean
  /** May fire while an xterm has focus. Scope 'terminal' implies it. */
  allowInTerminal?: boolean
  /** Permits modifier-less bindings, restricted to SAFE_BARE_KEYS. */
  allowBareKey?: boolean
  /** Permits modifier-only hold chords (hold-to-talk). */
  allowHoldChord?: boolean
}

export type CommandId =
  | 'app.commandPalette'
  | 'app.settings'
  | 'app.shortcutsPanel'
  | 'view.kanbanToggle'
  | 'view.focusMode'
  | 'panel.explorer'
  | 'panel.sourceControl'
  | 'panel.sessions'
  | 'app.reopenLastClosed'
  | 'canvas.undo'
  | 'canvas.redo'
  | 'canvas.goBack'
  | 'canvas.goForward'
  | 'canvas.deleteSelection'
  | 'canvas.fitAll'
  | 'canvas.tidy'
  | 'canvas.groupSelection'
  | 'node.newTerminal'
  | 'node.newAgent'
  // Per-builtin-agent creates. The ids are spelled STATICALLY (never derived from
  // BUILTIN_AGENT_IDS) so this union stays literal — `isCommandId`, the overrides map and the
  // handler table all depend on that.
  | 'node.newAgent.claude'
  | 'node.newAgent.codex'
  | 'node.newAgent.gemini'
  | 'node.newAgent.opencode'
  | 'node.newAgent.grok'
  | 'node.newAgent.copilot'
  | 'node.newAgent.devin'
  | 'node.newSticky'
  | 'node.newBrowser'
  | 'node.newWebView'
  | 'node.newDino'
  | 'node.newFile'
  | 'node.focusLeft'
  | 'node.focusRight'
  | 'node.focusUp'
  | 'node.focusDown'
  | 'node.maximize'
  | 'node.zoneLeft'
  | 'node.zoneRight'
  | 'node.zoneUp'
  | 'node.zoneDown'
  | 'node.close'
  | 'node.toggleMarkdown'
  | 'terminal.find'
  | 'terminal.copySelection'
  | 'scm.commit'
  | 'speech.dictation'

/** The single supported desktop default list. */
const defaults = (...bindings: string[]): readonly string[] => bindings

export const COMMAND_DEFINITIONS: readonly CommandDefinition[] = [
  // General — the Canvas.tsx:4491 block today; fires while an xterm has focus, and (bug,
  // fixed in the dispatch PR) also while typing. allowWhileTyping is deliberately absent.
  { id: 'app.commandPalette', title: 'Command palette', group: 'General', scope: 'app',
    defaultBindings: defaults('Ctrl+K'), allowInTerminal: true },
  { id: 'app.settings', title: 'Open settings', group: 'General', scope: 'app',
    defaultBindings: defaults('Ctrl+Comma'), allowInTerminal: true },
  { id: 'app.shortcutsPanel', title: 'Keyboard shortcuts panel', group: 'General', scope: 'app',
    defaultBindings: defaults('Ctrl+Slash'), allowInTerminal: true },
  { id: 'view.kanbanToggle', title: 'Toggle kanban board', group: 'General', scope: 'app',
    defaultBindings: defaults('Ctrl+Shift+B'), allowInTerminal: true },
  // Focus mode fills the window with one node — most naturally invoked from INSIDE the terminal
  // being enlarged, hence allowInTerminal. Scope stays 'canvas': over the kanban board or while
  // typing in an input there is no node geometry for the toggle to act on (the pre-registry
  // hardcoded chord fired in both places; the registry gating is the fix, not a regression).
  { id: 'view.focusMode', title: 'Toggle focus mode', group: 'General', scope: 'canvas',
    defaultBindings: defaults('Ctrl+Shift+F'), allowInTerminal: true },
  { id: 'panel.explorer', title: 'Toggle explorer panel', group: 'General', scope: 'app',
    defaultBindings: defaults('Ctrl+Shift+E'), allowInTerminal: true },
  { id: 'panel.sourceControl', title: 'Toggle source control panel', group: 'General', scope: 'app',
    defaultBindings: defaults('Ctrl+Shift+G'), allowInTerminal: true },
  { id: 'panel.sessions', title: 'Pin sessions sidebar', group: 'General', scope: 'app',
    defaultBindings: defaults('Ctrl+Shift+L'), allowInTerminal: true },
  { id: 'app.reopenLastClosed', title: 'Reopen last closed', group: 'General', scope: 'app',
    defaultBindings: defaults('Ctrl+Shift+T'), allowInTerminal: true },

  // Canvas — inert while the kanban board is open (scope 'canvas'), blocked while typing.
  { id: 'canvas.undo', title: 'Undo', group: 'Canvas', scope: 'canvas',
    defaultBindings: defaults('Ctrl+Z') },
  { id: 'canvas.redo', title: 'Redo', group: 'Canvas', scope: 'canvas',
    defaultBindings: defaults('Ctrl+Shift+Z', 'Ctrl+Y') },
  // Camera history (breadcrumb trail), not node-array history: `[` / `]` are the literal keys
  // `e.key` reports, which is what the resolver compares against — `BracketLeft`/`BracketRight`
  // are `KeyboardEvent.code` values and would never match (shortcut.ts's KEY_ALIASES covers only
  // Comma/Slash/Period, so brackets have no word-form spelling here). Ctrl+[ is reserved from
  // terminal contexts because it is commonly interpreted as ESC there, and scope 'canvas' without
  // allowWhileTyping means the resolver refuses it whenever a terminal or input has focus.
  { id: 'canvas.goBack', title: 'Go back', group: 'Canvas', scope: 'canvas',
    defaultBindings: defaults('Ctrl+[') },
  { id: 'canvas.goForward', title: 'Go forward', group: 'Canvas', scope: 'canvas',
    defaultBindings: defaults('Ctrl+]') },
  { id: 'canvas.deleteSelection', title: 'Delete selection', group: 'Canvas', scope: 'canvas',
    // Mirrors the current platform-blind handler; the typing guard keeps Backspace safe.
    defaultBindings: defaults('Delete', 'Backspace'),
    allowBareKey: true },
  { id: 'canvas.fitAll', title: 'Fit all nodes in view', group: 'Canvas', scope: 'canvas',
    defaultBindings: defaults() },
  { id: 'canvas.tidy', title: 'Tidy canvas', group: 'Canvas', scope: 'canvas',
    // arrangeAllNodes self-guards (kanban open, <2 top-level nodes), same as the Ctrl+K/menu entries.
    defaultBindings: defaults('Ctrl+Shift+A') },
  { id: 'canvas.groupSelection', title: 'Group selection', group: 'Canvas', scope: 'canvas',
    defaultBindings: defaults() },

  // Nodes
  { id: 'node.newTerminal', title: 'New terminal node', group: 'Nodes', scope: 'canvas',
    defaultBindings: defaults('Ctrl+T') },
  { id: 'node.newAgent', title: 'New agent node', group: 'Nodes', scope: 'canvas',
    // Ctrl+Shift+C is a common terminal-copy convention, so the dedicated terminal scope keeps
    // its own copy action separate from this canvas command.
    defaultBindings: defaults('Ctrl+Shift+C') },
  // Every command below ships UNBOUND on purpose: they expand the remappable POOL, and a chord
  // nobody asked for would either shadow an existing default or steal a key from the terminal.
  // The user assigns them in Settings → Keyboard Shortcuts; titles come from AGENT_CONFIG so a
  // relabelled agent cannot drift from its row.
  { id: 'node.newAgent.claude', title: `New ${AGENT_CONFIG.claude.label} node`, group: 'Nodes',
    scope: 'canvas', defaultBindings: defaults() },
  { id: 'node.newAgent.codex', title: `New ${AGENT_CONFIG.codex.label} node`, group: 'Nodes',
    scope: 'canvas', defaultBindings: defaults() },
  { id: 'node.newAgent.gemini', title: `New ${AGENT_CONFIG.gemini.label} node`, group: 'Nodes',
    scope: 'canvas', defaultBindings: defaults() },
  { id: 'node.newAgent.opencode', title: `New ${AGENT_CONFIG.opencode.label} node`, group: 'Nodes',
    scope: 'canvas', defaultBindings: defaults() },
  { id: 'node.newAgent.grok', title: `New ${AGENT_CONFIG.grok.label} node`, group: 'Nodes',
    scope: 'canvas', defaultBindings: defaults() },
  { id: 'node.newAgent.copilot', title: `New ${AGENT_CONFIG.copilot.label} node`, group: 'Nodes',
    scope: 'canvas', defaultBindings: both() },
  { id: 'node.newAgent.devin', title: `New ${AGENT_CONFIG.devin.label} node`, group: 'Nodes',
    scope: 'canvas', defaultBindings: both() },
  { id: 'node.newSticky', title: 'New sticky note', group: 'Nodes', scope: 'canvas',
    defaultBindings: defaults() },
  { id: 'node.newBrowser', title: 'New browser node', group: 'Nodes', scope: 'canvas',
    defaultBindings: defaults() },
  { id: 'node.newWebView', title: 'New web view node', group: 'Nodes', scope: 'canvas',
    defaultBindings: defaults() },
  { id: 'node.newDino', title: 'New dino node', group: 'Nodes', scope: 'canvas',
    defaultBindings: defaults() },
  { id: 'node.newFile', title: 'New file…', group: 'Nodes', scope: 'canvas',
    defaultBindings: defaults() },

  // Directional focus, the multiplexer gesture (Ghostty goto_split, tmux select-pane -L). Two
  // flags carry the whole point: scope 'canvas' because there is no geometry to walk on the
  // board, and allowInTerminal because the hand that wants to move is already typing in a
  // terminal — without it the gesture only works from the one place you don't need it.
  //
  // The default avoids Ctrl+Arrow because terminals commonly use it for word navigation.
  // Ctrl+Arrow is readline's word-jump, and allowInTerminal would steal it from every shell on
  // Linux and Windows. Ctrl+Alt+Arrow is out for a different reason — the speech.dictation
  // default is the modifier-only chord 'Cmd+Alt', which on those platforms is Ctrl+Alt held, so
  // the hold listener would start recording on the way to an arrow. Ctrl+Shift+Arrow is what is
  // left that no shell and no other command already owns.
  { id: 'node.focusLeft', title: 'Focus node to the left', group: 'Nodes', scope: 'canvas',
    defaultBindings: defaults('Ctrl+Shift+ArrowLeft'),
    allowInTerminal: true },
  { id: 'node.focusRight', title: 'Focus node to the right', group: 'Nodes', scope: 'canvas',
    defaultBindings: defaults('Ctrl+Shift+ArrowRight'),
    allowInTerminal: true },
  { id: 'node.focusUp', title: 'Focus node above', group: 'Nodes', scope: 'canvas',
    defaultBindings: defaults('Ctrl+Shift+ArrowUp'),
    allowInTerminal: true },
  { id: 'node.focusDown', title: 'Focus node below', group: 'Nodes', scope: 'canvas',
    defaultBindings: defaults('Ctrl+Shift+ArrowDown'),
    allowInTerminal: true },
  // The header maximize toggle's chord (issue #399): fill the viewport with the node under the
  // keyboard (else the single selected node), or restore it. allowInTerminal for focus-mode's
  // reason — the hand that wants more rows is already typing in the terminal being enlarged.
  // Ctrl+Shift+Enter is a familiar maximize-pane gesture and collides with no global command.
  { id: 'node.maximize', title: 'Maximize / restore node', group: 'Nodes', scope: 'canvas',
    defaultBindings: defaults('Ctrl+Shift+Enter'), allowInTerminal: true },
  // Zone snap (issue #394 v1): send the node under the keyboard (else the single selected one)
  // into a half of the visible canvas. The halves stay unbound because Ctrl+Alt+Arrow would trip
  // the speech.dictation hold chord, and Ctrl+Shift+Arrow belongs to the focus commands.
  // Quarters and thirds have no commands — the node context menu's "Snap to zone" carries them.
  { id: 'node.zoneLeft', title: 'Snap node to left half', group: 'Nodes', scope: 'canvas',
    defaultBindings: defaults(), allowInTerminal: true },
  { id: 'node.zoneRight', title: 'Snap node to right half', group: 'Nodes', scope: 'canvas',
    defaultBindings: defaults(), allowInTerminal: true },
  { id: 'node.zoneUp', title: 'Snap node to top half', group: 'Nodes', scope: 'canvas',
    defaultBindings: defaults(), allowInTerminal: true },
  { id: 'node.zoneDown', title: 'Snap node to bottom half', group: 'Nodes', scope: 'canvas',
    defaultBindings: defaults(), allowInTerminal: true },
  // Main-process intercepted today (unconditional): keep firing everywhere.
  { id: 'node.close', title: 'Close node / window', group: 'Nodes', scope: 'app',
    defaultBindings: defaults('Ctrl+W'), allowInTerminal: true, allowWhileTyping: true },
  { id: 'node.toggleMarkdown', title: 'Toggle markdown view', group: 'Nodes', scope: 'app',
    defaultBindings: defaults('Ctrl+M'), allowInTerminal: true, allowWhileTyping: true },

  // Terminal
  { id: 'terminal.find', title: 'Find in terminal', group: 'Terminal', scope: 'terminal',
    defaultBindings: defaults('Ctrl+F') },
  { id: 'terminal.copySelection', title: 'Copy terminal selection', group: 'Terminal',
    scope: 'terminal',
    // Plain Ctrl+C stays the terminal interrupt convention. Use Ctrl+Insert for copy here.
    defaultBindings: defaults('Ctrl+Insert') },

  // Source control (local handler; registry supplies label + remap)
  { id: 'scm.commit', title: 'Commit', group: 'Source Control', scope: 'scm',
    defaultBindings: defaults('Ctrl+Enter'), allowWhileTyping: true },

  // Speech — the migrated dictation chord; hold-to-talk by default.
  { id: 'speech.dictation', title: 'Dictate', group: 'Speech', scope: 'app',
    defaultBindings: defaults('Ctrl+Alt'),
    allowHoldChord: true, allowInTerminal: true, allowWhileTyping: true }
]

export const COMMANDS_BY_ID: ReadonlyMap<CommandId, CommandDefinition> = new Map(
  COMMAND_DEFINITIONS.map((d) => [d.id, d])
)

export function isCommandId(v: string): v is CommandId {
  return COMMANDS_BY_ID.has(v as CommandId)
}

/** Modifier-less keys that are safe to bind bare — they don't type a character. */
export const SAFE_BARE_KEYS: ReadonlySet<string> = new Set([
  'DELETE', 'BACKSPACE', 'ESCAPE', 'ENTER', 'TAB',
  'ARROWUP', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT', 'PAGEUP', 'PAGEDOWN',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'
])

export type NormalizedBinding = { ok: true; value: string } | { ok: false; error: string }

/** Parse + validate one binding string against a command's flags; returns the canonical
 *  serialized form on success. The single validation path for defaults (pinned by a registry
 *  test), Settings-recorder captures, and hand-edited settings.json overrides. */
export function normalizeBindingForCommand(
  def: CommandDefinition,
  raw: string,
  _legacyPlatformFlag?: boolean
): NormalizedBinding {
  const p = parseShortcut(raw)
  const hasAnyToken = p.cmd || p.ctrl || p.alt || p.shift || p.key !== null
  if (!hasAnyToken) return { ok: false, error: 'Use a shortcut like Ctrl+K or Ctrl+Shift+P.' }
  if (p.cmd && p.ctrl) return { ok: false, error: 'Use only one Control modifier.' }
  if (p.key === null) {
    if (!def.allowHoldChord) {
      return { ok: false, error: 'This command needs a key, not a modifier-only chord.' }
    }
    if (!p.cmd && !p.ctrl && !p.alt) {
      return { ok: false, error: 'A hold chord needs at least one non-shift modifier.' }
    }
    return { ok: true, value: serializeShortcut(p) }
  }
  const hasStrongModifier = p.cmd || p.ctrl || p.alt
  if (!hasStrongModifier) {
    if (p.shift) return { ok: false, error: 'Shift-only shortcuts would steal typed text.' }
    if (!def.allowBareKey || !SAFE_BARE_KEYS.has(p.key)) {
      return { ok: false, error: 'Include a modifier key.' }
    }
  }
  return { ok: true, value: serializeShortcut(p) }
}

/** User overrides, as stored in settings.json under `keybindings`. Absent id = defaults;
 *  `[]` = disabled. */
export type KeybindingOverrides = Partial<Record<CommandId, readonly string[]>>

export function getEffectiveBindings(
  id: CommandId,
  overrides: KeybindingOverrides,
  _legacyPlatformFlag?: boolean
): readonly string[] {
  const override = overrides[id]
  if (override !== undefined) return override
  const def = COMMANDS_BY_ID.get(id)
  if (!def) return []
  return def.defaultBindings
}

/** Control-resolved identity. Legacy primary spellings and canonical Control spellings share one
 * identity, and key aliases collapse through `serializeShortcut`. */
export function bindingIdentity(binding: string, _legacyPlatformFlag?: boolean): string {
  const p = parseShortcut(binding)
  const m = resolvedModifiers(p)
  return [
    m.meta ? 'M' : '',
    m.ctrl ? 'C' : '',
    m.alt ? 'A' : '',
    m.shift ? 'S' : '',
    ':',
    p.key === null
      ? '(hold)'
      : serializeShortcut({ cmd: false, ctrl: false, alt: false, shift: false, key: p.key })
  ].join('')
}

/** Commands sharing a bucket compete for the same keys. 'app' and 'canvas' share one global
 *  keyspace (both dispatch from the window listener; canvas commands are merely inert while
 *  the board is open); terminal and scm are their own focused surfaces.
 *
 *  **`speech.dictation` is its own fourth bucket, and the reason is dispatch, not scope.** It
 *  never competes for a chord: the resolver SKIPS it outright (see the `def.id ===
 *  'speech.dictation'` guard in `resolveCommandForKeyEvent`), and its keyed gesture runs from a
 *  dedicated listener that claims the chord FIRST in plain app focus. So a chord shared with
 *  another command is a matter of PRECEDENCE — dictation wins where it listens, the other command
 *  wins everywhere else (terminal focus, say) — never ambiguity, which is the only thing the
 *  conflict detector exists to find. Folding it into 'global' therefore reported a collision that
 *  dispatch cannot produce.
 *
 *  What the bucket BUYS is survival on the read path: `sanitizeKeybindingOverrides` deletes every
 *  overridden participant of a reported conflict, so a migrated legacy chord that happened to match
 *  another command's binding (the `speech.shortcut` → `speech.dictation` seed in
 *  `core/settings-store.ts`) was seeded on load and stripped moments later, taking the user's own
 *  colliding override with it. With its own bucket the seed survives.
 *
 *  **Overlap policy is deliberately asymmetric.** The LOAD path PERMITS a shared chord — legacy
 *  settings.json files already contain them and silently dropping a user's chord is the failure
 *  this closes. The Settings UI REFUSES to create one (`commitCandidate`'s two dictation gates),
 *  because a user picking a chord interactively should be told about the precedence rather than
 *  discover it later. One case the permissive load path cannot rescue: a keyed dictation override
 *  on a MAIN-INTERCEPTED chord (Ctrl+W / Ctrl+M) wins NOWHERE because main claims those in
 *  `before-input-event`
 *  before the page exists, so such a hand-edit survives sanitization as a permanently dead chord.
 *  The UI can never create it (`commitCandidate`'s reverse-shadow gate refuses it one step earlier
 *  than the dictation gates). */
export function conflictBucket(
  def: Pick<CommandDefinition, 'id' | 'scope'>
): 'global' | 'terminal' | 'scm' | 'dictation' {
  if (def.id === 'speech.dictation') return 'dictation'
  return def.scope === 'app' || def.scope === 'canvas' ? 'global' : def.scope
}

export interface KeybindingConflict {
  /** Canonical string of one colliding spelling (the first seen). */
  binding: string
  /** Sorted ids of every command holding the identity. */
  commandIds: CommandId[]
}

/** Collisions between effective bindings within a bucket. By default only collisions touching
 *  at least one overridden command are reported (shipped defaults are asserted conflict-free
 *  by a registry test using `includeDefaults: true` — user-facing surfaces never nag about
 *  stock bindings). */
export function findKeybindingConflicts(
  overrides: KeybindingOverrides,
  optionsOrLegacyFlag: { includeDefaults?: boolean } | boolean = {},
  opts: { includeDefaults?: boolean } = {}
): KeybindingConflict[] {
  const options = typeof optionsOrLegacyFlag === 'object' ? optionsOrLegacyFlag : opts
  const byBucketAndIdentity = new Map<string, { binding: string; ids: Set<CommandId> }>()
  for (const def of COMMAND_DEFINITIONS) {
    for (const binding of getEffectiveBindings(def.id, overrides)) {
      const key = `${conflictBucket(def)} ${bindingIdentity(binding)}`
      const entry = byBucketAndIdentity.get(key) ?? {
        // Canonicalized, so a hand-edited `cmd+k` override is reported as `Cmd+K`.
        binding: serializeShortcut(parseShortcut(binding)),
        ids: new Set<CommandId>()
      }
      entry.ids.add(def.id)
      byBucketAndIdentity.set(key, entry)
    }
  }
  const conflicts: KeybindingConflict[] = []
  for (const { binding, ids } of byBucketAndIdentity.values()) {
    if (ids.size < 2) continue
    const commandIds = [...ids].sort()
    const touchesOverride = commandIds.some((id) => overrides[id] !== undefined)
    if (options.includeDefaults || touchesOverride) conflicts.push({ binding, commandIds })
  }
  return conflicts
}

/** Commands the MAIN process intercepts via before-input-event. A remap of one of these is
 *  swallowed app-wide before any renderer surface sees the key, so the Settings UI must check
 *  its candidate against EVERY command — the per-bucket conflict detector cannot see this. */
export const MAIN_INTERCEPTED_COMMAND_IDS: readonly CommandId[] = [
  'node.close',
  'node.toggleMarkdown'
]

/** Cross-bucket shadowing check for a candidate binding of a main-intercepted command:
 *  every OTHER command whose effective bindings share the candidate's platform identity.
 *  Empty for non-intercepted commands (their collisions are the ordinary bucket check). */
export function findMainInterceptShadowing(
  id: CommandId,
  candidate: string,
  overrides: KeybindingOverrides,
  _legacyPlatformFlag?: boolean
): CommandId[] {
  if (!MAIN_INTERCEPTED_COMMAND_IDS.includes(id)) return []
  const target = bindingIdentity(candidate)
  const hits: CommandId[] = []
  for (const def of COMMAND_DEFINITIONS) {
    if (def.id === id) continue
    for (const binding of getEffectiveBindings(def.id, overrides)) {
      if (bindingIdentity(binding) === target) {
        hits.push(def.id)
        break
      }
    }
  }
  return hits
}

/** Validate a raw `settings.keybindings` value (hand-editable JSON) into a safe override map.
 *  Loops until conflict-free so one bad edit cannot leave ambiguous dispatch. This is the
 *  SETTINGS-LOAD path: it applies what survives and warns about what it dropped. It is not the
 *  pre-save gate — its warnings are unstructured strings, which cannot tell a UI which field to
 *  block on. The Settings UI blocks pre-save in `ShortcutsSection.commitCandidate`, which runs
 *  `normalizeBindingForCommand` (inside its recorder) and `findKeybindingConflicts` directly, per
 *  candidate binding: same detector, different surfacing (design.md D3). */
export function sanitizeKeybindingOverrides(
  raw: unknown,
  _legacyPlatformFlag?: boolean
): { overrides: KeybindingOverrides; warnings: string[] } {
  const warnings: string[] = []
  const overrides: Partial<Record<CommandId, string[]>> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) warnings.push('keybindings must be an object; ignored.')
    return { overrides, warnings }
  }
  for (const [id, value] of Object.entries(raw)) {
    if (!isCommandId(id)) {
      warnings.push(`Unknown command "${id}" ignored.`)
      continue
    }
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
      warnings.push(`Bindings for "${id}" must be an array of strings; ignored.`)
      continue
    }
    const def = COMMANDS_BY_ID.get(id)!
    const normalized: string[] = []
    for (const s of value as string[]) {
      const r = normalizeBindingForCommand(def, s)
      if (r.ok) {
        if (!normalized.includes(r.value)) normalized.push(r.value)
      } else {
        warnings.push(`Binding "${s}" for "${id}" ignored: ${r.error}`)
      }
    }
    // A list that HAD entries and lost every one of them falls back to defaults rather than
    // being stored as `[]`: `[]` means "disabled", so a typo in a hand-edited settings.json
    // would silently turn a working shortcut off. An explicit `[]` in the input still disables.
    if (value.length > 0 && normalized.length === 0) {
      warnings.push(`All bindings for "${id}" were invalid; falling back to defaults.`)
      continue
    }
    overrides[id] = normalized
  }
  // Strip overridden participants of any remaining conflict until none are left. Bounded:
  // each pass removes at least one override or exits.
  // NEVER pass `includeDefaults: true` here. Termination rests on the touchesOverride reporting
  // gate: every reported conflict has at least one OVERRIDE to delete, so a pass always shrinks
  // the map. A default-vs-default conflict has no deletable participant, so it would be reported
  // forever and the loop would spin.
  for (;;) {
    const conflicts = findKeybindingConflicts(overrides)
    if (conflicts.length === 0) break
    for (const conflict of conflicts) {
      const titles = conflict.commandIds
        .map((cid) => COMMANDS_BY_ID.get(cid)?.title ?? cid)
        .join(', ')
      warnings.push(`Conflicting shortcut ${conflict.binding} between: ${titles}. Overrides dropped.`)
      for (const cid of conflict.commandIds) {
        if (overrides[cid] !== undefined) delete overrides[cid]
      }
    }
  }
  return { overrides, warnings }
}

/** Who wins while an xterm has focus. 'app-first' (default): allowInTerminal app commands still
 *  fire (today's behavior). 'terminal-first': ONLY scope:'terminal' commands fire; everything
 *  else, including allowInTerminal app commands, the main-intercepted Ctrl+W/Ctrl+M, and the
 *  registry-less gestures,
 *  reaches the PTY. NOTE: the naive reading "terminal-first = the existing allowInTerminal gate"
 *  is vacuous here — that gate IS app-first; this flag tightens past it. */
export type TerminalShortcutPolicy = 'app-first' | 'terminal-first'

/** Unknown/legacy values read as app-first (the safe, current-behavior direction). */
export function normalizeTerminalShortcutPolicy(v: unknown): TerminalShortcutPolicy {
  return v === 'terminal-first' ? 'terminal-first' : 'app-first'
}

/** `typing` and `terminal` are expected to be DISJOINT — xterm's hidden textarea is a terminal,
 *  not a typing surface, so a caller classifying focus must not report both. If one does anyway,
 *  `typing` wins (it is checked first) and every terminal-scope command becomes unreachable. */
export interface KeyDispatchContext {
  /** A real input/textarea/contentEditable has focus (xterm's hidden textarea excluded). */
  typing: boolean
  /** An xterm has focus. */
  terminal: boolean
  /** The kanban board is open for the active project. */
  kanbanOpen: boolean
  /** terminal-first policy is active: while `terminal` is true, only scope:'terminal' commands
   *  may resolve (allowInTerminal is an app-first concept). Inert when `terminal` is false. */
  terminalFirst: boolean
}

/** Pure dispatch core: the first registry command (source order) whose effective bindings
 *  match `e` and whose flags permit the context. Keyed chords only — hold chords are the
 *  dedicated hold listener's job (`chordHeld`). Callers preventDefault only when the
 *  returned command's handler actually claims the chord. */
export function resolveCommandForKeyEvent(
  e: ShortcutKeyEvent,
  ctx: KeyDispatchContext,
  overrides: KeybindingOverrides,
  _legacyPlatformFlag?: boolean
): CommandId | null {
  for (const def of COMMAND_DEFINITIONS) {
    // scm commands dispatch from their own focused composer (local onKeyDown), never from
    // the window listener — resolving them here would fire Commit with no composer focused.
    if (def.scope === 'scm') continue
    // speech.dictation dispatches from its own dedicated listeners (the keyed gesture and the
    // hold-mode effect, both reading `dictationBinding()` — the registry override; the legacy
    // settings.speech.shortcut field is only its downgrade mirror), never from here — its
    // row here is display-only, for ShortcutsPanel and the Settings section. A hand-edited KEYED
    // override would otherwise RESOLVE, find no handler, and spend the chord: the dispatcher's
    // claim protocol stops a resolved command from reaching the trailing gestures, so
    // `{"speech.dictation": ["Cmd+0"]}` would silently kill zoom-to-100%.
    if (def.id === 'speech.dictation') continue
    if (ctx.typing && !def.allowWhileTyping) continue
    if (ctx.terminal) {
      if (def.scope !== 'terminal' && (ctx.terminalFirst || !def.allowInTerminal)) continue
    }
    if (!ctx.terminal && def.scope === 'terminal') continue
    if (ctx.kanbanOpen && def.scope === 'canvas') continue
    for (const binding of getEffectiveBindings(def.id, overrides)) {
      // Hold chords belong to the dedicated hold listener, and this skip STATES that contract
      // rather than relying on it being unreachable: `matchesShortcut` also refuses a key-null
      // chord today (`parsed.key !== null`), so removing this line changes nothing — until the
      // day it does.
      if (isHoldChord(binding)) continue
      if (matchesShortcut(e, binding)) return def.id
    }
  }
  return null
}
