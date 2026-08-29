/** One-shot discoverability hint for the existing Explorer pin control. */
export const EXPLORER_PIN_HINT_KEY = 'nodeterm.seenExplorerPinHint'
export const EXPLORER_PIN_HINT_TEXT =
  'Tip: the Explorer closes when you click away. Pin it in its header to keep it open while you work.'

export function shouldShowExplorerPinHint(args: {
  wasOpen: boolean
  isOpenAfter: boolean
  pinned: boolean
  openedFile: boolean
  seen: boolean
}): boolean {
  return args.wasOpen && !args.isOpenAfter && !args.pinned && args.openedFile && !args.seen
}

export function readSeenExplorerPinHint(
  getItem: (key: string) => string | null = (key) => localStorage.getItem(key)
): boolean {
  try {
    return getItem(EXPLORER_PIN_HINT_KEY) === '1'
  } catch {
    return true
  }
}

export function writeSeenExplorerPinHint(
  setItem: (key: string, value: string) => void = (key, value) => localStorage.setItem(key, value)
): void {
  try {
    setItem(EXPLORER_PIN_HINT_KEY, '1')
  } catch {
    // A hint cannot make storage failures visible to the user.
  }
}
