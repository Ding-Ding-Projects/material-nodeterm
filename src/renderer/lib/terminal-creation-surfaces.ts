/** The existing Canvas creation funnel. Keep this signature aligned with `addTerminal`: every
 * surface eventually reaches this one callback, and only an explicit profile selection may fill
 * the fifth argument. */
export type AddTerminalFromSurface = (
  center?: { x: number; y: number },
  initialCommand?: string,
  groupId?: string,
  cwdOverride?: string,
  terminalProfileId?: string
) => void

export interface TerminalCreationScope {
  center?: { x: number; y: number } | undefined
  groupId?: string | undefined
}

export interface TerminalProfileCreationChoice {
  id: string
  label: string
  disabled: boolean
  hint?: string
}

/** Presentation-neutral action used by both context menus and command-palette assembly. */
export interface TerminalProfileCreationAction {
  id: string
  profileId: string
  label: string
  disabled: boolean
  note?: string
  run: () => void
}

/**
 * Build a one-click creation callback without manufacturing an explicit profile selection.
 *
 * The branches deliberately preserve the historical call shapes. In particular, a global action
 * calls `addTerminal()` with no arguments so the node factory snapshots the saved default; a group
 * action fills only the first and third positions. This is the behavioral seam shared by keyboard,
 * sidebar, Dock, command-palette, canvas-menu, and group-menu creation.
 */
export function defaultTerminalCreationHandler(
  addTerminal: AddTerminalFromSurface,
  scope: TerminalCreationScope = {}
): () => void {
  if (scope.groupId !== undefined) {
    return () => addTerminal(scope.center, undefined, scope.groupId)
  }
  if (scope.center !== undefined) {
    return () => addTerminal(scope.center)
  }
  return () => addTerminal()
}

/**
 * Build an explicit-profile sibling of a one-click creation callback. The stable profile id is the
 * only execution choice this renderer callback carries, and it always occupies the existing fifth
 * argument; executable paths and argv never enter this seam.
 */
export function profileTerminalCreationHandler(
  addTerminal: AddTerminalFromSurface,
  profileId: string,
  scope: TerminalCreationScope = {}
): () => void {
  return () => addTerminal(scope.center, undefined, scope.groupId, undefined, profileId)
}

/**
 * Assemble the profile-explicit siblings shared by Canvas menus and the command palette. Disabled
 * choices stay discoverable with their reason and are inert even if a caller invokes `run`
 * directly instead of going through the UI component's disabled guard.
 */
export function terminalProfileCreationActions(
  addTerminal: AddTerminalFromSurface,
  choices: readonly TerminalProfileCreationChoice[],
  scope: TerminalCreationScope = {}
): TerminalProfileCreationAction[] {
  return choices.map((choice) => ({
    id: `new-term-profile:${choice.id}`,
    profileId: choice.id,
    label: choice.label,
    disabled: choice.disabled,
    note: choice.hint,
    run: choice.disabled
      ? () => {}
      : profileTerminalCreationHandler(addTerminal, choice.id, scope)
  }))
}

export interface DefaultTerminalShortcutEvent {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
}

export interface DefaultTerminalShortcutContext {
  kanbanOpen: boolean
  typing: boolean
}

/** Pure decision behind the Canvas Ctrl+T route. Board coverage and editable-focus refusal are
 * part of the shortcut contract, while the returned action is intentionally default-only. */
export function defaultTerminalShortcutAction(
  event: DefaultTerminalShortcutEvent,
  context: DefaultTerminalShortcutContext
): 'create-default-terminal' | null {
  if (context.kanbanOpen || context.typing) return null
  if (!event.ctrlKey) return null
  if (event.shiftKey || event.key.toLowerCase() !== 't') return null
  return 'create-default-terminal'
}
