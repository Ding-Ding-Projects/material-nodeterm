// Persist a `BuiltExport` (or raw archive bytes) to the user's machine. Runs entirely in the
// renderer — a Blob + a synthetic `<a download>` click is a real browser download on BOTH builds:
// Desktop's renderer is Chromium exactly as the Server Edition's browser tab is, so this needs no
// IPC round trip and works identically whether nodeterm is running as the Electron app or served
// from `nodeterm-server` to a browser. See docs/exports.md ("How a save actually happens").

import type { BuiltExport } from '@shared/export'

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  // Not attached to the DOM on purpose — Chromium honours `click()` on a detached anchor, and
  // skipping the attach/detach avoids a visible layout flash for something the user never sees.
  a.click()
  // Revoke on a delay: revoking synchronously has raced the download start in some builds.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function saveBuiltExport(built: BuiltExport): void {
  triggerDownload(new Blob([built.content], { type: `${built.mimeType};charset=utf-8` }), built.filename)
}

export function saveArchive(archive: { filename: string; mimeType: string; bytes: Uint8Array }): void {
  triggerDownload(new Blob([archive.bytes], { type: archive.mimeType }), archive.filename)
}
