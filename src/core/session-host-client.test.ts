import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sessionHostPaths } from '../session-host/paths'
import {
  LineFramer,
  SESSION_HOST_PROTOCOL_VERSION,
  encodeFrame,
  type SessionHostRequest
} from '../session-host/protocol'
import { SessionHostClient } from './session-host-client'

const openServers = new Set<net.Server>()
const openSockets = new Set<net.Socket>()
const tempDirs = new Set<string>()

function within<T>(promise: Promise<T>, ms = 1_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`session-host client did not answer within ${ms}ms`)),
      ms
    )
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

function spawnOptions(userDataDir: string, args: string[] = []) {
  return {
    cwd: userDataDir,
    shell: process.execPath,
    args,
    env: {},
    cols: 80,
    rows: 24
  }
}

function publishHostIdentity(userDataDir: string, token = 'a'.repeat(64)): string {
  const paths = sessionHostPaths(userDataDir)
  fs.writeFileSync(paths.tokenPath, token)
  fs.writeFileSync(
    paths.statePath,
    JSON.stringify({
      pid: process.pid,
      endpoint: paths.endpoint,
      tokenPath: paths.tokenPath,
      startedAt: Date.now(),
      protocolVersion: SESSION_HOST_PROTOCOL_VERSION
    })
  )
  return token
}

async function listen(server: net.Server, endpoint: string): Promise<void> {
  openServers.add(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(endpoint, resolve)
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

describe('SessionHostClient failure boundaries', () => {
  it('keeps the production frame listener through hello and the first attach frames', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeterm-session-client-'))
    tempDirs.add(userDataDir)
    const paths = sessionHostPaths(userDataDir)
    const token = publishHostIdentity(userDataDir)

    const server = net.createServer((socket) => {
      openSockets.add(socket)
      socket.once('close', () => openSockets.delete(socket))
      const framer = new LineFramer()
      socket.on('data', (chunk: Buffer) => {
        for (const req of framer.push<SessionHostRequest>(chunk.toString('utf8'))) {
          if (req.cmd === 'hello') {
            expect(req.token).toBe(token)
            socket.write(encodeFrame({ id: req.id, ok: true }))
          } else if (req.cmd === 'attach') {
            socket.write(
              encodeFrame({ id: req.id, ok: true, result: { fresh: true } }) +
                encodeFrame({ type: 'data', name: req.name, data: 'first production frame' })
            )
          }
        }
      })
    })
    await listen(server, paths.endpoint)

    const client = new SessionHostClient({ userDataDir })
    let deliver!: (data: string) => void
    const firstData = new Promise<string>((resolve) => {
      deliver = resolve
    })
    const subscriber = { onData: deliver, onExit: () => {} }
    const attached = client.attach(
      'nt-real-transition',
      spawnOptions(userDataDir),
      1_000,
      subscriber
    )

    await expect(within(attached)).resolves.toEqual({ fresh: true })
    await expect(within(firstData)).resolves.toBe('first production frame')
    client.unsubscribe('nt-real-transition', subscriber)
  })

  it('rolls back only a rejected co-attach and replays the neighboring attachment', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeterm-session-client-'))
    tempDirs.add(userDataDir)
    const paths = sessionHostPaths(userDataDir)
    publishHostIdentity(userDataDir)
    let connection = 0
    let firstAttach = true
    let firstSocket: net.Socket | undefined
    const replayedArgs: string[][] = []
    let closeFirst!: () => void
    const firstClosed = new Promise<void>((resolve) => {
      closeFirst = resolve
    })

    const server = net.createServer((socket) => {
      const ownConnection = ++connection
      if (ownConnection === 1) firstSocket = socket
      openSockets.add(socket)
      socket.once('close', () => {
        openSockets.delete(socket)
        if (ownConnection === 1) closeFirst()
      })
      const framer = new LineFramer()
      socket.on('data', (chunk: Buffer) => {
        for (const req of framer.push<SessionHostRequest>(chunk.toString('utf8'))) {
          if (req.cmd === 'hello') {
            socket.write(encodeFrame({ id: req.id, ok: true }))
          } else if (req.cmd === 'attach' && ownConnection === 1 && firstAttach) {
            firstAttach = false
            socket.write(encodeFrame({ id: req.id, ok: false, error: 'one subscriber refused' }))
          } else if (req.cmd === 'attach') {
            if (ownConnection > 1) {
              replayedArgs.push(req.spawn.args)
              socket.write(
                encodeFrame({ id: req.id, ok: true, result: { fresh: false } }) +
                  encodeFrame({ type: 'data', name: req.name, data: 'replayed-live-data' })
              )
            } else {
              socket.write(encodeFrame({ id: req.id, ok: true, result: { fresh: false } }))
            }
          } else if (req.cmd === 'hasSession') {
            socket.write(encodeFrame({ id: req.id, ok: true, result: { exists: true } }))
          }
        }
      })
    })
    await listen(server, paths.endpoint)

    const refusedData = vi.fn()
    const keptData = vi.fn()
    const client = new SessionHostClient({ userDataDir })
    const refusedSubscriber = { onData: refusedData, onExit: () => {} }
    const keptSubscriber = { onData: keptData, onExit: () => {} }
    const refused = client.attach(
      'nt-shared',
      spawnOptions(userDataDir, ['failed-options']),
      1_000,
      refusedSubscriber
    )
    const kept = client.attach(
      'nt-shared',
      spawnOptions(userDataDir, ['kept-options']),
      1_000,
      keptSubscriber
    )

    await expect(within(refused)).rejects.toThrow('one subscriber refused')
    await expect(within(kept)).resolves.toEqual({ fresh: false })
    firstSocket?.destroy()
    await firstClosed
    await expect(within(client.hasSession('nt-shared'))).resolves.toBe(true)
    await expect.poll(() => replayedArgs).toEqual([['kept-options']])
    await expect.poll(() => keptData.mock.calls).toEqual([['replayed-live-data']])
    expect(refusedData).not.toHaveBeenCalled()
    client.unsubscribe('nt-shared', keptSubscriber)
  })

  it.each(['capture', 'killSession'] as const)(
    'propagates an uncertain %s failure instead of claiming success',
    async (command) => {
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeterm-session-client-'))
      tempDirs.add(userDataDir)
      const paths = sessionHostPaths(userDataDir)
      publishHostIdentity(userDataDir)

      const server = net.createServer((socket) => {
        openSockets.add(socket)
        socket.once('close', () => openSockets.delete(socket))
        const framer = new LineFramer()
        socket.on('data', (chunk: Buffer) => {
          for (const req of framer.push<SessionHostRequest>(chunk.toString('utf8'))) {
            if (req.cmd === 'hello') socket.write(encodeFrame({ id: req.id, ok: true }))
            else if (req.cmd === command) socket.destroy()
          }
        })
      })
      await listen(server, paths.endpoint)

      const client = new SessionHostClient({ userDataDir })
      const request: Promise<unknown> =
        command === 'capture'
          ? client.capture('nt-uncertain', true)
          : client.killSession('nt-uncertain')
      await expect(within(request)).rejects.toThrow('session-host connection lost')
    }
  )
})
