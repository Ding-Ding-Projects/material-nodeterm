/**
 * The app's SHIPPED identity — a constant, never read from settings.
 *
 * `Settings.appDisplayName` is a pure presentation label (docs/app-rename.md): the title bar, the
 * brand mark, notifications and the About surface may show whatever the user typed there, but
 * everything that has to identify the REAL product — the userData directory name, the electron-
 * builder `appId`/`productName`, the update feed, a marker this app writes into a user's own
 * repository (hook scripts, skill files, git config) and any diagnostic/crash report — reads from
 * this constant instead. Display reads a setting; identity reads a constant; one must never read
 * the other, or a rename would silently orphan a user's stored data.
 */
export const SHIPPED_APP_NAME = 'nodeterm'

/** What every diagnostic, crash report, and GitHub issue must call this app, regardless of what
 *  the user renamed it to on screen — a bug report titled after a name only that one user chose
 *  is useless to read. */
export const DIAGNOSTIC_APP_NAME = SHIPPED_APP_NAME

/** The name to SHOW the user: their chosen display name, else the shipped name. Trimmed and
 *  bounded so a stray newline or an absurd length can't distort the title bar / brand mark. */
export function resolveAppDisplayName(appDisplayName: string | undefined | null): string {
  const trimmed = (appDisplayName ?? '').trim().replace(/\s+/g, ' ')
  if (!trimmed) return SHIPPED_APP_NAME
  return trimmed.slice(0, 60)
}
