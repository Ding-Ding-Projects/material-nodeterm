// The unlock ladder over HTTP.
//
// These tests exist for the boundary, not the fun. The ladder is a playful way out of a WAIT, and
// every assertion below is one of the ways it could quietly stop being only that: by handing out
// a session, by being reachable when nothing is locked, by refunding attempts, or by shortening
// the escalation it is supposed to leave alone.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import http from 'http'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { Auth } from './auth'
import { createHttpHandler, SESSION_COOKIE } from './http'
import { DIM_SUM_NAMES } from '../shared/dimsum-names'
import type { DimSumChallenge, MathChallenge } from '../core/unlock-ladder'

let dir: string, rendererDir: string, server: http.Server, base: string, auth: Auth

const PASSWORD = 'correct horse battery'

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-ladder-'))
  rendererDir = path.join(dir, 'renderer')
  fs.mkdirSync(rendererDir)
  fs.writeFileSync(path.join(rendererDir, 'index.html'), '<div id="root"></div>')
  auth = new Auth(dir)
  auth.setPassword(PASSWORD)
  server = http.createServer(createHttpHandler({ auth, rendererDir }))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterEach(async () => {
  await new Promise((r) => server.close(r))
  fs.rmSync(dir, { recursive: true, force: true })
})

/** Drive the real login route until the account locks, exactly as a person would. */
async function lockOut(): Promise<void> {
  for (let i = 0; i < 6 && auth.loginAllowed(); i++) {
    await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: 'wrong' }),
      redirect: 'manual'
    })
  }
  expect(auth.loginAllowed(), 'the account should be locked by now').toBe(false)
}

const post = (p: string, body: unknown) =>
  fetch(`${base}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })

describe('reachability', () => {
  it('is refused while nothing is locked', async () => {
    const r = await post('/auth/unlock/challenge', {})
    expect(r.status).toBe(409)
    // Otherwise the ladder is a free question oracle on a perfectly usable account.
  })

  it('is offered once locked out', async () => {
    await lockOut()
    const r = await post('/auth/unlock/challenge', {})
    expect(r.status).toBe(200)
    const c = (await r.json()) as DimSumChallenge
    expect(c.kind).toBe('dimsum')
    expect(c.choices).toHaveLength(4)
  })

  it('shows the lockout screen at /login instead of a password box that always refuses', async () => {
    await lockOut()
    const html = await (await fetch(`${base}/login`)).text()
    expect(html).toContain('Locked out')
    expect(html).toContain('Play your way out')
  })
})

describe('the boundary — what clearing the ladder may and may not do', () => {
  async function solveDimSum(): Promise<Response> {
    const c = (await (await post('/auth/unlock/challenge', {})).json()) as DimSumChallenge
    const right = DIM_SUM_NAMES.find((d) => d.zhHant === c.prompt)!.en
    return post('/auth/unlock/verify', { kind: 'dimsum', nonce: c.nonce, choice: right })
  }

  it('ends the wait', async () => {
    await lockOut()
    const v = (await (await solveDimSum()).json()) as { cleared: boolean }
    expect(v.cleared).toBe(true)
    expect(auth.loginAllowed()).toBe(true)
  })

  it('NEVER issues a session — the password is still required', async () => {
    // The single most important assertion in this file. A ladder that logged anyone in would be
    // a second password, and "guess a dumpling" is not one.
    await lockOut()
    const res = await solveDimSum()
    expect(res.headers.get('set-cookie')).toBeNull()
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).not.toContain(SESSION_COOKIE)

    // And the app is still closed to us.
    const app = await fetch(`${base}/`, { redirect: 'manual' })
    expect([301, 302, 303, 401, 403]).toContain(app.status)
  })

  it('does not shorten the NEXT lockout', async () => {
    await lockOut()
    const first = auth.lockoutRemainingMs()
    await solveDimSum()
    expect(auth.loginAllowed()).toBe(true)

    await lockOut()
    const second = auth.lockoutRemainingMs()
    // Escalation is untouched by the ladder: the second wait is still twice the first, so a
    // script that spends its whole ladder budget still walks into an exponentially longer wall.
    expect(second).toBeGreaterThan(first)
  })

  it('grants no more attempts than waiting would', async () => {
    await lockOut()
    await solveDimSum()
    // Five wrong guesses re-lock, exactly as they would have after serving the clock.
    let attempts = 0
    while (auth.loginAllowed() && attempts < 10) {
      await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password: 'wrong' }),
        redirect: 'manual'
      })
      attempts++
    }
    expect(attempts).toBe(5)
  })

  it('cannot be replayed', async () => {
    await lockOut()
    const c = (await (await post('/auth/unlock/challenge', {})).json()) as DimSumChallenge
    const right = DIM_SUM_NAMES.find((d) => d.zhHant === c.prompt)!.en
    const body = { kind: 'dimsum', nonce: c.nonce, choice: right }
    expect(((await (await post('/auth/unlock/verify', body)).json()) as { cleared: boolean }).cleared).toBe(true)

    // Second use: now unlocked, so the route refuses outright — and even if it were locked the
    // nonce is already consumed.
    expect((await post('/auth/unlock/verify', body)).status).toBe(409)
  })

  it('rejects a malformed answer', async () => {
    await lockOut()
    expect((await post('/auth/unlock/verify', { kind: 'dimsum' })).status).toBe(400)
  })
})

describe('rungs', () => {
  it('falls through to maths after five wrong dim sum answers', async () => {
    await lockOut()
    let next = 'dimsum'
    for (let i = 0; i < 5; i++) {
      const c = (await (await post('/auth/unlock/challenge', { rung: next })).json()) as DimSumChallenge
      const right = DIM_SUM_NAMES.find((d) => d.zhHant === c.prompt)!.en
      const wrong = c.choices.find((x) => x !== right)!
      const v = (await (
        await post('/auth/unlock/verify', { kind: 'dimsum', nonce: c.nonce, choice: wrong })
      ).json()) as { next: string }
      next = v.next
    }
    expect(next).toBe('math')

    const m = (await (await post('/auth/unlock/challenge', { rung: 'math' })).json()) as MathChallenge
    expect(m.kind).toBe('math')
    expect(m.questions).toHaveLength(10)
  })

  it('drops to whack-a-mole when one sum is wrong', async () => {
    await lockOut()
    const m = (await (await post('/auth/unlock/challenge', { rung: 'math' })).json()) as MathChallenge
    const v = (await (
      await post('/auth/unlock/verify', { kind: 'math', nonce: m.nonce, answers: m.questions.map(() => 0) })
    ).json()) as { next: string; cleared: boolean }
    expect(v.cleared).toBe(false)
    expect(v.next).toBe('whack')
  })

  it('an unknown rung name falls back to the start rather than being honoured', async () => {
    await lockOut()
    const c = (await (await post('/auth/unlock/challenge', { rung: 'free-pass' })).json()) as DimSumChallenge
    expect(c.kind).toBe('dimsum')
  })
})
