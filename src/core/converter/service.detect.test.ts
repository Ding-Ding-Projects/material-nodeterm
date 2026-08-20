import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sniffFormat } from './detect'
import { ConverterService } from './service'

describe('converter source detection', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'nt-converter-detect-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  it('keeps an HTML-prefixed Markdown document classified as Markdown', () => {
    const result = sniffFormat(
      Buffer.from('<div align="center">\r\n\r\n# Project\r\n\r\nProject details.\r\n', 'utf8'),
      'README.md'
    )

    expect(result).toMatchObject({
      kind: 'markdown',
      confidence: 'medium',
      note: 'Markdown extension'
    })
  })

  it('refuses a directory as a converter source', async () => {
    const sourceDirectory = join(root, 'source-directory')
    await mkdir(sourceDirectory, { recursive: true })
    const service = new ConverterService({ userDataDir: join(root, 'data') })

    await expect(service.detect(sourceDirectory)).rejects.toThrow(
      /unsupported converter input: expected a regular file, received directory/i
    )
  })
})
