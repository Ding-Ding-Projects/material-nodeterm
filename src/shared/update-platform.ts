/** Pure update capability check, unit-tested without an Electron process. */
export function shouldEnableUpdater(isPackaged: boolean, updateMode: unknown): boolean {
  return isPackaged && updateMode !== 'disabled'
}

/**
 * How this build can receive an update. The REMEDY the user needs differs per state, so the card
 * must not blur them:
 *
 *  - `self-install` there is a feed and the Squirrel updater can stage the new version and restart
 *                   into it. The ordinary download → "Restart to update" flow.
 *  - `no-channel`   there is no feed at all: the build was packaged with updates switched off
 *                   (`nodeTermUpdates=disabled`). It can never learn that a newer version exists,
 *                   so a manual check must say so and point at the download page. Answering
 *                   "up to date" here is a false statement, not feedback.
 *  - `dev`          unpackaged. Keeps the quiet "up to date" reply: a developer running
 *                   `npm run dev` is not a user who can be misled about an install.
 *
 * `no-channel` is decided by the BUILD MARKER, never by a platform name.
 */
export type UpdateDelivery = 'self-install' | 'no-channel' | 'dev'

export function updateDelivery(opts: { isPackaged: boolean; updateMode: unknown }): UpdateDelivery {
  if (!opts.isPackaged) return 'dev'
  return shouldEnableUpdater(opts.isPackaged, opts.updateMode) ? 'self-install' : 'no-channel'
}
