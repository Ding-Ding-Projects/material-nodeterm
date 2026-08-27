import { createRequire } from 'node:module'
import sharp from 'sharp'
import { PDFDocument, degrees } from 'pdf-lib'
import { createWorker, OEM } from 'tesseract.js'
import * as unzipper from 'unzipper'
import { sanitizeZipPath } from '../../shared/export/zip'
import { packContainer } from '../project-archive-container'
import type { AdapterRunResult, ConverterAdapter } from './registry'

const MAX_IMAGE_PIXELS = 40_000_000
const MAX_PDF_PAGES = 500
const MAX_ARCHIVE_ENTRIES = 2_048
const MAX_ARCHIVE_EXPANDED_BYTES = 512 * 1024 * 1024
const MAX_ARCHIVE_ENTRY_NAME_BYTES = 4_096
const MAX_PIPELINE_OUTPUT_BYTES = 512 * 1024 * 1024

function nonEmpty(output: Buffer): string | null {
  if (output.length === 0) return 'Produced empty output'
  return output.length > MAX_PIPELINE_OUTPUT_BYTES
    ? `Produced output exceeds the ${MAX_PIPELINE_OUTPUT_BYTES.toLocaleString()}-byte processing limit.`
    : null
}

function boundedOutput(output: Buffer, label: string): Buffer {
  if (output.length > MAX_PIPELINE_OUTPUT_BYTES) {
    throw new Error(`${label} exceeds the ${MAX_PIPELINE_OUTPUT_BYTES.toLocaleString()}-byte processing limit.`)
  }
  return output
}

async function loadPdf(input: Buffer): Promise<PDFDocument> {
  const document = await PDFDocument.load(input, {
    ignoreEncryption: false,
    throwOnInvalidObject: true,
    updateMetadata: false
  })
  if (document.getPageCount() > MAX_PDF_PAGES) {
    throw new Error(`PDF has more than the ${MAX_PDF_PAGES}-page processing limit.`)
  }
  return document
}

async function validatePdf(output: Buffer): Promise<string | null> {
  try {
    await loadPdf(output)
    return null
  } catch (error) {
    return `Produced PDF failed to reopen: ${(error as Error).message}`
  }
}

function pdfDate(read: () => Date): string | null {
  try {
    return read().toISOString()
  } catch {
    return null
  }
}

export const pdfToManifestAdapter: ConverterAdapter = {
  async convert(input): Promise<AdapterRunResult> {
    const document = await loadPdf(input)
    const pages = document.getPages().map((page, index) => ({
      page: index + 1,
      width: page.getWidth(),
      height: page.getHeight(),
      rotation: page.getRotation().angle
    }))
    const manifest = {
      schemaVersion: 1,
      pageCount: pages.length,
      title: document.getTitle() ?? null,
      author: document.getAuthor() ?? null,
      subject: document.getSubject() ?? null,
      keywords: document.getKeywords() ?? null,
      creator: document.getCreator() ?? null,
      producer: document.getProducer() ?? null,
      creationDate: pdfDate(() => document.getCreationDate()),
      modificationDate: pdfDate(() => document.getModificationDate()),
      pages
    }
    return { output: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'), warnings: [] }
  },
  validate: nonEmpty
}

export const pdfToTextAdapter: ConverterAdapter = {
  async convert(input): Promise<AdapterRunResult> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({
      data: new Uint8Array(input),
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: false
    })
    const document = await task.promise
    try {
      if (document.numPages > MAX_PDF_PAGES) {
        throw new Error(`PDF has more than the ${MAX_PDF_PAGES}-page processing limit.`)
      }
      const pages: string[] = []
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber)
        const content = await page.getTextContent()
        const text = content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .replace(/[ \t]+/g, ' ')
          .trim()
        pages.push(`Page ${pageNumber}\n${text}`)
        page.cleanup()
      }
      return { output: boundedOutput(Buffer.from(`${pages.join('\n\n')}\n`, 'utf8'), 'Extracted PDF text'), warnings: [] }
    } finally {
      await document.destroy()
    }
  },
  validate: nonEmpty
}

export const pdfRotateClockwiseAdapter: ConverterAdapter = {
  async convert(input): Promise<AdapterRunResult> {
    const document = await loadPdf(input)
    for (const page of document.getPages()) page.setRotation(degrees((page.getRotation().angle + 90) % 360))
    const output = await document.save({ useObjectStreams: false, addDefaultPage: false })
    return { output: boundedOutput(Buffer.from(output), 'Rotated PDF'), warnings: [] }
  },
  validate: validatePdf
}

export const pdfRemoveMetadataAdapter: ConverterAdapter = {
  async convert(input): Promise<AdapterRunResult> {
    const document = await loadPdf(input)
    document.setTitle('')
    document.setAuthor('')
    document.setSubject('')
    document.setKeywords([])
    document.setCreator('')
    document.setProducer('')
    document.setCreationDate(new Date(0))
    document.setModificationDate(new Date(0))
    const output = await document.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false })
    return {
      output: boundedOutput(Buffer.from(output), 'Metadata-free PDF'),
      warnings: ['Document information fields were cleared. Embedded file content and visible page text were not redacted.']
    }
  },
  validate: validatePdf
}

async function copySelectedPages(input: Buffer, indices: number[]): Promise<Buffer> {
  const source = await loadPdf(input)
  const output = await PDFDocument.create()
  const pages = await output.copyPages(source, indices)
  pages.forEach((page) => output.addPage(page))
  return boundedOutput(Buffer.from(await output.save({ useObjectStreams: false, addDefaultPage: false })), 'PDF page selection')
}

export const pdfExtractFirstPageAdapter: ConverterAdapter = {
  async convert(input): Promise<AdapterRunResult> {
    const source = await loadPdf(input)
    if (source.getPageCount() === 0) throw new Error('PDF contains no pages to extract.')
    return { output: await copySelectedPages(input, [0]), warnings: [] }
  },
  validate: validatePdf
}

export const pdfReversePagesAdapter: ConverterAdapter = {
  async convert(input): Promise<AdapterRunResult> {
    const source = await loadPdf(input)
    const indices = Array.from({ length: source.getPageCount() }, (_, index) => source.getPageCount() - 1 - index)
    return { output: await copySelectedPages(input, indices), warnings: [] }
  },
  validate: validatePdf
}

export const pdfSplitPagesAdapter: ConverterAdapter = {
  async convert(input): Promise<AdapterRunResult> {
    const source = await loadPdf(input)
    const width = Math.max(4, String(source.getPageCount()).length)
    const entries = []
    for (let index = 0; index < source.getPageCount(); index++) {
      entries.push({
        path: `page-${String(index + 1).padStart(width, '0')}.pdf`,
        data: await copySelectedPages(input, [index])
      })
    }
    return { output: packContainer(entries), warnings: [] }
  },
  validate: nonEmpty
}

export const mergePdfsFromZipAdapter: ConverterAdapter = {
  async convert(input): Promise<AdapterRunResult> {
    const directory = await unzipper.Open.buffer(input)
    const candidates = directory.files
      .filter((entry) => entry.type === 'File' && entry.path.toLowerCase().endsWith('.pdf'))
      .sort((a, b) => a.path.localeCompare(b.path))
    if (candidates.length === 0) throw new Error('ZIP contains no PDF files to merge.')
    if (candidates.length > MAX_PDF_PAGES) throw new Error(`ZIP contains more than ${MAX_PDF_PAGES} PDF files.`)
    const output = await PDFDocument.create()
    let pageCount = 0
    let expandedBytes = 0
    for (const entry of candidates) {
      const path = entry.path.replace(/\\/g, '/')
      if (Buffer.byteLength(path, 'utf8') > MAX_ARCHIVE_ENTRY_NAME_BYTES) {
        throw new Error(`ZIP entry path exceeds the ${MAX_ARCHIVE_ENTRY_NAME_BYTES.toLocaleString()}-byte limit.`)
      }
      if (sanitizeZipPath(path) !== path) throw new Error(`ZIP contains an unsafe entry path: ${path}`)
      expandedBytes += Number(entry.vars.uncompressedSize)
      if (!Number.isSafeInteger(expandedBytes) || expandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) {
        throw new Error(`PDF inputs exceed the ${MAX_ARCHIVE_EXPANDED_BYTES.toLocaleString()}-byte expanded limit.`)
      }
      const source = await loadPdf(await entry.buffer())
      pageCount += source.getPageCount()
      if (pageCount > MAX_PDF_PAGES) throw new Error(`Merged PDF would exceed the ${MAX_PDF_PAGES}-page limit.`)
      const pages = await output.copyPages(source, source.getPageIndices())
      pages.forEach((page) => output.addPage(page))
    }
    return { output: boundedOutput(Buffer.from(await output.save({ useObjectStreams: false, addDefaultPage: false })), 'Merged PDF'), warnings: [] }
  },
  validate: validatePdf
}

export function imageAdapter(target: 'png' | 'jpeg' | 'webp'): ConverterAdapter {
  return {
    async convert(input): Promise<AdapterRunResult> {
      const pipeline = sharp(input, {
        animated: false,
        failOn: 'warning',
        limitInputPixels: MAX_IMAGE_PIXELS,
        pages: 1
      }).rotate()
      const metadata = await pipeline.metadata()
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
        throw new Error(`Image exceeds the ${MAX_IMAGE_PIXELS.toLocaleString()}-pixel processing limit.`)
      }
      const output = target === 'png'
        ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
        : target === 'jpeg'
          ? await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer()
          : await pipeline.webp({ quality: 90, alphaQuality: 100 }).toBuffer()
      return { output: boundedOutput(output, `Converted ${target.toUpperCase()} image`), warnings: [] }
    },
    async validate(output): Promise<string | null> {
      try {
        const metadata = await sharp(output, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata()
        return metadata.width && metadata.height ? null : 'Produced image has no readable dimensions.'
      } catch (error) {
        return `Produced image failed to reopen: ${(error as Error).message}`
      }
    }
  }
}

export const ocrEnglishAdapter: ConverterAdapter = {
  async convert(input): Promise<AdapterRunResult> {
    const require = createRequire(import.meta.url)
    const language = require('@tesseract.js-data/eng') as { langPath: string; gzip: boolean }
    const worker = await createWorker('eng', OEM.LSTM_ONLY, {
      langPath: language.langPath,
      gzip: language.gzip,
      logger: () => undefined
    })
    try {
      const result = await worker.recognize(input)
      const text = result.data.text.trim()
      if (!text) throw new Error('OCR completed but found no text in the image.')
      return {
        output: Buffer.from(`${text}\n`, 'utf8'),
        warnings: [`OCR confidence: ${Math.round(result.data.confidence)}%. Review the text before relying on it.`]
      }
    } finally {
      await worker.terminate()
    }
  },
  validate: nonEmpty
}

export const zipToManifestAdapter: ConverterAdapter = {
  async convert(input): Promise<AdapterRunResult> {
    const directory = await unzipper.Open.buffer(input)
    if (directory.files.length > MAX_ARCHIVE_ENTRIES) {
      throw new Error(`ZIP has more than the ${MAX_ARCHIVE_ENTRIES.toLocaleString()}-entry limit.`)
    }
    let total = 0
    const entries = directory.files.map((entry) => {
      const path = entry.path.replace(/\\/g, '/')
      if (Buffer.byteLength(path, 'utf8') > MAX_ARCHIVE_ENTRY_NAME_BYTES) {
        throw new Error(`ZIP entry path exceeds the ${MAX_ARCHIVE_ENTRY_NAME_BYTES.toLocaleString()}-byte limit.`)
      }
      if (sanitizeZipPath(path) !== path) throw new Error(`ZIP contains an unsafe entry path: ${path}`)
      const size = Number(entry.vars.uncompressedSize)
      if (!Number.isSafeInteger(size) || size < 0) throw new Error(`ZIP entry has an invalid size: ${path}`)
      total += size
      if (total > MAX_ARCHIVE_EXPANDED_BYTES) {
        throw new Error(`ZIP declares more than the ${MAX_ARCHIVE_EXPANDED_BYTES.toLocaleString()}-byte expanded limit.`)
      }
      return { path, type: entry.type, uncompressedBytes: size }
    })
    return {
      output: boundedOutput(
        Buffer.from(`${JSON.stringify({ schemaVersion: 1, entryCount: entries.length, totalUncompressedBytes: total, entries }, null, 2)}\n`, 'utf8'),
        'ZIP manifest'
      ),
      warnings: ['The archive was inspected only. No entry was extracted or executed.']
    }
  },
  validate: nonEmpty
}
