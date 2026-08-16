import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import WebSocket from 'ws'

import { startServer } from '../../src/server/index'
import { IPC } from '../../src/shared/ipc'
import { defaultScheduledSettingsFile } from '../../src/shared/scheduled-settings'

async function rpc(ws: WebSocket, id: number, method: string, args: unknown[] = []): Promise<unknown> {
  const reply = new Promise<unknown>((resolve, reject) => {
    const onMessage = (raw: WebSocket.RawData, binary: boolean): void => {
      if (binary) return
      const message = JSON.parse(raw.toString()) as {
        t?: string
        id?: number
        ok?: boolean
        result?: unknown
        error?: { message?: string }
      }
      if (message.t !== 'res' || message.id !== id) return
      ws.off('message', onMessage)
      message.ok ? resolve(message.result) : reject(new Error(message.error?.message ?? 'RPC failed'))
    }
    ws.on('message', onMessage)
  })
  ws.send(JSON.stringify({ t: 'req', id, method, args }))
  return reply
}

async function login(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'password=scheduled-startup-password',
    redirect: 'manual'
  })
  expect(response.status).toBe(303)
  return response.headers.get('set-cookie')!.split(';')[0]
}

afterEach(() => vi.restoreAllMocks())

describe('real Server shell scheduled-settings startup recovery', () => {
  it.each([
    { fixture: 'absent', expectedOk: true, expectedKind: null, expectedCode: null },
    { fixture: 'corrupt', expectedOk: false, expectedKind: 'corrupt', expectedCode: null },
    { fixture: 'directory', expectedOk: false, expectedKind: 'unreadable', expectedCode: 'EISDIR' },
    { fixture: 'EACCES', expectedOk: false, expectedKind: 'unreadable', expectedCode: 'EACCES' },
    { fixture: 'EIO', expectedOk: false, expectedKind: 'unreadable', expectedCode: 'EIO' }
  ] as const)(
    'boots and returns the truthful $fixture load state over authenticated WS-RPC',
    async ({ fixture, expectedOk, expectedKind, expectedCode }) => {
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-scheduled-server-start-'))
      const schedulePath = path.join(dataDir, 'scheduled-settings.json')
      let server: Awaited<ReturnType<typeof startServer>> | null = null
      let ws: WebSocket | null = null
      const originalBytes = '{broken schedule evidence'

      try {
        if (fixture === 'corrupt') fs.writeFileSync(schedulePath, originalBytes, 'utf8')
        if (fixture === 'directory') fs.mkdirSync(schedulePath)
        if (fixture === 'EACCES' || fixture === 'EIO') {
          fs.writeFileSync(schedulePath, originalBytes, 'utf8')
          const originalRead = fs.readFileSync.bind(fs)
          vi.spyOn(fs, 'readFileSync').mockImplementation(((target: fs.PathOrFileDescriptor, options?: unknown) => {
            if (path.resolve(String(target)) === path.resolve(schedulePath)) {
              throw Object.assign(new Error(`synthetic ${fixture}`), { code: fixture })
            }
            return originalRead(target, options as never)
          }) as typeof fs.readFileSync)
        }

        server = await startServer({
          port: 0,
          host: '127.0.0.1',
          dataDir,
          rendererDir: path.join(dataDir, 'no-renderer'),
          insecureHttp: false,
          passwordSeed: 'scheduled-startup-password',
          installHooks: false,
          headless: false
        })
        const cookie = await login(server.port)
        ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, { headers: { cookie } })
        await new Promise<void>((resolve, reject) => {
          ws!.once('open', resolve)
          ws!.once('error', reject)
        })

        const loaded = (await rpc(ws, 1, IPC.scheduledSettingsLoad)) as {
          ok: boolean
          file: { rules: unknown[] }
          error: null | { kind: string; code?: string; path: string }
        }
        expect(loaded.ok).toBe(expectedOk)
        expect(loaded.file.rules).toEqual([])
        expect(loaded.error?.kind ?? null).toBe(expectedKind)
        expect(loaded.error?.code ?? null).toBe(expectedCode)
        if (loaded.error) expect(path.resolve(loaded.error.path)).toBe(path.resolve(schedulePath))

        if (!expectedOk) {
          expect(await rpc(ws, 2, IPC.scheduledSettingsSave, [defaultScheduledSettingsFile()])).toMatchObject({
            ok: false
          })
          if (fixture === 'directory') {
            expect(fs.statSync(schedulePath).isDirectory()).toBe(true)
          } else {
            expect(await fs.promises.readFile(schedulePath, 'utf8')).toBe(originalBytes)
          }
        }
      } finally {
        ws?.terminate()
        await server?.close()
        // Windows can briefly retain a just-closed HTTP/SQLite directory handle after every
        // owner has drained. Retry only the fixture-directory removal; a genuinely live handle
        // still fails once the bounded retry budget is exhausted.
        await fs.promises.rm(dataDir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 50
        })
      }
    },
    30_000
  )
})
