/** Encode raw bytes as base64 in the browser (no Node `Buffer`). Builds the binary string in
 *  chunks — `String.fromCharCode.apply`/spread has an argument-count ceiling (~64k) on some
 *  engines, so spreading a whole large file's bytes at once can throw. Same technique as
 *  `encodePcmForWire` (speech-encode.ts). */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
