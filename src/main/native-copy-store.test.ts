import { describe, expect, it } from 'vitest'
import { NATIVE_COPY_SLOTS, emptyNativeCopyProjection } from '../shared/native-copy-projection'
import { NativeCopyStore } from './native-copy-store'

describe('NativeCopyStore', () => {
  it('accepts only the attached owner and current epoch, atomically', () => {
    const store = new NativeCopyStore()
    const epoch = store.attach(11)
    const projection = emptyNativeCopyProjection(epoch)
    projection.entries[0] = { slot: NATIVE_COPY_SLOTS[0], segments: [{ kind: 'copy', value: 'Control Room' }] }
    expect(store.replace(12, projection)).toMatchObject({ ok: false })
    expect(store.replace(11, projection)).toMatchObject({ ok: true, epoch })
    expect(store.get(NATIVE_COPY_SLOTS[0], 'Settings')).toBe('Control Room')
    const stale = { ...projection, epoch: epoch - 1 }
    expect(store.replace(11, stale)).toMatchObject({ ok: false })
    expect(store.get(NATIVE_COPY_SLOTS[0], 'Settings')).toBe('Control Room')
  })

  it('resets and increments the epoch on detach and attach', () => {
    const store = new NativeCopyStore()
    const first = store.attach(1)
    const projection = emptyNativeCopyProjection(first)
    projection.entries[0] = { slot: NATIVE_COPY_SLOTS[0], segments: [{ kind: 'copy', value: 'Changed' }] }
    expect(store.replace(1, projection).ok).toBe(true)
    const second = store.detach(1)
    expect(second).not.toBe(first)
    expect(store.get(NATIVE_COPY_SLOTS[0], 'Settings')).toBe('Settings')
    const third = store.attach(2)
    expect(third).not.toBe(second)
    expect(store.replace(1, emptyNativeCopyProjection(third))).toMatchObject({ ok: false })
  })
})
