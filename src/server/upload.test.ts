import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Auth } from './auth'
import { createHttpHandler, SESSION_COOKIE } from './http'
import { writeWholeChunk } from './upload'
import { uploadsRoot } from '../core/uploads'
import { UPLOAD_HTTP_PATH, UPLOAD_MAX_BYTES } from '../shared/uploads'
import { WS_MAX_PAYLOAD } from './ws'

let dir: string
let rendererDir: string
let auth: Auth
let server: http.Server
let base: string

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-upload-http-'))
  rendererDir = path.join(dir, 'renderer')
  fs.mkdirSync(rendererDir)
  fs.writeFileSync(
    path.join(rendererDir, 'index.html'),
    `<meta http-equiv="Content-Security-Policy" content="default-src 'self';"><div id="root"></div>`
  )
  auth = new Auth(dir)
  server = http.createServer(
    createHttpHandler({ auth, rendererDir, uploadUserDataDir: dir })
  )
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  fs.rmSync(dir, { recursive: true, force: true })
})

async function login(): Promise<string> {
  const response = await fetch(`${base}/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `token=${auth.setupToken()}&password=hunter22-secret`,
    redirect: 'manual'
  })
  expect(response.status).toBe(303)
  const cookie = response.headers.get('set-cookie') || ''
  expect(cookie).toContain(`${SESSION_COOKIE}=`)
  return cookie.split(';', 1)[0]!
}

function overLimitRequest(cookie: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${base}${UPLOAD_HTTP_PATH}?name=too-large.bin`,
      {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/octet-stream',
          // The route must refuse from this header before it creates a staging directory. Only one
          // byte is sent below: the test stays small while exercising the production 64 MiB bound.
          'content-length': String(UPLOAD_MAX_BYTES + 1)
        }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () =>
          resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') })
        )
      }
    )
    req.on('error', reject)
    req.end(Buffer.from([1]))
  })
}

async function exactLimitRequest(cookie: string): Promise<{ status: number; body: string }> {
  let req!: http.ClientRequest
  const response = new Promise<{ status: number; body: string }>((resolve, reject) => {
    req = http.request(
      `${base}${UPLOAD_HTTP_PATH}?name=exact-limit.bin`,
      {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/octet-stream',
          'content-length': String(UPLOAD_MAX_BYTES)
        }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () =>
          resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') })
        )
      }
    )
    req.once('error', reject)
  })

  try {
    // Reuse one client buffer so the test covers both Content-Length and streamed-byte comparisons
    // without allocating a second 64 MiB payload in the test process.
    const mebibyte = Buffer.alloc(1024 * 1024, 0x6d)
    for (let i = 0; i < 64; i++) await writeRequestChunk(req, mebibyte)
    await new Promise<void>((resolve) => req.end(resolve))
    return await response
  } catch (error) {
    req.destroy()
    throw error
  }
}

async function writeRequestChunk(req: http.ClientRequest, chunk: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    req.write(chunk, (error) => (error ? reject(error) : resolve()))
  })
}

async function chunkedOverLimitRequest(
  cookie: string,
  agent: http.Agent
): Promise<{ status: number; body: string; socket: object }> {
  let responseStarted!: () => void
  const started = new Promise<void>((resolve) => {
    responseStarted = resolve
  })
  let requestSocket: object | undefined
  let req!: http.ClientRequest

  const response = new Promise<{ status: number; body: string }>((resolve, reject) => {
    req = http.request(
      `${base}${UPLOAD_HTTP_PATH}?name=chunked-too-large.bin`,
      {
        agent,
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/octet-stream',
          // Deliberately no Content-Length: node:http uses chunked transfer encoding, so only the
          // streaming counter can stop this request.
          'transfer-encoding': 'chunked'
        }
      },
      (res) => {
        responseStarted()
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () =>
          resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') })
        )
      }
    )
    req.once('socket', (socket) => {
      requestSocket = socket
    })
    req.once('error', reject)
  })

  const writer = (async () => {
    // Stop exactly on the accepted boundary, cross it by one byte, then wait until the server has
    // sent its final response before finishing the request. That leaves a genuinely slow tail for
    // the receiver to drain. Returning from Readable's default async iterator destroys the socket
    // here; a sender that had already queued all 65 MiB cannot discriminate that regression.
    const mebibyte = Buffer.alloc(1024 * 1024, 0xa5)
    for (let i = 0; i < 64; i++) await writeRequestChunk(req, mebibyte)
    await writeRequestChunk(req, Buffer.from([0xa5]))
    await started
    for (let i = 0; i < 4; i++) {
      await writeRequestChunk(req, Buffer.alloc(16 * 1024, i))
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    await new Promise<void>((resolve) => req.end(resolve))
  })()

  const [result] = await Promise.all([response, writer])
  if (!requestSocket) throw new Error('upload request did not acquire a socket')
  return { ...result, socket: requestSocket }
}

function authenticatedGet(
  cookie: string,
  agent: http.Agent
): Promise<{ status: number; socket: object }> {
  return new Promise((resolve, reject) => {
    let requestSocket: object | undefined
    const req = http.get(base, { agent, headers: { cookie } }, (res) => {
      res.resume()
      res.on('end', () => {
        if (!requestSocket) reject(new Error('follow-up request did not acquire a socket'))
        else resolve({ status: res.statusCode || 0, socket: requestSocket })
      })
    })
    req.once('socket', (socket) => {
      requestSocket = socket
    })
    req.once('error', reject)
  })
}

async function waitForEmptyUploadRoot(): Promise<void> {
  const root = uploadsRoot(dir)
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(root) && fs.readdirSync(root).length === 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect(fs.readdirSync(root)).toEqual([])
}

describe('authenticated HTTP uploads', () => {
  it('keeps the RPC WebSocket receiver ceiling at exactly 8 MiB', () => {
    expect(WS_MAX_PAYLOAD).toBe(8 * 1024 * 1024)
  })

  it('retries a short file-handle write until every byte in the chunk is stored', async () => {
    const stored: Buffer[] = []
    const writer = {
      write: async (chunk: Buffer, offset: number, length: number) => {
        const bytesWritten = Math.min(3, length)
        stored.push(Buffer.from(chunk.subarray(offset, offset + bytesWritten)))
        return { bytesWritten, buffer: chunk }
      }
    }
    const source = Buffer.from('partial writes are legal')
    await writeWholeChunk(writer as never, source)
    expect(stored.length).toBeGreaterThan(1)
    expect(Buffer.concat(stored)).toEqual(source)
  })

  it('rejects an unauthenticated write before creating the upload root', async () => {
    const response = await fetch(`${base}${UPLOAD_HTTP_PATH}?name=secret.bin`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array([1, 2, 3])
    })
    expect(response.status).toBe(401)
    expect(fs.existsSync(uploadsRoot(dir))).toBe(false)
  })

  it('rejects a cross-host browser origin while accepting the authenticated same-host origin', async () => {
    const cookie = await login()
    const rejected = await fetch(`${base}${UPLOAD_HTTP_PATH}?name=cross-site.bin`, {
      method: 'POST',
      headers: {
        cookie,
        origin: 'https://attacker.example',
        'content-type': 'application/octet-stream'
      },
      body: new Uint8Array([1, 2, 3])
    })
    expect(rejected.status).toBe(403)
    expect(await rejected.json()).toMatchObject({ error: 'origin_forbidden' })
    expect(fs.existsSync(uploadsRoot(dir))).toBe(false)

    const accepted = await fetch(`${base}${UPLOAD_HTTP_PATH}?name=same-site.bin`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/octet-stream' },
      body: new Uint8Array([4, 5, 6])
    })
    expect(accepted.status).toBe(201)
  })

  it('authenticates and persists an exact 7 MiB body byte-for-byte outside the WebSocket', async () => {
    const cookie = await login()
    const body = Buffer.alloc(7 * 1024 * 1024)
    // A repeated one-byte fixture cannot expose missing/reordered ranges. This deterministic
    // pattern changes across every adjacent byte and its full hash pins the published content.
    for (let i = 0; i < body.length; i++) body[i] = (i * 131 + Math.floor(i / 251)) & 0xff
    const expectedHash = crypto.createHash('sha256').update(body).digest('hex')

    const response = await fetch(
      `${base}${UPLOAD_HTTP_PATH}?name=${encodeURIComponent('../seven mebibytes.bin')}`,
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/octet-stream' },
        body
      }
    )
    expect(response.status).toBe(201)
    const result = (await response.json()) as { path: string }
    expect(path.basename(result.path)).toBe('seven mebibytes.bin')
    expect(path.resolve(result.path).startsWith(path.resolve(uploadsRoot(dir)) + path.sep)).toBe(true)
    const published = fs.readFileSync(result.path)
    expect(published).toHaveLength(body.length)
    expect(crypto.createHash('sha256').update(published).digest('hex')).toBe(expectedHash)
    expect(fs.readdirSync(path.dirname(result.path))).toEqual(['seven mebibytes.bin'])
  })

  it(
    'accepts exactly 64 MiB through both the declared-length and streaming bounds',
    async () => {
      const cookie = await login()
      const response = await exactLimitRequest(cookie)
      expect(response.status).toBe(201)
      const result = JSON.parse(response.body) as { path: string }
      expect(path.resolve(result.path).startsWith(path.resolve(uploadsRoot(dir)) + path.sep)).toBe(true)
      expect(fs.statSync(result.path).size).toBe(UPLOAD_MAX_BYTES)
      expect(fs.readdirSync(path.dirname(result.path))).toEqual(['exact-limit.bin'])
    },
    20_000
  )

  it('returns 413 above the shared 64 MiB bound before creating a durable artifact', async () => {
    const cookie = await login()
    const response = await overLimitRequest(cookie)
    expect(response.status).toBe(413)
    expect(JSON.parse(response.body)).toMatchObject({
      error: 'too_large',
      maxBytes: UPLOAD_MAX_BYTES
    })
    expect(fs.existsSync(uploadsRoot(dir))).toBe(false)
  })

  it(
    'returns 413 to a slow chunked sender, drains it, reuses the socket, and removes artifacts',
    async () => {
      const cookie = await login()
      const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })
      try {
        const response = await chunkedOverLimitRequest(cookie, agent)
        expect(response.status).toBe(413)
        expect(JSON.parse(response.body)).toMatchObject({
          error: 'too_large',
          message: 'File exceeds the 64 MiB upload limit.',
          maxBytes: UPLOAD_MAX_BYTES
        })
        const followUp = await authenticatedGet(cookie, agent)
        expect(followUp.status).toBe(200)
        expect(followUp.socket).toBe(response.socket)
        await waitForEmptyUploadRoot()
      } finally {
        agent.destroy()
      }
    },
    20_000
  )
})
