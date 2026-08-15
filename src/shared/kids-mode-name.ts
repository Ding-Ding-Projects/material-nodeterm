/** The shipped display name for Kids mode, before a user renames it.
 *
 *  Lives in `src/shared` rather than beside the store because the RENDERER needs it as a default
 *  before any IPC has answered, and importing `core/kids-mode.ts` from the renderer would pull a
 *  node:fs-using module into the browser bundle. Same reason `lib/schoolModeName.ts` exists. */
export const DEFAULT_KIDS_MODE_NAME = 'Kids mode'
