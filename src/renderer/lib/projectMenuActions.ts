// The project action menu exists in TWO places — the sessions sidebar's project-header
// right-click (Canvas.tsx `onProjectContextMenu`, rendered through the shared ContextMenu
// portal) and the project switcher's per-row "actions panel" (ProjectSwitcher.tsx, a custom
// expandable list of plain buttons). They grew independently and drifted: the switcher had no
// way to save/open a project archive, and the sidebar menu had no way to edit tab appearance.
//
// The two renderers are too different in shape to share a single `MenuItem[]` builder without
// either bolting a second UI paradigm onto one of them or rewriting the switcher's inline
// account/permission-mode sub-panels for no reason — so instead of duplicating a component,
// this module is the ONE place the label + id + description of each cross-surface action is
// written down. Both files import from here rather than typing the label again, so the label a
// user searches the filter field for can never drift between the two surfaces, and adding a
// fourth cross-surface action means adding it here once instead of twice.
//
// If you add a new action that both surfaces should offer, add it to `SHARED_PROJECT_ACTIONS`
// and wire it into both `Canvas.tsx`'s `onProjectContextMenu` and `ProjectSwitcher.tsx`'s
// actions panel — not just one of them.

export type SharedProjectActionId = 'save-archive' | 'save-archive-media' | 'open-archive' | 'edit-appearance'

export interface SharedProjectAction {
  readonly id: SharedProjectActionId
  readonly label: string
  /** One-line description of what the action does — used in code comments / tests, not UI. */
  readonly description: string
}

export const SAVE_PROJECT_ARCHIVE_ACTION: SharedProjectAction = {
  id: 'save-archive',
  label: 'Save project as one file…',
  description: 'Packs the project (nodes, git history, local settings) into one archive file the user can move or back up.'
}

/** Same archive, plus a picker for local media files to pack alongside it. Kept as a SEPARATE
 *  row on purpose: the plain save row must never open a file picker (the picker used to run
 *  unconditionally, so "Save…" answered with an OS *Open* dialog and a dismissed picker silently
 *  aborted the save). */
export const SAVE_PROJECT_ARCHIVE_WITH_MEDIA_ACTION: SharedProjectAction = {
  id: 'save-archive-media',
  label: 'Save project as one file with media…',
  description: 'Same as "Save project as one file…", but first lets the user pick local media files to pack inside the archive.'
}

export const OPEN_PROJECT_ARCHIVE_ACTION: SharedProjectAction = {
  id: 'open-archive',
  label: 'Open project from file…',
  description: 'Restores a project (and, where available, its repository) from a previously saved archive file.'
}

export const EDIT_TAB_APPEARANCE_ACTION: SharedProjectAction = {
  id: 'edit-appearance',
  label: 'Edit tab appearance…',
  description: 'Opens the non-modal per-element appearance editor anchored to this project row.'
}

/**
 * Every project action that must be reachable from BOTH the sessions sidebar's project-header
 * right-click menu and the project switcher's per-row actions panel. Each surface still owns its
 * own `onClick`/disabled/anchor wiring (they differ: a `MenuItem[]` array vs a plain `<button>`),
 * but the id/label pair below is the single source of truth for what the action is called and
 * that it exists on both surfaces.
 */
export const SHARED_PROJECT_ACTIONS: readonly SharedProjectAction[] = [
  SAVE_PROJECT_ARCHIVE_ACTION,
  SAVE_PROJECT_ARCHIVE_WITH_MEDIA_ACTION,
  OPEN_PROJECT_ARCHIVE_ACTION,
  EDIT_TAB_APPEARANCE_ACTION
]
