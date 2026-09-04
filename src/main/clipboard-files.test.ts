import { describe, expect, it, vi } from 'vitest'
import {
  writeFilesToClipboard,
  type FileClipboardDependencies
} from './clipboard-files'

const absolute = (name: string): string => `${String.raw`C:\Files`}\\${name}`

const dependencies = (
  overrides: Partial<FileClipboardDependencies> = {}
): FileClipboardDependencies => ({
  platform: 'win32',
  isFile: () => true,
  writeFileDropList: vi.fn(),
  ...overrides
})

describe('writeFilesToClipboard', () => {
  it('writes unique existing absolute files through the Windows file-drop boundary', async () => {
    const deps = dependencies()
    await expect(
      writeFilesToClipboard([absolute('a & b.png'), absolute('a & b.png')], deps)
    ).resolves.toBe(true)
    expect(deps.writeFileDropList).toHaveBeenCalledWith([absolute('a & b.png')])
  })

  it('rejects unsupported platforms and any selection containing an invalid file', async () => {
    await expect(
      writeFilesToClipboard([absolute('a')], dependencies({ platform: 'linux' }))
    ).resolves.toBe(false)
    await expect(
      writeFilesToClipboard([absolute('a')], dependencies({ isFile: () => false }))
    ).resolves.toBe(false)
    await expect(
      writeFilesToClipboard([absolute('a'), 'relative'], dependencies())
    ).resolves.toBe(false)
    await expect(writeFilesToClipboard('not-an-array', dependencies())).resolves.toBe(false)
  })

  it('caps the selection after de-duplication and never writes a partial list', async () => {
    const paths = (count: number): string[] =>
      Array.from({ length: count }, (_, index) => absolute(`f${index}`))
    const at = dependencies()
    await expect(writeFilesToClipboard(paths(64), at)).resolves.toBe(true)
    expect(at.writeFileDropList).toHaveBeenCalledWith(paths(64))

    const over = dependencies()
    await expect(writeFilesToClipboard(paths(65), over)).resolves.toBe(false)
    expect(over.writeFileDropList).not.toHaveBeenCalled()

    const duplicate = dependencies()
    await expect(writeFilesToClipboard([...paths(64), absolute('f0')], duplicate)).resolves.toBe(
      true
    )
    expect(duplicate.writeFileDropList).toHaveBeenCalledWith(paths(64))
  })

  it('fails closed when the native clipboard bridge rejects', async () => {
    await expect(
      writeFilesToClipboard(
        [absolute('a')],
        dependencies({
          writeFileDropList: async () => {
            throw new Error('clipboard unavailable')
          }
        })
      )
    ).resolves.toBe(false)
  })
})
