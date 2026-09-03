import { describe, expect, it } from 'vitest'
import {
  NATIVE_COPY_SLOTS,
  emptyNativeCopyProjection,
  joinNativeSegments,
  validateNativeCopyProjection
} from './native-copy-projection'

function valid(epoch = 4) {
  return emptyNativeCopyProjection(epoch)
}

describe('native copy projection protocol', () => {
  it('requires the complete finite slot set exactly once', () => {
    expect(validateNativeCopyProjection(valid()).ok).toBe(true)
    const missing = valid()
    missing.entries = missing.entries.slice(1)
    expect(validateNativeCopyProjection(missing)).toMatchObject({ ok: false })

    const duplicate = valid()
    duplicate.entries[1] = { ...duplicate.entries[0] }
    expect(validateNativeCopyProjection(duplicate)).toMatchObject({ ok: false, reason: 'duplicate native-copy slot' })
  })

  it('rejects stale epochs, unknown slots, malformed segments, and oversized values', () => {
    expect(validateNativeCopyProjection(valid(), 5)).toMatchObject({ ok: false, reason: 'stale projection epoch' })
    const unknown = valid()
    unknown.entries[0] = { slot: 'unknown' as never, segments: [{ kind: 'fact', value: '' }] }
    expect(validateNativeCopyProjection(unknown)).toMatchObject({ ok: false, reason: 'unknown native-copy slot' })
    const malformed = valid()
    malformed.entries[0] = { ...malformed.entries[0], segments: [{ kind: 'copy', value: 3 as never }] }
    expect(validateNativeCopyProjection(malformed)).toMatchObject({ ok: false })
    const oversized = valid()
    oversized.entries[0] = { slot: NATIVE_COPY_SLOTS[0], segments: [{ kind: 'copy', value: 'x'.repeat(4097) }] }
    expect(validateNativeCopyProjection(oversized)).toMatchObject({ ok: false })
  })

  it('joins copy and fact segments without rewriting either one', () => {
    expect(joinNativeSegments([
      { kind: 'copy', value: 'Open ' },
      { kind: 'fact', value: 'C:\\work\\repo' },
      { kind: 'copy', value: ' now' }
    ])).toBe('Open C:\\work\\repo now')
  })
})
