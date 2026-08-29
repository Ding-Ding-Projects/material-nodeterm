/** Extensions treated as Markdown for the automatic opening decision. */
const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdown', 'mkd'])

export function isMarkdownExt(ext: string): boolean {
  return MARKDOWN_EXTS.has(ext.toLowerCase())
}

/** True when a newly loaded editor should begin in rendered preview. */
export function opensInPreview(ext: string, openMarkdownPreview: boolean): boolean {
  return openMarkdownPreview && isMarkdownExt(ext)
}
