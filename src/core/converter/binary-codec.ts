// Bundled Binary Encodings + Archive-compression adapters. Everything here is a plain Node
// Buffer/zlib call — zero new dependencies, works fully offline, and is exact (no lossiness).

import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib'

export function anyToBase64(input: Buffer): Buffer {
  return Buffer.from(input.toString('base64'), 'utf8')
}

export function base64ToAny(input: Buffer): Buffer {
  const text = input.toString('utf8').trim().replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]*=?=?$/.test(text)) {
    throw new Error('Input is not valid Base64 text')
  }
  return Buffer.from(text, 'base64')
}

export function anyToHex(input: Buffer): Buffer {
  return Buffer.from(input.toString('hex'), 'utf8')
}

export function hexToAny(input: Buffer): Buffer {
  const text = input.toString('utf8').trim().replace(/\s+/g, '')
  if (!/^[0-9a-fA-F]*$/.test(text) || text.length % 2 !== 0) {
    throw new Error('Input is not valid hex text')
  }
  return Buffer.from(text, 'hex')
}

export function anyToGzip(input: Buffer): Buffer {
  return gzipSync(input)
}

export function gzipToAny(input: Buffer): Buffer {
  return gunzipSync(input)
}

export function anyToBrotli(input: Buffer): Buffer {
  return brotliCompressSync(input)
}

export function brotliToAny(input: Buffer): Buffer {
  return brotliDecompressSync(input)
}
