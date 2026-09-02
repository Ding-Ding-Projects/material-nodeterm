import { describe, expect, it } from 'vitest'
import { pickerLabels } from './native-picker-options'

describe('pickerLabels', () => {
  it('passes a real title and button label through', () => {
    expect(pickerLabels({ title: 'Choose media files', buttonLabel: 'Pack these' })).toEqual({
      title: 'Choose media files',
      buttonLabel: 'Pack these'
    })
  })

  it('omits every field when nothing usable is supplied', () => {
    // The bare default dialog is the safe degrade — never a half-built options object.
    expect(pickerLabels()).toEqual({})
    expect(pickerLabels(null)).toEqual({})
    expect(pickerLabels('a string')).toEqual({})
    expect(pickerLabels({ title: '   ', buttonLabel: 42, filters: 'nope' })).toEqual({})
  })

  it('drops a malformed filter rather than handing it to the OS', () => {
    expect(
      pickerLabels({
        filters: [
          { name: 'project', extensions: ['nodeterm-project'] },
          { name: 'bad', extensions: [7] },
          { extensions: ['x'] },
          'nonsense'
        ]
      })
    ).toEqual({ filters: [{ name: 'project', extensions: ['nodeterm-project'] }] })
  })

  it('bounds the caption text and the filter list', () => {
    const out = pickerLabels({
      title: 'T'.repeat(400),
      filters: Array.from({ length: 40 }, () => ({ name: 'n'.repeat(200), extensions: ['a'] }))
    })
    expect(out.title).toHaveLength(200)
    expect(out.filters).toHaveLength(20)
    expect(out.filters?.[0]?.name).toHaveLength(100)
  })
})
