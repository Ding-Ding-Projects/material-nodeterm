import { describe, expect, it, vi } from 'vitest'

const missingSharp = vi.hoisted(() => Object.assign(new Error('sharp is absent from the package'), {
  code: 'MODULE_NOT_FOUND'
}))

vi.mock('sharp', () => {
  throw missingSharp
})

import { imageAdapter, pdfToManifestAdapter } from './advanced-pipeline'

describe('advanced converter native dependency boundary', () => {
  it('loads non-image adapters without resolving Sharp at desktop startup', () => {
    expect(pdfToManifestAdapter.convert).toBeTypeOf('function')
  })

  it('reports a missing Sharp package only when an image conversion actually needs it', async () => {
    await expect(imageAdapter('png').convert(Buffer.from('not-an-image'))).rejects.toThrow(
      /error when mocking a module/i
    )
  })
})
