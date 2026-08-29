import { describe, expect, it } from 'vitest'
import { isMarkdownExt, opensInPreview } from './markdownPreview'

describe('Markdown automatic preview', () => {
  it('accepts the supported extensions case-insensitively', () => {
    for (const ext of ['md', 'markdown', 'mdown', 'mkd', 'MD']) expect(isMarkdownExt(ext)).toBe(true)
  })

  it('rejects other extensions and respects the setting', () => {
    for (const ext of ['', 'txt', 'ts', 'mdx', 'json']) expect(isMarkdownExt(ext)).toBe(false)
    expect(opensInPreview('md', true)).toBe(true)
    expect(opensInPreview('md', false)).toBe(false)
    expect(opensInPreview('ts', true)).toBe(false)
  })
})
