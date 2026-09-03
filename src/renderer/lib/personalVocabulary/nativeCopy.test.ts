import { describe, expect, it } from 'vitest'
import { mapNativePickerOptions, nativeCopyProjection } from './nativeCopy'
import { NATIVE_COPY_SLOTS } from '../../../shared/native-copy-projection'

describe('native copy renderer boundary', () => {
  it('maps picker labels and preserves extensions and paths', () => {
    const source = {
      title: 'Choose a file',
      buttonLabel: 'Open file',
      defaultPath: 'C:\\work\\report.txt',
      filters: [{ name: 'Text files', extensions: ['txt', 'md'] }]
    }
    const mapped = mapNativePickerOptions(source, (value) => `mapped:${value}`)
    expect(mapped.title).toBe('mapped:Choose a file')
    expect(mapped.buttonLabel).toBe('mapped:Open file')
    expect(mapped.defaultPath).toBe(source.defaultPath)
    expect(mapped.filters).toEqual([{ name: 'mapped:Text files', extensions: ['txt', 'md'] }])
  })

  it('creates one neutral entry for every registered slot', () => {
    const projection = nativeCopyProjection(8, (value) => value)
    expect(projection.protocol).toBe(1)
    expect(projection.entries.map((entry) => entry.slot)).toEqual([...NATIVE_COPY_SLOTS])
    expect(new Set(projection.entries.map((entry) => entry.slot)).size).toBe(NATIVE_COPY_SLOTS.length)
  })

  it('maps only the shipped display name and preserves a user rename', () => {
    const mapped = nativeCopyProjection(8, (value) => `mapped:${value}`)
    expect(mapped.entries.find((entry) => entry.slot === 'app.displayName')?.segments[0]).toEqual({ kind: 'copy', value: 'mapped:nodeterm' })
    const renamed = nativeCopyProjection(8, (value) => `mapped:${value}`, { appDisplayName: 'My terminal room' })
    expect(renamed.entries.find((entry) => entry.slot === 'app.displayName')?.segments[0]).toEqual({ kind: 'copy', value: 'My terminal room' })
  })
})
