// Bundled Code/Text adapters: line-ending normalization, text-encoding re-encoding, and
// Markdown -> HTML (via the already-bundled `marked` package — the same one the renderer uses
// for its own markdown preview, run here in Node with no DOM involved).

import { marked } from 'marked'

export function textToCrlf(input: Buffer): Buffer {
  const text = input.toString('utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
  return Buffer.from(text, 'utf8')
}

export function textToLf(input: Buffer): Buffer {
  const text = input.toString('utf8').replace(/\r\n/g, '\n')
  return Buffer.from(text, 'utf8')
}

export function utf8ToUtf16le(input: Buffer): Buffer {
  return Buffer.from(input.toString('utf8'), 'utf16le')
}

export function utf16leToUtf8(input: Buffer): Buffer {
  return Buffer.from(input.toString('utf16le'), 'utf8')
}

export function utf8ToLatin1(input: Buffer): { output: Buffer; warnings: string[] } {
  const text = input.toString('utf8')
  let lossy = false
  for (const ch of text) {
    if (ch.codePointAt(0)! > 0xff) {
      lossy = true
      break
    }
  }
  return {
    output: Buffer.from(text, 'latin1'),
    warnings: lossy ? ['One or more characters outside Latin-1 were replaced.'] : []
  }
}

export function latin1ToUtf8(input: Buffer): Buffer {
  return Buffer.from(input.toString('latin1'), 'utf8')
}

export function markdownToHtml(input: Buffer): Buffer {
  const html = marked.parse(input.toString('utf8'), { async: false }) as string
  return Buffer.from(
    `<!doctype html>\n<html><head><meta charset="utf-8"></head><body>\n${html}\n</body></html>\n`,
    'utf8'
  )
}
