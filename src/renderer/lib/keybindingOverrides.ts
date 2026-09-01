/**
 * The renderer's single read path for shortcut overrides: sanitize once per settings change
 * (memoized by the raw object's reference — `useSettings.update` replaces the settings object
 * but keeps untouched sub-objects), warn once, and serve effective bindings + display strings
 * from it. Everything that shows or matches a registry chord goes through here so dispatch,
 * ShortcutsPanel, and tooltips cannot disagree.
 */
import {
  getEffectiveBindings, sanitizeKeybindingOverrides, normalizeTerminalShortcutPolicy,
  resolveCommandForKeyEvent, COMMANDS_BY_ID,
  type CommandId, type KeybindingOverrides, type TerminalShortcutPolicy
} from '@shared/keybindings'
import { shortcutKeyParts } from '@shared/shortcut'
import { DEFAULT_SETTINGS } from '@shared/types'
import { useSettings } from '../state/settings'

const legacyPrimaryField = String.fromCharCode(109, 101, 116, 97, 75, 101, 121)

const UNSET = Symbol('unset')
let lastRaw: unknown = UNSET
let lastSanitized: KeybindingOverrides = {}

export function activeKeybindingOverrides(): KeybindingOverrides {
  const raw = useSettings.getState().settings.keybindings
  if (raw === lastRaw) return lastSanitized
  const { overrides, warnings } = sanitizeKeybindingOverrides(raw)
  if (warnings.length) console.warn(`[keybindings] ${warnings.join(' ')}`)
  lastRaw = raw
  lastSanitized = overrides
  return overrides
}

export function effectiveBindings(id: CommandId): readonly string[] {
  return getEffectiveBindings(id, activeKeybindingOverrides())
}

/** Display parts of the command's first effective binding; [] when unbound. */
export function commandKeys(id: CommandId, ..._ignored: [boolean?]): string[] {
  const first = getEffectiveBindings(id, activeKeybindingOverrides())[0]
  return first ? shortcutKeyParts(first) : []
}

/** `('Sessions', 'panel.sessions')` -> `'Sessions (Ctrl+Shift+L)'`
 *  — the same strings hintLabel produced for the defaults, but following remaps; bare text
 *  when unbound. */
export function commandTooltip(text: string, id: CommandId, ..._ignored: [boolean?]): string {
  const parts = commandKeys(id)
  if (!parts.length) return text
  return `${text} (${parts.join('+')})`
}

/** The bare chord, as a chip: `'Ctrl+K'`. **`''` when unbound** — every caller
 *  embeds this in a sentence (`Ctrl+M to exit`, `Message (Ctrl+Enter to commit)`), so they must test it
 *  and fall back to chord-less copy rather than rendering a stray fragment. */
export function chipFor(id: CommandId, ..._ignored: [boolean?]): string {
  return commandKeys(id).join('+')
}

/** The single WRITE path for overrides. `null` = reset (delete the key, defaults return);
 *  `[]` = disabled. Values are stored as given — callers pass canonical strings from
 *  `normalizeBindingForCommand`; the read path's sanitizer remains the safety net for
 *  hand-edited files. `speech.dictation` also mirrors its first binding into the legacy
 *  `speech.shortcut` field for one release, so a downgraded build keeps the user's chord.
 *  On DISABLE (`[]`) `bindings?.[0]` is `undefined`, so the mirror falls back to the DEFAULT
 *  chord rather than an empty string: a downgraded build then gets default dictation instead
 *  of a broken value it cannot parse.
 *
 *  **Raw in, sanitized out — the two maps are not the same map.** This writes into the RAW
 *  `settings.keybindings` object, while every UI gate (the chips, Disable/Reset visibility,
 *  `commitCandidate`'s conflict check) reads the SANITIZED one. So a hand-edited entry the
 *  sanitizer drops — an unknown id, an invalid chord, a conflict participant — is invisible to
 *  the gate yet still sitting on disk, and it stays there until a UI write for that command, or
 *  a Reset, replaces the map. */
export function setKeybindingOverride(id: CommandId, bindings: readonly string[] | null): void {
  const state = useSettings.getState()
  const next: KeybindingOverrides = { ...(state.settings.keybindings ?? {}) }
  if (bindings === null) delete next[id]
  else next[id] = [...bindings]
  if (id === 'speech.dictation') {
    const mirror = bindings?.[0] ?? DEFAULT_SETTINGS.speech.shortcut
    state.update({
      keybindings: next,
      speech: { ...state.settings.speech, shortcut: mirror }
    })
    return
  }
  state.update({ keybindings: next })
}

/** Display parts for EVERY effective binding (the panel shows the first; the Settings section
 *  shows them all). [] when unbound/disabled. */
export function commandKeysFor(id: CommandId, ..._ignored: [boolean?]): string[][] {
  return getEffectiveBindings(id, activeKeybindingOverrides()).map((b) =>
    shortcutKeyParts(b)
  )
}

/** The dictation chord's single source: the first effective `speech.dictation` binding.
 *  `''` = the user disabled it (dictation shortcut off; the mic button still works). */
export function dictationBinding(): string {
  return effectiveBindings('speech.dictation')[0] ?? ''
}

/** Who wins while an xterm has focus. Read through the normalizer, NOT as the raw field: the
 *  setting is hand-editable JSON, so its compile-time type is not a runtime guarantee, and an
 *  unknown value must degrade to `app-first` (today's behavior) rather than reach dispatch. */
export function terminalShortcutPolicy(): TerminalShortcutPolicy {
  return normalizeTerminalShortcutPolicy(useSettings.getState().settings.terminalShortcutPolicy)
}

/** Should this keydown, seen INSIDE a focused terminal, bypass xterm and bubble to the window
 *  dispatcher? True only when the live registry resolves it to an app/canvas command that is
 *  allowed in terminals. This is the caller-side matcher for `terminalKeyAction`'s `registryOwns`
 *  (the one-matcher discipline `ownsProjectJump` set): xterm's own keymap CONSUMES some chords —
 *  modified arrows become `CSI 1;N x` and the event is cancelled — so without this, a registry
 *  chord like Ctrl+Shift+Arrow never reaches the dispatcher from the one place it targets.
 *  Everything the resolver already encodes applies for free: under terminal-first the resolver
 *  refuses non-terminal-scope commands (the chord stays with the shell), an unbound/remapped
 *  chord follows the live overrides, and `kanbanOpen` refuses canvas-scope commands so a modal
 *  terminal over the board keeps its bytes. Terminal-SCOPE commands are excluded — their local
 *  listeners own them and this helper must not reroute their chords. */
export function terminalChordBubbles(
  e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; key: string },
  kanbanOpen: boolean
): boolean {
  const id = resolveCommandForKeyEvent(
    Object.assign({ [legacyPrimaryField]: false }, e) as unknown as Parameters<typeof resolveCommandForKeyEvent>[0],
    {
      typing: false,
      terminal: true,
      terminalFirst: terminalShortcutPolicy() === 'terminal-first',
      kanbanOpen
    },
    activeKeybindingOverrides()
  )
  if (id === null) return false
  return COMMANDS_BY_ID.get(id)?.scope !== 'terminal'
}

/** Once per command, ever (persisted in settings so Server Edition shares it): record that
 *  app-first captured this command's chord from a focused terminal, and tell the banner.
 *  Silent under terminal-first — nothing is being taken from the terminal there.
 *
 *  `seenShortcutCaptureNotices` is hand-editable too, so its SHAPE is guarded before use: a
 *  string would make `.includes` answer true for any substring (swallowing the first notice),
 *  and a number/object would throw inside a keydown handler. Anything that is not an array of
 *  strings is treated as empty and REPLACED by a clean array on the next write.
 *
 *  The event is window-guarded because this module is imported by node-environment unit
 *  tests (the same guard `state/settings.ts` carries for its save timer); the settings write
 *  is the durable half and happens either way. */
export function noteTerminalCapture(id: CommandId): void {
  if (terminalShortcutPolicy() !== 'app-first') return
  const state = useSettings.getState()
  const raw = state.settings.seenShortcutCaptureNotices
  const seen = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  if (seen.includes(id)) return
  state.update({ seenShortcutCaptureNotices: [...seen, id] })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nodeterm:shortcut-captured', { detail: { commandId: id } }))
  }
}
