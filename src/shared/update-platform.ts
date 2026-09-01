/** Pure update capability check, unit-tested without an Electron process. */
export function shouldEnableUpdater(isPackaged: boolean, updateMode: unknown): boolean {
  return isPackaged && updateMode !== 'disabled'
}
