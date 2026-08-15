// Authenticated, bounded browser -> Server Edition upload.
//
// File bytes must not ride the RPC WebSocket: base64 expands a 7 MiB file past the socket's 8 MiB
// receiver ceiling and disconnects every feature multiplexed over that connection. This route
// streams raw bytes to a private temp file, enforces the core upload limit both from Content-Length
// and while reading, then atomically publishes the completed file. It sits behind http.ts's normal
// session/proxy-auth gate; a filename is only a label and is reduced with safeUploadName before it
// ever participates in a path.

import crypto from 'node:crypto'
import type http from 'node:http'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { renameAtomic } from '../core/fs-atomic'
import {
  safeUploadName,
  sweepUploads,
  tightenUploadPermissions,
  uploadsRoot
} from '../core/uploads'
import {
  UPLOAD_HTTP_PATH,
  UPLOAD_MAX_BYTES,
  UPLOAD_TOO_LARGE_MESSAGE,
  type UploadHttpError,
  type UploadHttpSuccess
} from '../shared/uploads'

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: UploadHttpSuccess | UploadHttpError,
  extra: http.OutgoingHttpHeaders = {}
): void {
  const encoded = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(encoded),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra
  })
  res.end(encoded)
}

function parsedContentLength(req: http.IncomingMessage): number | null | 'invalid' {
  const raw = req.headers['content-length']
  if (raw === undefined) return null
  if (Array.isArray(raw) || !/^\d+$/.test(raw)) return 'invalid'
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : 'invalid'
}

/** Match the WebSocket's cross-site request defense. Native clients omit Origin and still need
 * authentication; browsers that send one may write only when it names this HTTP Host. Compare
 * hosts rather than schemes because TLS is commonly terminated by the trusted reverse proxy. */
function uploadOriginAllowed(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined || origin === '') return true
  if (typeof origin !== 'string') return false
  try {
    return new URL(origin).host.toLowerCase() === String(req.headers.host || '').toLowerCase()
  } catch {
    return false
  }
}

export async function writeWholeChunk(handle: fs.FileHandle, chunk: Buffer): Promise<void> {
  let offset = 0
  while (offset < chunk.length) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, null)
    // A successful zero-byte write would otherwise spin forever and publish a truncated file.
    if (bytesWritten <= 0) throw new Error('upload write made no progress')
    offset += bytesWritten
  }
}

/**
 * Serve one upload. Returns false for every other path so http.ts can continue routing.
 *
 * Content-Length is an early refusal only, never the authority: chunked requests and dishonest
 * lengths are bounded again as their bytes arrive. A partial upload is removed, and the target
 * name is not published until every byte has landed and the file handle has closed.
 */
export async function handleUpload(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  userDataDir: string
): Promise<boolean> {
  if (url.pathname !== UPLOAD_HTTP_PATH) return false

  if (!uploadOriginAllowed(req)) {
    sendJson(res, 403, {
      error: 'origin_forbidden',
      message: 'The upload origin does not match this server.'
    })
    req.resume()
    return true
  }

  if ((req.method || 'GET') !== 'POST') {
    sendJson(
      res,
      405,
      { error: 'method_not_allowed', message: 'Uploads require POST.' },
      { Allow: 'POST' }
    )
    return true
  }

  const contentType = String(req.headers['content-type'] || '')
    .split(';', 1)[0]!
    .trim()
    .toLowerCase()
  if (contentType !== 'application/octet-stream') {
    sendJson(res, 415, {
      error: 'unsupported_media_type',
      message: 'Uploads must use application/octet-stream.'
    })
    req.resume()
    return true
  }

  const declared = parsedContentLength(req)
  if (declared === 'invalid') {
    sendJson(res, 400, { error: 'bad_length', message: 'Invalid Content-Length.' })
    req.resume()
    return true
  }
  if (declared !== null && declared > UPLOAD_MAX_BYTES) {
    sendJson(res, 413, {
      error: 'too_large',
      message: UPLOAD_TOO_LARGE_MESSAGE,
      maxBytes: UPLOAD_MAX_BYTES
    })
    req.resume()
    return true
  }
  if (declared === 0) {
    sendJson(res, 400, { error: 'empty', message: 'The selected file is empty.' })
    req.resume()
    return true
  }

  const requestedName = url.searchParams.get('name') || ''
  const root = uploadsRoot(userDataDir)
  const dir = join(root, crypto.randomUUID())
  const target = join(dir, safeUploadName(requestedName))
  // The target name can already sit at a filesystem's component limit, so keep the temp as its own
  // short component instead of appending a suffix to the user-facing name. The random directory,
  // pid and UUID make it unique across both concurrent requests and server processes.
  const temp = join(dir, `.incoming-${process.pid}-${crypto.randomUUID()}.tmp`)
  let handle: fs.FileHandle | null = null
  let published = false
  let received = 0
  let refusedTooLarge = false

  try {
    await fs.mkdir(root, { recursive: true, mode: 0o700 })
    await tightenUploadPermissions(root)
    await fs.mkdir(dir, { recursive: false, mode: 0o700 })
    void sweepUploads(root)
    handle = await fs.open(temp, 'wx', 0o600)

    // The default Readable async iterator DESTROYS its stream when a loop exits early. The
    // over-limit branch sends its useful 413 immediately, then stays in this loop and discards the
    // tail until natural EOF. Returning early resets a slow sender and prevents keep-alive reuse;
    // merely calling req.resume() before that return is not enough to preserve the HTTP boundary.
    for await (const raw of req.iterator({ destroyOnReturn: false })) {
      if (refusedTooLarge) continue
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
      received += chunk.length
      if (received > UPLOAD_MAX_BYTES) {
        sendJson(res, 413, {
          error: 'too_large',
          message: UPLOAD_TOO_LARGE_MESSAGE,
          maxBytes: UPLOAD_MAX_BYTES
        })
        // Keep iterating without retaining or writing another byte. The response can travel while
        // the sender finishes, and reaching natural EOF leaves the socket reusable.
        refusedTooLarge = true
      }
      if (!refusedTooLarge) {
        // FileHandle.write is allowed to write fewer bytes than requested. Do not publish until the
        // entire chunk is durable in the temp file; the 7 MiB byte-for-byte test guards this loop.
        await writeWholeChunk(handle, chunk)
      }
    }

    if (refusedTooLarge) return true

    if (received === 0) {
      sendJson(res, 400, { error: 'empty', message: 'The selected file is empty.' })
      return true
    }

    await handle.close()
    handle = null
    await renameAtomic(temp, target)
    published = true
    sendJson(res, 201, { path: target })
    return true
  } catch {
    if (!res.headersSent) {
      sendJson(res, 500, {
        error: 'write_failed',
        message: 'The server could not store the uploaded file.'
      })
    } else if (!res.writableEnded) {
      res.end()
    }
    return true
  } finally {
    if (handle) await handle.close().catch(() => {})
    if (!published) {
      await fs.rm(temp, { force: true }).catch(() => {})
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }
}
