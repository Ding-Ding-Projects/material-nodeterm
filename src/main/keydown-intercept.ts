import { IPC } from '../shared/ipc'
import {
  getEffectiveBindings,
  sanitizeKeybindingOverrides,
  type TerminalShortcutPolicy
} from '../shared/keybindings'
import { matchesShortcut } from '../shared/shortcut'

/** Main-process actions that must be claimed before the renderer page receives the key. */
export type KeydownInterceptAction = 'toggle-markdown' | 'close-node' | 'zoom-actual-size'

/** The subset of Electron's Input shape needed by the pure interception decision. */
export interface KeydownInterceptInput {
  type: string
  key: string
  code: string
  meta: boolean
  control: boolean
  shift: boolean
  alt: boolean
  isAutoRepeat: boolean
}

export interface KeydownInterceptDecision {
  action: KeydownInterceptAction | null
}

/** Effective settings for the two registry commands intercepted above the renderer. */
export interface KeydownInterceptBindings {
  closeNode: readonly string[]
  toggleMarkdown: readonly string[]
}

/** Parse and sanitize user settings before they reach the input-event hot path. */
export function resolveInterceptBindings(rawOverrides: unknown): KeydownInterceptBindings {
  const { overrides } = sanitizeKeybindingOverrides(rawOverrides)
  return {
    closeNode: getEffectiveBindings('node.close', overrides),
    toggleMarkdown: getEffectiveBindings('node.toggleMarkdown', overrides)
  }
}

function toShortcutEvent(input: KeydownInterceptInput) {
  return {
    metaKey: input.meta,
    ctrlKey: input.control,
    shiftKey: input.shift,
    altKey: input.alt,
    key: input.key
  }
}

/** Resolve one before-input event. Matching is exact and Control-only. */
export function keydownIntercept(
  input: KeydownInterceptInput,
  bindings: KeydownInterceptBindings
): KeydownInterceptDecision | null {
  if (input.type !== 'keyDown') return null
  const event = toShortcutEvent(input)
  if (bindings.toggleMarkdown.some((binding) => matchesShortcut(event, binding))) {
    return { action: 'toggle-markdown' }
  }
  if (bindings.closeNode.some((binding) => matchesShortcut(event, binding))) {
    return { action: 'close-node' }
  }
  // Digit0 is a fixed canvas gesture. It claims only an exact Ctrl+0 event and consumes repeats
  // without restarting the zoom animation.
  if (input.code === 'Digit0' && input.control && !input.meta && !input.shift && !input.alt) {
    return { action: input.isAutoRepeat ? null : 'zoom-actual-size' }
  }
  return null
}

/** A real main-frame navigation clears recorder state. Same-document and subframe changes do not. */
export function navigationClearsRecording(details: {
  isMainFrame: boolean
  isSameDocument: boolean
}): boolean {
  return details.isMainFrame && !details.isSameDocument
}

/** Terminal-first relinquishes application interception while the terminal owns focus. */
export function policyStandsDown(
  policy: TerminalShortcutPolicy,
  terminalFocused: boolean
): boolean {
  return policy === 'terminal-first' && terminalFocused
}

/** Ctrl+W remains available to the focused terminal instead of closing its window. */
export function closeStandsDownInTerminal(terminalFocused: boolean): boolean {
  return terminalFocused
}

/** The menu disables these accelerator-bearing items whenever interception must stand down. */
export function menuStandsDown(
  recording: boolean,
  policy: TerminalShortcutPolicy,
  terminalFocused: boolean
): boolean {
  return recording || policyStandsDown(policy, terminalFocused)
}

export const MENU_ITEM_ID_MINIMIZE = 'window-minimize'
export const MENU_ITEM_ID_CLOSE = 'window-close'
export const MENU_ITEM_ID_KANBAN = 'view-kanban-toggle'
export const MENU_ITEM_ID_SETTINGS = 'app-settings'

export function menuItemIdsToSuspend(): string[] {
  return [MENU_ITEM_ID_MINIMIZE, MENU_ITEM_ID_KANBAN, MENU_ITEM_ID_SETTINGS, MENU_ITEM_ID_CLOSE]
}

export function keydownInterceptChannel(action: KeydownInterceptAction): string {
  if (action === 'toggle-markdown') return IPC.appToggleMarkdown
  if (action === 'close-node') return IPC.appCloseNode
  return IPC.appZoomActualSize
}

/** Structural window surface used to keep the module free of a direct Electron import. */
export interface KeydownInterceptTarget {
  webContents: {
    on(
      event: 'before-input-event',
      listener: (event: { preventDefault(): void }, input: KeydownInterceptInput) => void
    ): void
    send(channel: string, ...args: unknown[]): void
  }
}

/** Install the Control-only before-input interceptor. */
export function installKeydownIntercepts(
  win: KeydownInterceptTarget,
  getBindings: () => KeydownInterceptBindings,
  isRecording: () => boolean,
  isStoodDown: () => boolean,
  isCloseSuspended: () => boolean = () => false
): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (isRecording() || isStoodDown()) return
    const decision = keydownIntercept(input, getBindings())
    if (!decision) return
    if (decision.action === 'close-node' && isCloseSuspended()) return
    event.preventDefault()
    if (decision.action) win.webContents.send(keydownInterceptChannel(decision.action))
  })
}
