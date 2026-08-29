/** The shipped display name for School mode, before any user renames it. Mirrors
 *  `core/school-mode.ts`'s `DEFAULT_SCHOOL_MODE_NAME` — kept as its own tiny renderer-side
 *  constant rather than importing from `src/core` (the renderer only ever talks to core through
 *  `window.nodeTerminal`, never by importing it directly). */
export const DEFAULT_SCHOOL_MODE_NAME = 'School mode'
