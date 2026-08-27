// Adapter registry: maps every `bundled: true` id in CONVERTER_CATALOG (src/shared/converter.ts)
// to a real, offline, dependency-free implementation. A catalog id with no entry here is a bug
// (asserted by `assertRegistryMatchesCatalog`, called once at boot from register-ipc.ts) — the
// catalog and the registry must never drift, or the UI would offer a conversion the engine can't run.

import { CONVERTER_CATALOG, type ConverterKind } from '../../shared/converter'
import {
  anyToBase64,
  anyToBrotli,
  anyToGzip,
  anyToHex,
  base64ToAny,
  brotliToAny,
  gzipToAny,
  hexToAny
} from './binary-codec'
import {
  parseCsv,
  parseJson,
  parseToml,
  parseTsv,
  parseXml,
  parseYaml,
  serializeCsv,
  serializeJson,
  serializeToml,
  serializeTsv,
  serializeXml,
  serializeYaml,
  StructuredCodecError,
  type StructuredValue
} from './structured-codec'
import {
  latin1ToUtf8,
  markdownToHtml,
  textToCrlf,
  textToLf,
  utf16leToUtf8,
  utf8ToLatin1,
  utf8ToUtf16le
} from './text-codec'
import {
  imageAdapter,
  mergePdfsFromZipAdapter,
  ocrEnglishAdapter,
  pdfExtractFirstPageAdapter,
  pdfRemoveMetadataAdapter,
  pdfReversePagesAdapter,
  pdfRotateClockwiseAdapter,
  pdfSplitPagesAdapter,
  pdfToManifestAdapter,
  pdfToTextAdapter,
  zipToManifestAdapter
} from './advanced-pipeline'

export interface AdapterRunResult {
  output: Buffer
  warnings: string[]
}

export interface ConverterAdapter {
  /** Run the conversion. Throws on malformed/unsupported input — the caller (service.ts) catches
   *  this and reports the item `failed` with the exact message; the source file is never touched. */
  convert(input: Buffer): AdapterRunResult | Promise<AdapterRunResult>
  /** Validate the produced bytes before they are written to disk. Returns an error message when
   *  invalid, or null when the output is accepted. */
  validate(output: Buffer): string | null | Promise<string | null>
}

const structuredCodecs: Record<
  string,
  { parse: (t: string) => StructuredValue; serialize: (v: StructuredValue) => string }
> = {
  json: { parse: parseJson, serialize: serializeJson },
  yaml: { parse: parseYaml, serialize: serializeYaml },
  toml: { parse: parseToml, serialize: serializeToml },
  xml: { parse: parseXml, serialize: serializeXml },
  csv: { parse: parseCsv, serialize: serializeCsv },
  tsv: { parse: parseTsv, serialize: serializeTsv }
}

function structuredAdapter(from: string, to: string): ConverterAdapter {
  const src = structuredCodecs[from]
  const dst = structuredCodecs[to]
  return {
    convert(input: Buffer): AdapterRunResult {
      let value: StructuredValue
      try {
        value = src.parse(input.toString('utf8'))
      } catch (e) {
        throw new Error(`Could not read source as ${from.toUpperCase()}: ${(e as Error).message}`)
      }
      let text: string
      try {
        text = dst.serialize(value)
      } catch (e) {
        const msg = e instanceof StructuredCodecError ? e.message : (e as Error).message
        throw new Error(`Could not write as ${to.toUpperCase()}: ${msg}`)
      }
      return { output: Buffer.from(text, 'utf8'), warnings: [] }
    },
    validate(output: Buffer): string | null {
      try {
        dst.parse(output.toString('utf8'))
        return null
      } catch (e) {
        return `Produced ${to.toUpperCase()} failed to round-trip: ${(e as Error).message}`
      }
    }
  }
}

function simple(
  fn: (input: Buffer) => Buffer,
  validate: (output: Buffer) => string | null = () => null
): ConverterAdapter {
  return { convert: (input) => ({ output: fn(input), warnings: [] }), validate }
}

function withWarnings(
  fn: (input: Buffer) => { output: Buffer; warnings: string[] },
  validate: (output: Buffer) => string | null = () => null
): ConverterAdapter {
  return { convert: fn, validate }
}

function nonEmpty(output: Buffer): string | null {
  return output.length === 0 ? 'Produced empty output' : null
}

const REGISTRY: Record<string, ConverterAdapter> = {}

function canonicalStructured(value: StructuredValue): StructuredValue {
  if (Array.isArray(value)) return value.map(canonicalStructured)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalStructured(value[key])])
    )
  }
  return value
}

// Structured-data mesh — generated from the same STRUCTURED_KINDS pairing as the catalog.
const STRUCTURED_IDS = Object.keys(structuredCodecs)
for (const from of STRUCTURED_IDS) {
  for (const to of STRUCTURED_IDS) {
    if (from === to) continue
    REGISTRY[`${from}-to-${to}`] = structuredAdapter(from, to)
  }
}

// Code/Text
REGISTRY['text-to-crlf'] = simple(textToCrlf, nonEmpty)
REGISTRY['text-to-lf'] = simple(textToLf, nonEmpty)
REGISTRY['utf8-to-utf16le'] = simple(utf8ToUtf16le, nonEmpty)
REGISTRY['utf16le-to-utf8'] = simple(utf16leToUtf8)
REGISTRY['utf8-to-latin1'] = withWarnings((input) => {
  const { output, warnings } = utf8ToLatin1(input)
  return { output, warnings }
})
REGISTRY['latin1-to-utf8'] = simple(latin1ToUtf8)
REGISTRY['markdown-to-html'] = simple(markdownToHtml, (out) =>
  out.toString('utf8').includes('<html') ? null : 'Produced output does not look like HTML'
)

// Binary encodings
REGISTRY['any-to-base64'] = simple(anyToBase64, nonEmpty)
REGISTRY['base64-to-any'] = simple(base64ToAny)
REGISTRY['any-to-hex'] = simple(anyToHex, nonEmpty)
REGISTRY['hex-to-any'] = simple(hexToAny)

// Archive compression
REGISTRY['any-to-gzip'] = simple(anyToGzip, (out) => {
  try {
    gzipToAny(out)
    return null
  } catch (e) {
    return `Produced .gz failed to decompress: ${(e as Error).message}`
  }
})
REGISTRY['gzip-to-any'] = simple(gzipToAny)
REGISTRY['any-to-brotli'] = simple(anyToBrotli, (out) => {
  try {
    brotliToAny(out)
    return null
  } catch (e) {
    return `Produced .br failed to decompress: ${(e as Error).message}`
  }
})
REGISTRY['brotli-to-any'] = simple(brotliToAny)

// Advanced, fully local pipelines. Each one carries explicit byte/page/pixel/entry ceilings in
// the implementation and a matching safe portable intent in the shared catalog.
REGISTRY['pdf-to-text'] = pdfToTextAdapter
REGISTRY['pdf-to-manifest'] = pdfToManifestAdapter
REGISTRY['pdf-rotate-clockwise'] = pdfRotateClockwiseAdapter
REGISTRY['pdf-remove-metadata'] = pdfRemoveMetadataAdapter
REGISTRY['pdf-split-pages'] = pdfSplitPagesAdapter
REGISTRY['pdf-extract-first-page'] = pdfExtractFirstPageAdapter
REGISTRY['pdf-reverse-pages'] = pdfReversePagesAdapter
REGISTRY['zip-pdfs-to-pdf'] = mergePdfsFromZipAdapter
REGISTRY['zip-to-manifest'] = zipToManifestAdapter
for (const id of ['png-to-jpeg', 'heic-to-jpeg']) {
  if (CONVERTER_CATALOG.find((row) => row.id === id)?.available) REGISTRY[id] = imageAdapter('jpeg')
}
REGISTRY['json-canonicalize'] = {
  convert(input) {
    const value = parseJson(input.toString('utf8'))
    return { output: Buffer.from(serializeJson(canonicalStructured(value)), 'utf8'), warnings: [] }
  },
  validate(output) {
    try {
      parseJson(output.toString('utf8'))
      return null
    } catch (error) {
      return `Produced canonical JSON failed to reopen: ${(error as Error).message}`
    }
  }
}
for (const id of ['jpeg-to-png', 'webp-to-png', 'svg-to-png', 'gif-to-png', 'bmp-to-png', 'ico-to-png']) {
  if (CONVERTER_CATALOG.find((row) => row.id === id)?.available) REGISTRY[id] = imageAdapter('png')
}
REGISTRY['png-to-webp'] = imageAdapter('webp')
for (const kind of ['png', 'jpeg', 'webp', 'bmp']) REGISTRY[`${kind}-ocr-to-text`] = ocrEnglishAdapter

export function getAdapter(id: string): ConverterAdapter | undefined {
  return REGISTRY[id]
}

/** Every `bundled: true` catalog row must have a registry entry, and vice versa — called once at
 *  boot (register-ipc.ts) so a drift between the two fails loudly in dev rather than shipping a
 *  catalog button that throws "not implemented" the first time someone clicks it. */
export function assertRegistryMatchesCatalog(): void {
  const bundledIds = new Set(CONVERTER_CATALOG.filter((a) => a.bundled).map((a) => a.id))
  const registryIds = new Set(Object.keys(REGISTRY))
  const missing = [...bundledIds].filter((id) => !registryIds.has(id))
  const extra = [...registryIds].filter((id) => !bundledIds.has(id))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Converter catalog/registry drift — missing: [${missing.join(', ')}], extra: [${extra.join(', ')}]`
    )
  }
}

export type { ConverterKind }
