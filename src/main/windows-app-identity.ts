/**
 * Squirrel.Windows assigns this identity to the shortcut it creates for the `node-terminal`
 * package's `nodeterm.exe`. The running app must claim the same id or Windows can split taskbar
 * grouping and notifications between two apparent applications. This is intentionally distinct
 * from electron-builder's package-level `build.appId`.
 */
export const WINDOWS_APP_USER_MODEL_ID = 'com.squirrel.node-terminal.nodeterm'

export function applyWindowsAppUserModelId(
  platform: NodeJS.Platform,
  setAppUserModelId: (id: string) => void
): void {
  if (platform === 'win32') setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)
}
