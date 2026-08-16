import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import http from 'http'
import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'
import { Auth, MAX_CHALLENGES_GLOBAL } from './auth'
import {
  createHttpHandler,
  authClientKey,
  sessionTokenFromCookie,
  negotiateEncoding,
  _resetStaticCacheForTest,
  SESSION_COOKIE
} from './http'
import { parseTrustedNets } from './proxy-trust'
import { DIM_SUM_NAMES } from '../shared/dimsum-names'
import type { DimSumChallenge } from '../core/unlock-ladder'

let dir: string, rendererDir: string, server: http.Server, base: string, auth: Auth

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-http-'))
  rendererDir = path.join(dir, 'renderer')
  fs.mkdirSync(rendererDir)
  fs.writeFileSync(
    path.join(rendererDir, 'index.html'),
    `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'" /><div id="root"></div>`
  )
  fs.writeFileSync(path.join(rendererDir, 'app.js'), 'console.log(1)')
  auth = new Auth(dir)
  server = http.createServer(createHttpHandler({ auth, rendererDir }))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterEach(async () => {
  await new Promise((r) => server.close(r))
  fs.rmSync(dir, { recursive: true, force: true })
})

async function setupAndLogin(): Promise<string> {
  const tok = auth.setupToken()
  const res = await fetch(`${base}/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `token=${tok}&password=hunter22-secret`,
    redirect: 'manual'
  })
  expect(res.status).toBe(303)
  const cookie = res.headers.get('set-cookie')!
  expect(cookie).toContain(`${SESSION_COOKIE}=`)
  expect(cookie).toContain('HttpOnly')
  expect(cookie).toContain('SameSite=Strict')
  return cookie.split(';')[0]
}

describe('http layer', () => {
  it('unauthenticated: html → /login redirect, api → 401; /login redirects to /setup when unconfigured', async () => {
    const r1 = await fetch(`${base}/`, { headers: { accept: 'text/html' }, redirect: 'manual' })
    expect(r1.status).toBe(302)
    const r2 = await fetch(`${base}/anything.json`, { redirect: 'manual' })
    expect(r2.status).toBe(401)
    const r3 = await fetch(`${base}/login`, { redirect: 'manual' })
    expect(r3.status).toBe(302)
    expect(r3.headers.get('location')).toContain('/setup')
  })

  it('setup with the one-time token creates the password and a session; token single-use', async () => {
    const cookie = await setupAndLogin()
    const home = await fetch(`${base}/`, { headers: { cookie } })
    expect(home.status).toBe(200)
    const again = await fetch(`${base}/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `token=whatever&password=xxxxxxxxx`,
      redirect: 'manual'
    })
    expect(again.status).toBe(403)
  })

  it('login: wrong password → redirect with error; right → cookie; rate limit → 429', async () => {
    await setupAndLogin()
    for (let i = 0; i < 5; i++) {
      const bad = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'password=wrong',
        redirect: 'manual'
      })
      expect([303, 429]).toContain(bad.status)
    }
    const locked = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=hunter22-secret',
      redirect: 'manual'
    })
    expect(locked.status).toBe(429)
  })

  it('orders already-arrived slow password requests before each expensive proof', async () => {
    let calls = 0
    const releases: Array<() => void> = []
    const barrierAuth = new Auth(dir, {
      passwordVerifier: async () => {
        calls += 1
        await new Promise<void>((resolve) => releases.push(resolve))
        return false
      }
    })
    barrierAuth.setPassword('configured-password')
    const barrierServer = http.createServer(createHttpHandler({ auth: barrierAuth, rendererDir }))
    await new Promise<void>((resolve) => barrierServer.listen(0, '127.0.0.1', resolve))
    const barrierBase = `http://127.0.0.1:${(barrierServer.address() as { port: number }).port}`
    try {
      const requests = Array.from({ length: 6 }, () =>
        fetch(`${barrierBase}/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'password=wrong',
          redirect: 'manual'
        })
      )
      await vi.waitFor(() => expect(calls).toBe(1))
      for (let completed = 0; completed < 5; completed++) {
        releases.shift()!()
        if (completed < 4) await vi.waitFor(() => expect(calls).toBe(completed + 2))
      }
      const responses = await Promise.all(requests)
      expect(responses.filter((r) => r.status === 303)).toHaveLength(5)
      expect(responses.filter((r) => r.status === 429)).toHaveLength(1)
      expect(calls).toBe(5)
    } finally {
      await new Promise((resolve) => barrierServer.close(resolve))
    }
  })

  it('rechecks passkey lockout after a slow JSON body finishes arriving', async () => {
    const body = JSON.stringify({ challenge: 'not-consumed-because-lockout-wins' })
    const allowed = vi.spyOn(auth, 'loginAllowed')
    let request!: http.ClientRequest
    const response = new Promise<{ status: number; body: string }>((resolve, reject) => {
      const target = new URL('/auth/passkey/login/verify', base)
      request = http.request(
        target,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }))
        }
      )
      request.on('error', reject)
      request.write(body.slice(0, 1))
    })
    try {
      await vi.waitFor(() => expect(allowed).toHaveBeenCalledWith('peer:127.0.0.1'))
      for (let i = 0; i < 5; i++) auth.recordLoginFailure('peer:127.0.0.1')
      request.end(body.slice(1))
      await expect(response).resolves.toMatchObject({
        status: 429,
        body: expect.stringContaining('too_many_attempts')
      })
    } finally {
      allowed.mockRestore()
    }
  })

  it('wires each passkey options route to its matching bounded ceremony purpose', async () => {
    const cookie = await setupAndLogin()
    const loginOptions = await fetch(`${base}/auth/passkey/login/options`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    })
    expect(loginOptions.status).toBe(200)
    const loginChallenge = String(((await loginOptions.json()) as { challenge: string }).challenge)
    const loginVerify = await fetch(`${base}/auth/passkey/login/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challenge: loginChallenge, id: 'missing-credential' })
    })
    expect(loginVerify.status).toBe(400)
    await expect(loginVerify.json()).resolves.toMatchObject({ error: 'unknown_credential' })

    const registerOptions = await fetch(`${base}/auth/passkey/register/options`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: '{}'
    })
    expect(registerOptions.status).toBe(200)
    const registerChallenge = String(((await registerOptions.json()) as { challenge: string }).challenge)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const registerVerify = await fetch(`${base}/auth/passkey/register/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ challenge: registerChallenge })
      })
      expect(registerVerify.status).toBe(400)
      await expect(registerVerify.json()).resolves.toMatchObject({ error: 'registration_failed' })
    } finally {
      warn.mockRestore()
    }

    for (let i = 0; i < MAX_CHALLENGES_GLOBAL; i++) {
      expect(auth.newChallenge(`capacity-peer-${i}`, 'login')).not.toBeNull()
    }
    const full = await fetch(`${base}/auth/passkey/login/options`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    })
    expect(full.status).toBe(429)
    await expect(full.json()).resolves.toMatchObject({ error: 'challenge_capacity' })
  })

  it('refuses slow unlock bodies after their lockout expires', async () => {
    let now = 1_000
    const clockAuth = new Auth(dir, { now: () => now })
    const clockServer = http.createServer(createHttpHandler({ auth: clockAuth, rendererDir }))
    await new Promise<void>((resolve) => clockServer.listen(0, '127.0.0.1', resolve))
    const clockBase = `http://127.0.0.1:${(clockServer.address() as { port: number }).port}`
    const peer = 'peer:127.0.0.1'
    const lock = () => {
      for (let i = 0; i < 5; i++) expect(clockAuth.recordLoginFailure(peer)).toBe(true)
      expect(clockAuth.loginAllowed(peer)).toBe(false)
    }
    const slowPost = (pathname: string, body: string) => {
      let request!: http.ClientRequest
      const response = new Promise<{ status: number; body: string }>((resolve, reject) => {
        request = http.request(
          new URL(pathname, clockBase),
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
          },
          (res) => {
            const chunks: Buffer[] = []
            res.on('data', (chunk: Buffer) => chunks.push(chunk))
            res.on('end', () => resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString()
            }))
          }
        )
        request.on('error', reject)
        request.write(body.slice(0, 1))
      })
      return { request, response }
    }

    try {
      lock()
      const allowed = vi.spyOn(clockAuth, 'loginAllowed')
      const challenge = slowPost('/auth/unlock/challenge', '{}')
      await vi.waitFor(() => expect(allowed).toHaveBeenCalledWith(peer))
      now += clockAuth.lockoutRemainingMs(peer) + 1
      challenge.request.end('}')
      await expect(challenge.response).resolves.toMatchObject({
        status: 409,
        body: expect.stringContaining('not_locked')
      })

      allowed.mockClear()
      lock()
      const issuedResponse = await fetch(`${clockBase}/auth/unlock/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      })
      expect(issuedResponse.status).toBe(200)
      const issued = (await issuedResponse.json()) as DimSumChallenge
      const right = DIM_SUM_NAMES.find((dish) => dish.zhHant === issued.prompt)!.en
      const answer = JSON.stringify({ kind: 'dimsum', nonce: issued.nonce, choice: right })
      allowed.mockClear()
      const verify = slowPost('/auth/unlock/verify', answer)
      await vi.waitFor(() => expect(allowed).toHaveBeenCalledWith(peer))
      now += clockAuth.lockoutRemainingMs(peer) + 1
      verify.request.end(answer.slice(1))
      await expect(verify.response).resolves.toMatchObject({
        status: 409,
        body: expect.stringContaining('not_locked')
      })
      allowed.mockRestore()
    } finally {
      await new Promise((resolve) => clockServer.close(resolve))
    }
  })

  it('logout revokes only the captured session bearer on disk before clearing the cookie', async () => {
    const cookie = await setupAndLogin()
    const token = sessionTokenFromCookie(cookie)!
    const otherToken = auth.createSession()
    const otherCookie = `${SESSION_COOKIE}=${otherToken}`

    const logout = await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { cookie },
      redirect: 'manual'
    })
    expect(logout.status).toBe(303)
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')

    const replay = await fetch(`${base}/`, {
      headers: { cookie, accept: 'text/html' },
      redirect: 'manual'
    })
    expect(replay.status).toBe(302)
    expect((await fetch(`${base}/`, { headers: { cookie: otherCookie } })).status).toBe(200)

    const restarted = new Auth(dir)
    expect(restarted.validateSession(token)).toBe(false)
    expect(restarted.validateSession(otherToken)).toBe(true)
  })

  it('keys lockout only from the TCP peer, never spoofable forwarding metadata or source port', () => {
    const socket = { remoteAddress: '10.20.30.40', remotePort: 1234 }
    const req = {
      socket,
      headers: {
        'x-forwarded-for': '198.51.100.1',
        forwarded: 'for=198.51.100.2',
        'x-real-ip': '198.51.100.3',
        'user-agent': 'first',
        cookie: 'anything=one'
      }
    } as unknown as http.IncomingMessage
    const key = authClientKey(req)
    socket.remotePort = 65000
    req.headers['x-forwarded-for'] = '203.0.113.9'
    req.headers.forwarded = 'for=203.0.113.10'
    req.headers['x-real-ip'] = '203.0.113.11'
    req.headers['user-agent'] = 'second'
    req.headers.cookie = 'anything=two'
    expect(authClientKey(req)).toBe(key)
    expect(authClientKey({ socket: { remoteAddress: '10.20.30.41' } } as http.IncomingMessage)).not.toBe(key)
    expect(authClientKey({ socket: {} } as http.IncomingMessage)).toBe('peer:unknown')
  })

  it('serves static with CSP rewrite on index.html and blocks traversal', async () => {
    const cookie = await setupAndLogin()
    const html = await (await fetch(`${base}/`, { headers: { cookie } })).text()
    expect(html).toContain(`connect-src 'self' ws: wss:`)
    const js = await fetch(`${base}/app.js`, { headers: { cookie } })
    expect(js.headers.get('content-type')).toContain('javascript')
    const evil = await fetch(`${base}/..%2f..%2fauth.json`, { headers: { cookie } })
    expect([400, 401, 404]).toContain(evil.status)
    expect(await evil.text()).not.toContain('salt')
  })

  it('warns (and still 200s) when index.html lacks the CSP rewrite marker', async () => {
    const cookie = await setupAndLogin()
    fs.writeFileSync(
      path.join(rendererDir, 'index.html'),
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'" /><div id="root"></div>`
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = await fetch(`${base}/`, { headers: { cookie } })
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).not.toContain('connect-src')
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toContain('CSP')
      expect(warn.mock.calls[0][0]).toContain('WebSocket')
    } finally {
      warn.mockRestore()
    }
  })

  // The browser client is the whole point of the Server Edition and it is usually not on this
  // LAN, so how the bundle goes over the wire is a feature, not a detail: the entry chunk is
  // ~2.1 MB raw against ~0.46 MB gzipped, and a reload that revalidates costs a 304 instead of
  // the whole thing.
  describe('static delivery', () => {
    /** Raw request: `fetch` negotiates and transparently decodes, which is exactly what these
     *  assertions need to see. */
    function rawGet(
      pathname: string,
      headers: Record<string, string>
    ): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
      return new Promise((resolve, reject) => {
        const req = http.get(`${base}${pathname}`, { headers }, (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) })
          )
        })
        req.on('error', reject)
      })
    }

    /** A hashed asset big enough to be worth compressing (see COMPRESS_MIN_BYTES). */
    function writeAsset(name: string, body: string): string {
      fs.mkdirSync(path.join(rendererDir, 'assets'), { recursive: true })
      fs.writeFileSync(path.join(rendererDir, 'assets', name), body)
      return body
    }

    afterEach(() => _resetStaticCacheForTest())

    it('negotiateEncoding prefers brotli, falls back to gzip, honours q=0', () => {
      expect(negotiateEncoding('gzip, deflate, br')).toBe('br')
      expect(negotiateEncoding('gzip, deflate')).toBe('gzip')
      expect(negotiateEncoding('br;q=0, gzip')).toBe('gzip')
      expect(negotiateEncoding('gzip;q=0')).toBeNull()
      expect(negotiateEncoding('identity')).toBeNull()
      expect(negotiateEncoding(undefined)).toBeNull()
    })

    it('compresses a large asset and serves the exact bytes back', async () => {
      const cookie = await setupAndLogin()
      const source = writeAsset('big-abc123.js', `export const x = "${'y'.repeat(4000)}"\n`)
      const gz = await rawGet('/assets/big-abc123.js', { cookie, 'accept-encoding': 'gzip' })
      expect(gz.headers['content-encoding']).toBe('gzip')
      expect(gz.headers['vary']).toBe('Accept-Encoding')
      expect(zlib.gunzipSync(gz.body).toString('utf8')).toBe(source)
      // Smaller on the wire is the entire point — assert it, so a future "simplification" that
      // quietly stops compressing fails here instead of only showing up as a slow load.
      expect(gz.body.length).toBeLessThan(source.length / 2)

      const br = await rawGet('/assets/big-abc123.js', { cookie, 'accept-encoding': 'br' })
      expect(br.headers['content-encoding']).toBe('br')
      expect(zlib.brotliDecompressSync(br.body).toString('utf8')).toBe(source)
    })

    it('serves identity when the client accepts no encoding, and never compresses tiny files', async () => {
      const cookie = await setupAndLogin()
      writeAsset('big-abc123.js', 'x'.repeat(4000))
      const identity = await rawGet('/assets/big-abc123.js', { cookie })
      expect(identity.headers['content-encoding']).toBeUndefined()
      expect(identity.body.length).toBe(4000)
      // app.js is 14 bytes: a compressed frame plus its headers would be bigger than the file.
      const tiny = await rawGet('/app.js', { cookie, 'accept-encoding': 'gzip, br' })
      expect(tiny.headers['content-encoding']).toBeUndefined()
      expect(tiny.body.toString('utf8')).toBe('console.log(1)')
    })

    it('revalidates by ETag (304) and marks hashed assets immutable', async () => {
      const cookie = await setupAndLogin()
      writeAsset('big-abc123.js', 'x'.repeat(4000))
      const first = await rawGet('/assets/big-abc123.js', { cookie, 'accept-encoding': 'gzip' })
      expect(first.status).toBe(200)
      expect(first.headers['cache-control']).toBe('private, max-age=31536000, immutable')
      const etag = first.headers['etag'] as string
      expect(etag).toBeTruthy()

      const again = await rawGet('/assets/big-abc123.js', {
        cookie,
        'accept-encoding': 'gzip',
        'if-none-match': etag
      })
      expect(again.status).toBe(304)
      expect(again.body.length).toBe(0)

      // index.html carries the app's entry point: it must revalidate, never be held for a year.
      const index = await rawGet('/', { cookie })
      expect(index.headers['cache-control']).toBe('private, no-cache')
      const indexAgain = await rawGet('/', {
        cookie,
        'if-none-match': index.headers['etag'] as string
      })
      expect(indexAgain.status).toBe(304)
    })

    it('keeps the index.html CSP rewrite through compression', async () => {
      const cookie = await setupAndLogin()
      // Pad past COMPRESS_MIN_BYTES so this actually exercises the compressed path — the rewrite
      // happens before compression, and a regression there would be invisible on a small file.
      fs.writeFileSync(
        path.join(rendererDir, 'index.html'),
        `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'" /><div id="root"></div><!--${'p'.repeat(4000)}-->`
      )
      const res = await rawGet('/', { cookie, 'accept-encoding': 'gzip' })
      expect(res.headers['content-encoding']).toBe('gzip')
      expect(zlib.gunzipSync(res.body).toString('utf8')).toContain(`connect-src 'self' ws: wss:`)
    })

    it('re-compresses after the file changes on disk (a rebuild must not serve stale bytes)', async () => {
      const cookie = await setupAndLogin()
      writeAsset('big-abc123.js', 'a'.repeat(4000))
      const before = await rawGet('/assets/big-abc123.js', { cookie, 'accept-encoding': 'gzip' })
      expect(zlib.gunzipSync(before.body).toString('utf8')).toBe('a'.repeat(4000))
      // A rebuild normally changes the hashed name too; same name + new bytes is the harder case.
      const later = new Date(Date.now() + 5000)
      const file = path.join(rendererDir, 'assets', 'big-abc123.js')
      fs.writeFileSync(file, 'b'.repeat(4000))
      fs.utimesSync(file, later, later)
      const after = await rawGet('/assets/big-abc123.js', { cookie, 'accept-encoding': 'gzip' })
      expect(zlib.gunzipSync(after.body).toString('utf8')).toBe('b'.repeat(4000))
      expect(after.headers['etag']).not.toBe(before.headers['etag'])
    })
  })

  it('sessionTokenFromCookie parses the session out of a multi-cookie header', () => {
    expect(sessionTokenFromCookie(`a=b; ${SESSION_COOKIE}=tok123; c=d`)).toBe('tok123')
    expect(sessionTokenFromCookie(undefined)).toBeUndefined()
  })
})

describe('http layer with proxy header trust', () => {
  const HDR = 'Cf-Access-Authenticated-User-Email'

  function trustedServer(netsSpec: string): Promise<{ srv: http.Server; url: string }> {
    const srv = http.createServer(
      createHttpHandler({
        auth,
        rendererDir,
        trustProxy: { header: HDR, nets: parseTrustedNets(netsSpec) }
      })
    )
    return new Promise((r) =>
      srv.listen(0, '127.0.0.1', () =>
        r({ srv, url: `http://127.0.0.1:${(srv.address() as { port: number }).port}` })
      )
    )
  }

  it('trusted peer + header: serves the app with no cookie; /login and /setup redirect home', async () => {
    const { srv, url } = await trustedServer('127.0.0.0/8')
    try {
      const home = await fetch(`${url}/`, { headers: { [HDR]: 'dev@corp.com' } })
      expect(home.status).toBe(200)
      const login = await fetch(`${url}/login`, {
        headers: { [HDR]: 'dev@corp.com' },
        redirect: 'manual'
      })
      expect(login.status).toBe(302)
      expect(login.headers.get('location')).toBe('/')
      const setup = await fetch(`${url}/setup`, {
        headers: { [HDR]: 'dev@corp.com' },
        redirect: 'manual'
      })
      expect(setup.status).toBe(302)
      expect(setup.headers.get('location')).toBe('/')
    } finally {
      await new Promise((r) => srv.close(r))
    }
  })

  it('missing/empty header, or a peer outside the nets, falls through to normal auth', async () => {
    const { srv, url } = await trustedServer('127.0.0.0/8')
    const { srv: srvFar, url: urlFar } = await trustedServer('10.0.0.0/8')
    try {
      expect((await fetch(`${url}/x.json`, { redirect: 'manual' })).status).toBe(401)
      expect(
        (await fetch(`${url}/x.json`, { headers: { [HDR]: '  ' }, redirect: 'manual' })).status
      ).toBe(401)
      // Loopback peer, but the trusted nets exclude loopback → the header means nothing.
      expect(
        (await fetch(`${urlFar}/x.json`, { headers: { [HDR]: 'dev@corp.com' }, redirect: 'manual' }))
          .status
      ).toBe(401)
      // Password/cookie auth still works beside proxy trust.
      const cookie = await setupAndLogin()
      const viaCookie = await fetch(`${urlFar}/`, { headers: { cookie } })
      expect(viaCookie.status).toBe(200)
    } finally {
      await new Promise((r) => srv.close(r))
      await new Promise((r) => srvFar.close(r))
    }
  })
})
