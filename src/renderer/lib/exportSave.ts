// Persist a `BuiltExport` (or raw archive bytes) to the user's machine. Runs entirely in the
// renderer — a Blob + a synthetic `<a download>` click is a real browser download on BOTH builds:
// Desktop's renderer is Chromium exactly as the Server Edition's browser tab is, so this needs no
// IPC round trip and works identically whether nodeterm is running as the Electron app or served
// from `nodeterm-server` to a browser. See docs/exports.md ("How a save actually happens").

import type { BuiltExport } from '@shared/export'

export const DOWNLOAD_URL_REVOKE_DELAY_MS = 30_000

/** Browser/Electron-renderer download primitive shared by every Blob export. The object URL must
 *  remain alive long enough for Chromium to consume the synthetic click; synchronous revocation
 *  intermittently cancels the save before it starts. */
export function saveBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  // Not attached to the DOM on purpose — Chromium honours `click()` on a detached anchor, and
  // skipping the attach/detach avoids a visible layout flash for something the user never sees.
  a.click()
  // Revoke on a delay: revoking synchronously has raced the download start in some builds.
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_REVOKE_DELAY_MS)
}

export function saveBuiltExport(built: BuiltExport): void {
  saveBlobDownload(new Blob([built.content], { type: `${built.mimeType};charset=utf-8` }), built.filename)
}

export function saveArchive(archive: { filename: string; mimeType: string; bytes: Uint8Array }): void {
  // Copy out the view's own range rather than handing the Uint8Array straight to Blob. A
  // `Uint8Array` can be a window onto a larger (or shared) buffer, so passing it risks writing
  // the WHOLE backing buffer into the download — and `SharedArrayBuffer` is not a valid BlobPart
  // at all, which is what the compiler is objecting to. `slice()` yields a right-sized copy.
  const bytes = archive.bytes.slice()
  saveBlobDownload(
    new Blob([bytes.buffer as ArrayBuffer], { type: archive.mimeType }),
    archive.filename
  )
}
