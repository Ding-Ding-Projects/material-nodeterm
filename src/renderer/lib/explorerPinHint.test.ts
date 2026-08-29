import { describe, expect, it } from 'vitest'
import { EXPLORER_PIN_HINT_KEY, readSeenExplorerPinHint, shouldShowExplorerPinHint, writeSeenExplorerPinHint } from './explorerPinHint'

const base = { wasOpen: true, isOpenAfter: false, pinned: false, openedFile: true, seen: false }

describe('Explorer pin hint', () => {
  it('fires once for an unpinned close after opening a file', () => {
    expect(shouldShowExplorerPinHint(base)).toBe(true)
    expect(shouldShowExplorerPinHint({ ...base, seen: true })).toBe(false)
  })

  it('does not fire for pinned, browse-only, or non-transition states', () => {
    expect(shouldShowExplorerPinHint({ ...base, pinned: true })).toBe(false)
    expect(shouldShowExplorerPinHint({ ...base, openedFile: false })).toBe(false)
    expect(shouldShowExplorerPinHint({ ...base, wasOpen: false })).toBe(false)
    expect(shouldShowExplorerPinHint({ ...base, isOpenAfter: true })).toBe(false)
  })

  it('round-trips and fails safe around storage errors', () => {
    const store = new Map<string, string>()
    expect(readSeenExplorerPinHint((key) => store.get(key) ?? null)).toBe(false)
    writeSeenExplorerPinHint((key, value) => store.set(key, value))
    expect(store.get(EXPLORER_PIN_HINT_KEY)).toBe('1')
    expect(readSeenExplorerPinHint(() => { throw new Error('private mode') })).toBe(true)
    expect(() => writeSeenExplorerPinHint(() => { throw new Error('quota') })).not.toThrow()
  })
})
