import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { sessionHostPaths } from '../session-host/paths'
import { LineFramer, encodeFrame, type SessionHostRequest } from '../session-host/protocol'
import { SessionHostClient } from './session-host-client'

const openServers = new Set<net.Server>()
const openSockets = new Set<net.Socket>()
const tempDirs = new Set<string>()

function within<T>(promise: Promise<T>, ms = 1_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`session-host client did not answer within ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

afterEach(async () => {
  for (const socket of openSockets) socket.destroy()
  openSockets.clear()
  await Promise.all(
    [...openServers].map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        })
    )
  )
  openServers.clear()
  for (const dir of tempDirs) {
    const endpoint = sessionHostPaths(dir).endpoint
    if (process.platform !== 'win32') fs.rmSync(endpoint, { force: true })
    fs.rmSync(dir, { recursive: true, force: true })
  }
  tempDirs.clear()
})

describe('SessionHostClient handshake transition', () => {
  it('keeps the production frame listener after hello and delivers the first attach response and data', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeterm-session-client-'))
    tempDirs.add(userDataDir)
    const paths = sessionHostPaths(userDataDir)
    const token = 'test-token-kept-off-argv'
    fs.writeFileSync(paths.tokenPath, token)

    const server = net.createServer((socket) => {
      openSockets.add(socket)
      socket.once('close', () => openSockets.delete(socket))
      const framer = new LineFramer()
      socket.on('data', (chunk: Buffer) => {
        for (const req of framer.push<SessionHostRequest>(chunk.toString('utf8'))) {
          if (req.cmd === 'hello') {
            expect(req.token).toBe(token)
            socket.write(encodeFrame({ id: req.id, ok: true }))
            continue
          }
          if (req.cmd === 'attach') {
            // One write deliberately carries the correlated response and the first push frame.
            // Removing every `data` listener after installing the production listener loses both
            // and leaves `attach()` pending forever; this exercises the real stream transition,
            // not the source text that happens to implement it today.
            socket.write(
              encodeFrame({ id: req.id, ok: true, result: { fresh: true } }) +
                encodeFrame({
                  type: 'data',
                  name: req.name,
                  data: 'first production frame'
                })
            )
          }
        }
      })
    })
    openServers.add(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(paths.endpoint, resolve)
    })

    const client = new SessionHostClient({ userDataDir })
    let deliver!: (data: string) => void
    const firstData = new Promise<string>((resolve) => {
      deliver = resolve
    })
    const attached = client.attach(
      'nt-real-transition',
      {
        cwd: userDataDir,
        shell: process.execPath,
        args: [],
        env: {},
        cols: 80,
        rows: 24
      },
      1_000,
      { onData: deliver, onExit: () => {} }
    )

    await expect(within(attached)).resolves.toEqual({ fresh: true })
    await expect(within(firstData)).resolves.toBe('first production frame')
  })

  it('accepts only the response correlated to its hello request', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeterm-session-client-'))
    tempDirs.add(userDataDir)
    const paths = sessionHostPaths(userDataDir)
    fs.writeFileSync(paths.tokenPath, 'real-token')
    let sawAttach = false

    const server = net.createServer((socket) => {
      openSockets.add(socket)
      socket.once('close', () => openSockets.delete(socket))
      const framer = new LineFramer()
      socket.on('data', (chunk: Buffer) => {
        for (const req of framer.push<SessionHostRequest>(chunk.toString('utf8'))) {
          if (req.cmd === 'hello') {
            socket.write(
              encodeFrame({ id: req.id + 10_000, ok: true }) +
                encodeFrame({ id: req.id, ok: false, error: 'unauthorized' })
            )
          } else if (req.cmd === 'attach') {
            sawAttach = true
            socket.write(encodeFrame({ id: req.id, ok: true, result: { fresh: true } }))
          }
        }
      })
    })
    openServers.add(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(paths.endpoint, resolve)
    })

    const client = new SessionHostClient({ userDataDir })
    const attach = client.attach(
      'nt-refused',
      {
        cwd: userDataDir,
        shell: process.execPath,
        args: [],
        env: {},
        cols: 80,
        rows: 24
      },
      1_000,
      { onData: () => {}, onExit: () => {} }
    )

    await expect(within(attach)).rejects.toThrow('session-host bundle not found')
    expect(sawAttach).toBe(false)
  })

  it('rolls back a failed subscriber so reconnect does not replay a ghost attach', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeterm-session-client-'))
    tempDirs.add(userDataDir)
    const paths = sessionHostPaths(userDataDir)
    fs.writeFileSync(paths.tokenPath, 'test-token')
    const commands = new Map<number, string[]>()
    let connection = 0
    let closeFirst!: () => void
    const firstClosed = new Promise<void>((resolve) => {
      closeFirst = resolve
    })

    const server = net.createServer((socket) => {
      const ownConnection = ++connection
      commands.set(ownConnection, [])
      openSockets.add(socket)
      socket.once('close', () => {
        openSockets.delete(socket)
        if (ownConnection === 1) closeFirst()
      })
      const framer = new LineFramer()
      socket.on('data', (chunk: Buffer) => {
        for (const req of framer.push<SessionHostRequest>(chunk.toString('utf8'))) {
          commands.get(ownConnection)?.push(req.cmd)
          if (req.cmd === 'hello') {
            socket.write(encodeFrame({ id: req.id, ok: true }))
          } else if (req.cmd === 'attach' && ownConnection === 1) {
            socket.write(
              encodeFrame({
                id: req.id,
                ok: false,
                error: 'initial attach refused'
              }),
              () => socket.destroy()
            )
          } else if (req.cmd === 'attach') {
            socket.write(encodeFrame({ id: req.id, ok: true, result: { fresh: false } }))
          } else if (req.cmd === 'hasSession') {
            socket.write(encodeFrame({ id: req.id, ok: true, result: { exists: true } }))
          }
        }
      })
    })
    openServers.add(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(paths.endpoint, resolve)
    })

    const client = new SessionHostClient({ userDataDir })
    await expect(
      within(
        client.attach(
          'nt-no-ghost',
          {
            cwd: userDataDir,
            shell: process.execPath,
            args: [],
            env: {},
            cols: 80,
            rows: 24
          },
          1_000,
          { onData: () => {}, onExit: () => {} }
        )
      )
    ).rejects.toThrow('initial attach refused')
    await firstClosed

    await expect(within(client.hasSession('nt-no-ghost'))).resolves.toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(commands.get(2)).toEqual(['hello', 'hasSession'])
  })

  it('propagates uncertain capture and kill failures instead of claiming empty or gone', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeterm-session-client-'))
    tempDirs.add(userDataDir)
    const paths = sessionHostPaths(userDataDir)
    fs.writeFileSync(paths.tokenPath, 'test-token')

    const server = net.createServer((socket) => {
      openSockets.add(socket)
      socket.once('close', () => openSockets.delete(socket))
      const framer = new LineFramer()
      socket.on('data', (chunk: Buffer) => {
        for (const req of framer.push<SessionHostRequest>(chunk.toString('utf8'))) {
          if (req.cmd === 'hello') socket.write(encodeFrame({ id: req.id, ok: true }))
          else if (req.cmd === 'capture' || req.cmd === 'killSession') socket.destroy()
        }
      })
    })
    openServers.add(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(paths.endpoint, resolve)
    })

    const client = new SessionHostClient({ userDataDir })
    await expect(within(client.capture('nt-uncertain', true))).rejects.toThrow('session-host connection lost')
    await expect(within(client.killSession('nt-uncertain'))).rejects.toThrow('session-host connection lost')
  })

  it('does not turn a token read failure into host absence', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeterm-session-client-'))
    tempDirs.add(userDataDir)
    const paths = sessionHostPaths(userDataDir)
    fs.mkdirSync(paths.tokenPath)
    let tokenReadCode: string | undefined
    try {
      fs.readFileSync(paths.tokenPath, 'utf8')
    } catch (error) {
      tokenReadCode = (error as NodeJS.ErrnoException).code
    }
    expect(tokenReadCode).toBeTruthy()

    const client = new SessionHostClient({ userDataDir })
    await expect(client.hasSession('nt-never-probed')).rejects.toMatchObject({
      code: tokenReadCode
    })
  })
})
