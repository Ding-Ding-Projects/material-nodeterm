import { describe, expect, it, vi } from 'vitest'
import { resolvePortableMediaForSave } from './projectArchiveSave'

describe('resolvePortableMediaForSave', () => {
  it('a plain save never runs the media picker', async () => {
    const choose = vi.fn(async () => ({ preparationId: 'p', decisions: [] }))
    await expect(resolvePortableMediaForSave(false, choose)).resolves.toEqual({ kind: 'none' })
    expect(choose).not.toHaveBeenCalled()
  })

  it('a save with media carries the chosen plan', async () => {
    const plan = { preparationId: 'p', decisions: [] }
    await expect(resolvePortableMediaForSave(true, async () => plan)).resolves.toEqual({ kind: 'plan', plan })
  })

  it('a dismissed picker is a cancellation, not a silent no-op', async () => {
    await expect(resolvePortableMediaForSave(true, async () => null)).resolves.toEqual({ kind: 'cancelled' })
  })
})
