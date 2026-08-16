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
  type SessionHostRequest,
  type SessionHostSpawnOptions
} from '../session-host/protocol'
import {
  SessionHostClient,
  SessionHostProtocolCompatibilityError,
  type SessionSubscriber
} from './session-host-client'

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

function createUserData(token = 'test-token'): {
  userDataDir: string
  paths: ReturnType<typeof sessionHostPaths>
  token: string
} {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeterm-session-client-'))
  tempDirs.add(userDataDir)
  const paths = sessionHostPaths(userDataDir)
  fs.writeFileSync(paths.tokenPath, token)
  return { userDataDir, paths, token }
}

function spawnOptions(cwd: string): SessionHostSpawnOptions {
  return {
    cwd,
    shell: process.execPath,
    args: [],
    env: {},
    cols: 80,
    rows: 24
  }
}

async function serve(
  endpoint: string,
  onRequest: (request: SessionHostRequest, socket: net.Socket, connection: number) => void
): Promise<net.Server> {
  let connection = 0
  const server = net.createServer((socket) => {
    const ownConnection = ++connection
    openSockets.add(socket)
    socket.once('close', () => openSockets.delete(socket))
    const framer = new LineFramer()
    socket.on('data', (chunk: Buffer) => {
      for (const request of framer.push<SessionHostRequest>(chunk.toString('utf8'))) {
        onRequest(request, socket, ownConnection)
      }
    })
  })
  openServers.add(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(endpoint, resolve)
  })
  return server
}

function subscriber(onData: (data: string) => void = vi.fn()): SessionSubscriber {
  return { onData, onExit: vi.fn() }
}

function acceptedHello(id: number): string {
  return encodeFrame({
    id,
    ok: true,
    result: { protocolVersion: SESSION_HOST_PROTOCOL_VERSION }
  })
}

function acceptedLegacyHello(id: number): string {
  return encodeFrame({ id, ok: true })
}

function clientOutcome<T>(source: Promise<T>): {
  promise: Promise<
    { status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown }
  >
  settled: () => boolean
} {
  let settled = false
  const promise = source.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason })
  )
  void promise.then(() => {
    settled = true
  })
  return { promise, settled: () => settled }
}

afterEach(async () => {
  vi.useRealTimers()
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
  vi.restoreAllMocks()
})

describe('SessionHostClient handshake transition', () => {
  it('hands the socket to the production listener before the first attach response and data', async () => {
    const { userDataDir, paths, token } = createUserData('test-token-kept-off-argv')

    await serve(paths.endpoint, (request, socket) => {
      if (request.cmd === 'hello') {
        expect(request.token).toBe(token)
        socket.write(acceptedHello(request.id))
      } else if (request.cmd === 'attach') {
        // One write deliberately carries the correlated response and first push frame. Broad
        // handshake cleanup loses both after installing the production listener.
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { fresh: true, generation: 'generation-transition' }
          }) +
            encodeFrame({
              type: 'data',
              name: request.name,
              data: 'first production frame',
              generation: 'generation-transition'
            })
        )
      }
    })

    let deliver!: (data: string) => void
    const firstData = new Promise<string>((resolve) => {
      deliver = resolve
    })
    const client = new SessionHostClient({ userDataDir })
    const attached = client.attach(
      'nt-real-transition',
      spawnOptions(userDataDir),
      1_000,
      subscriber(deliver)
    )

    await expect(within(attached)).resolves.toEqual({
      fresh: true,
      generation: 'generation-transition'
    })
    await expect(within(firstData)).resolves.toBe('first production frame')
  })

  it('accepts only the response correlated to its hello request', async () => {
    const { userDataDir, paths } = createUserData('real-token')
    let sawAttach = false

    await serve(paths.endpoint, (request, socket) => {
      if (request.cmd === 'hello') {
        socket.write(
          encodeFrame({
            id: request.id + 10_000,
            ok: true,
            result: { protocolVersion: SESSION_HOST_PROTOCOL_VERSION }
          }) +
            encodeFrame({ id: request.id, ok: false, error: 'unauthorized' })
        )
      } else if (request.cmd === 'attach') {
        sawAttach = true
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { fresh: true, generation: 'generation-refused' }
          })
        )
      }
    })

    const client = new SessionHostClient({ userDataDir })
    const attach = client.attach(
      'nt-refused',
      spawnOptions(userDataDir),
      1_000,
      subscriber()
    )

    await expect(within(attach)).rejects.toThrow('unauthorized')
    expect(sawAttach).toBe(false)
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

  it('rejects an empty token as corruption instead of spawning a competing host', async () => {
    const { userDataDir } = createUserData('   \r\n')
    const client = new SessionHostClient({ userDataDir })

    await expect(within(client.hasSession('nt-empty-token'))).rejects.toThrow(
      'session-host token is empty or whitespace-only'
    )
  })

  it('surfaces a connected hello timeout instead of treating the host as absent', async () => {
    const { userDataDir, paths } = createUserData()
    let resolveHelloSeen!: () => void
    const helloSeen = new Promise<void>((resolve) => {
      resolveHelloSeen = resolve
    })
    await serve(paths.endpoint, (request) => {
      if (request.cmd === 'hello') resolveHelloSeen()
    })

    vi.useFakeTimers()
    const result = clientOutcome(new SessionHostClient({ userDataDir }).hasSession('nt-silent-hello'))
    await helloSeen
    await vi.advanceTimersByTimeAsync(1_999)
    expect(result.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result.promise).resolves.toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        message: 'session-host hello timed out after 2000ms'
      })
    })
  })

  it('surfaces a malformed correlated hello response as a protocol failure', async () => {
    const { userDataDir, paths } = createUserData()
    await serve(paths.endpoint, (request, socket) => {
      if (request.cmd === 'hello') socket.write(encodeFrame({ id: request.id, status: 'maybe' }))
    })

    const client = new SessionHostClient({ userDataDir })
    await expect(within(client.hasSession('nt-bad-hello'))).rejects.toThrow(
      'session-host returned an invalid correlated hello response'
    )
  })
})

describe('SessionHostClient legacy host continuity', () => {
  it('warm-attaches, captures, writes, and receives output without sending a selected spawn plan', async () => {
    const { userDataDir, paths } = createUserData()
    const onData = vi.fn()
    let warmRequest: Extract<SessionHostRequest, { cmd: 'attach' }> | undefined
    let hostSocket: net.Socket | undefined
    let resolveWrite!: () => void
    const writeSeen = new Promise<void>((resolve) => {
      resolveWrite = resolve
    })

    await serve(paths.endpoint, (request, socket) => {
      if (request.cmd === 'hello') {
        socket.write(acceptedLegacyHello(request.id))
      } else if (request.cmd === 'hasSession') {
        socket.write(encodeFrame({ id: request.id, ok: true, result: { exists: true } }))
      } else if (request.cmd === 'attach') {
        warmRequest = request
        hostSocket = socket
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { fresh: false, screen: 'legacy screen' }
          })
        )
      } else if (request.cmd === 'capture') {
        socket.write(
          encodeFrame({ id: request.id, ok: true, result: { text: 'legacy capture' } })
        )
      } else if (request.cmd === 'write') {
        resolveWrite()
        socket.write(encodeFrame({ id: request.id, ok: true }))
      }
    })

    const client = new SessionHostClient({ userDataDir })
    await expect(within(client.hasSession('nt-legacy-warm'))).resolves.toBe(true)
    await expect(
      within(client.attachExisting('nt-legacy-warm', subscriber(onData)))
    ).resolves.toEqual({ fresh: false, screen: 'legacy screen' })
    await expect(within(client.capture('nt-legacy-warm', true))).resolves.toBe('legacy capture')
    client.write('nt-legacy-warm', 'dir\r')
    await within(writeSeen)

    hostSocket?.write(
      encodeFrame({ type: 'data', name: 'nt-legacy-warm', data: 'legacy live output' })
    )
    await vi.waitFor(() => {
      expect(onData).toHaveBeenCalledWith('legacy live output')
    })
    expect(warmRequest).toMatchObject({
      cmd: 'attach',
      name: 'nt-legacy-warm',
      scrollback: 1,
      spawn: {
        cwd: userDataDir,
        shell: process.execPath,
        args: ['-e', 'process.stdout.write("nodeterm legacy warm-only sentinel\\n")'],
        cols: 1,
        rows: 1,
        env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' })
      }
    })
  })

  it('uses only the sentinel and fails closed when a warm v1 session disappears before attach', async () => {
    const { userDataDir, paths } = createUserData()
    const onData = vi.fn()
    let warmRequest: Extract<SessionHostRequest, { cmd: 'attach' }> | undefined

    await serve(paths.endpoint, (request, socket) => {
      if (request.cmd === 'hello') {
        socket.write(acceptedLegacyHello(request.id))
      } else if (request.cmd === 'hasSession') {
        socket.write(encodeFrame({ id: request.id, ok: true, result: { exists: true } }))
      } else if (request.cmd === 'attach') {
        warmRequest = request
        socket.write(
          encodeFrame({
            type: 'data',
            name: request.name,
            data: 'sentinel output must stay hidden'
          }) +
            encodeFrame({ id: request.id, ok: true, result: { fresh: true } })
        )
      }
    })

    const client = new SessionHostClient({ userDataDir })
    await expect(within(client.hasSession('nt-legacy-race'))).resolves.toBe(true)
    await expect(
      within(client.attachExisting('nt-legacy-race', subscriber(onData)))
    ).rejects.toThrow(
      "legacy session-host lost 'nt-legacy-race' before warm attach; no requested shell was spawned"
    )
    expect(onData).not.toHaveBeenCalled()
    expect(warmRequest?.spawn).toMatchObject({
      cwd: userDataDir,
      shell: process.execPath,
      args: ['-e', 'process.stdout.write("nodeterm legacy warm-only sentinel\\n")'],
      cols: 1,
      rows: 1
    })
  })

  it('never sends a selected cold spawn plan to a live legacy host', async () => {
    const { userDataDir, paths } = createUserData()
    const commands: string[] = []
    await serve(paths.endpoint, (request, socket) => {
      commands.push(request.cmd)
      if (request.cmd === 'hello') socket.write(acceptedLegacyHello(request.id))
    })

    const selected: SessionHostSpawnOptions = {
      cwd: 'C:\\selected-project',
      shell: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      args: ['-NoLogo'],
      env: {},
      cols: 80,
      rows: 24
    }
    const client = new SessionHostClient({ userDataDir })
    const outcome = within(
      client.attach('nt-legacy-cold', selected, 1_000, subscriber())
    )
    await expect(outcome).rejects.toBeInstanceOf(SessionHostProtocolCompatibilityError)
    expect(commands).toEqual(['hello'])
  })

  it('never sends a replacement-reservation kill to a live legacy host', async () => {
    const { userDataDir, paths } = createUserData()
    let killRequests = 0
    await serve(paths.endpoint, (request, socket) => {
      if (request.cmd === 'hello') socket.write(acceptedLegacyHello(request.id))
      else if (request.cmd === 'killSession') killRequests++
    })

    const client = new SessionHostClient({ userDataDir })
    const outcome = within(
      client.killSession('nt-legacy-recycle', { reserveReplacement: true })
    )
    await expect(outcome).rejects.toBeInstanceOf(SessionHostProtocolCompatibilityError)
    expect(killRequests).toBe(0)
  })

  it('never sends a direct-target confirmed recycle kill to a live legacy host', async () => {
    const { userDataDir, paths } = createUserData()
    let killRequests = 0
    await serve(paths.endpoint, (request, socket) => {
      if (request.cmd === 'hello') socket.write(acceptedLegacyHello(request.id))
      else if (request.cmd === 'killSession') killRequests++
    })

    const client = new SessionHostClient({ userDataDir })
    const outcome = within(
      client.killSession('nt-legacy-direct-recycle', {
        reserveReplacement: false,
        requireV2: true
      })
    )
    await expect(outcome).rejects.toBeInstanceOf(SessionHostProtocolCompatibilityError)
    expect(killRequests).toBe(0)
  })
})

describe('SessionHostClient socket and generation identity', () => {
  it('ignores a retired socket independently from a stale same-name generation', () => {
    const name = 'nt-generation-aba'
    const onData = vi.fn()
    const onExit = vi.fn()
    const sub: SessionSubscriber = { onData, onExit }
    const client = new SessionHostClient({ userDataDir: 'unused-direct-socket-fixture' })
    const internals = client as unknown as {
      attachSocket(socket: net.Socket, protocolVersion: 1 | 2): void
      subs: Map<string, Set<SessionSubscriber>>
      attachMemory: Map<string, unknown>
      sessionGenerations: Map<string, string>
    }
    internals.subs.set(name, new Set([sub]))
    internals.attachMemory.set(name, {
      kind: 'existing',
      confirmed: true,
      generation: 'generation-new',
      protocolVersion: 2
    })
    internals.sessionGenerations.set(name, 'generation-new')

    const retired = new net.Socket()
    const current = new net.Socket()
    internals.attachSocket(retired, 2)
    internals.attachSocket(current, 2)

    retired.emit(
      'data',
      Buffer.from(
        encodeFrame({
          type: 'data',
          name,
          data: 'retired data',
          generation: 'generation-new'
        }) +
          encodeFrame({
            type: 'exit',
            name,
            exitCode: 9,
            generation: 'generation-new'
          })
      )
    )
    expect(onData).not.toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()
    expect(internals.subs.has(name)).toBe(true)

    current.emit(
      'data',
      Buffer.from(
        encodeFrame({
          type: 'data',
          name,
          data: 'old generation data',
          generation: 'generation-old'
        }) +
          encodeFrame({
            type: 'exit',
            name,
            exitCode: 8,
            generation: 'generation-old'
          })
      )
    )
    expect(onData).not.toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()
    expect(internals.subs.has(name)).toBe(true)

    current.emit(
      'data',
      Buffer.from(
        encodeFrame({
          type: 'data',
          name,
          data: 'current generation data',
          generation: 'generation-new'
        }) +
          encodeFrame({
            type: 'exit',
            name,
            exitCode: 0,
            generation: 'generation-new'
          })
      )
    )
    expect(onData).toHaveBeenCalledWith('current generation data')
    expect(onExit).toHaveBeenCalledWith(0)
    expect(internals.subs.has(name)).toBe(false)
    retired.destroy()
    current.destroy()
  })
})

describe('SessionHostClient attach rollback', () => {
  it('removes a rejected initial attach so reconnect does not replay a ghost subscriber', async () => {
    const { userDataDir, paths } = createUserData()
    const commands = new Map<number, string[]>()
    let closeFirst!: () => void
    const firstClosed = new Promise<void>((resolve) => {
      closeFirst = resolve
    })

    await serve(paths.endpoint, (request, socket, connection) => {
      let connectionCommands = commands.get(connection)
      if (!connectionCommands) {
        connectionCommands = []
        commands.set(connection, connectionCommands)
        if (connection === 1) socket.once('close', closeFirst)
      }
      connectionCommands.push(request.cmd)
      if (request.cmd === 'hello') {
        socket.write(acceptedHello(request.id))
      } else if (request.cmd === 'attach' && connection === 1) {
        socket.write(
          encodeFrame({ id: request.id, ok: false, error: 'initial attach refused' }),
          () => socket.destroy()
        )
      } else if (request.cmd === 'attach') {
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { fresh: false, generation: 'generation-no-ghost' }
          })
        )
      } else if (request.cmd === 'hasSession') {
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { exists: true, generation: 'generation-no-ghost' }
          })
        )
      }
    })

    const client = new SessionHostClient({ userDataDir })
    await expect(
      within(
        client.attach(
          'nt-no-ghost',
          spawnOptions(userDataDir),
          1_000,
          subscriber()
        )
      )
    ).rejects.toThrow('initial attach refused')
    await firstClosed

    await expect(within(client.hasSession('nt-no-ghost'))).resolves.toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(commands.get(2)).toEqual(['hello', 'hasSession'])
  })

  it('rolls back only the failed concurrent attach and replays the survivor attach-only', async () => {
    const { userDataDir, paths } = createUserData()
    const confirmedCwd = path.join(userDataDir, 'confirmed')
    const survivingCwd = path.join(userDataDir, 'surviving')
    const rejectedCwd = path.join(userDataDir, 'rejected')
    let firstSocket: net.Socket | undefined
    let survivingRequestId: number | undefined
    let replayedRequest: SessionHostRequest | undefined
    let resolveReplay!: () => void
    const replayed = new Promise<void>((resolve) => {
      resolveReplay = resolve
    })

    await serve(paths.endpoint, (request, socket, connection) => {
      if (connection === 1) firstSocket = socket
      if (request.cmd === 'hello') {
        socket.write(acceptedHello(request.id))
      } else if (request.cmd === 'attach' && connection === 1) {
        if (request.spawn.cwd === confirmedCwd) {
          socket.write(
            encodeFrame({
              id: request.id,
              ok: true,
              result: { fresh: true, generation: 'generation-concurrent' }
            })
          )
        } else if (request.spawn.cwd === survivingCwd) {
          survivingRequestId = request.id
        } else if (request.spawn.cwd === rejectedCwd) {
          if (survivingRequestId !== undefined) {
            socket.write(
              encodeFrame({
                id: survivingRequestId,
                ok: true,
                result: { fresh: false, generation: 'generation-concurrent' }
              }) + encodeFrame({ id: request.id, ok: false, error: 'concurrent attach refused' })
            )
          } else {
            socket.write(
              encodeFrame({ id: request.id, ok: false, error: 'surviving attach was not sent' })
            )
          }
        }
      } else if (request.cmd === 'attachExisting' && connection === 2) {
        replayedRequest = request
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { fresh: false, generation: 'generation-concurrent' }
          })
        )
        resolveReplay()
      } else if (request.cmd === 'hasSession') {
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { exists: true, generation: 'generation-concurrent' }
          })
        )
      }
    })

    const initialData = vi.fn()
    const survivingData = vi.fn()
    const rejectedData = vi.fn()
    const client = new SessionHostClient({ userDataDir })
    await expect(
      within(
        client.attach(
          'nt-concurrent',
          spawnOptions(confirmedCwd),
          1_000,
          subscriber(initialData)
        )
      )
    ).resolves.toEqual({ fresh: true, generation: 'generation-concurrent' })

    const outcomes = await Promise.allSettled([
      within(
        client.attach(
          'nt-concurrent',
          spawnOptions(survivingCwd),
          2_000,
          subscriber(survivingData)
        )
      ),
      within(
        client.attach(
          'nt-concurrent',
          spawnOptions(rejectedCwd),
          3_000,
          subscriber(rejectedData)
        )
      )
    ])
    expect(outcomes[0]).toMatchObject({ status: 'fulfilled', value: { fresh: false } })
    expect(outcomes[1]).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ message: 'concurrent attach refused' })
    })

    firstSocket?.write(
      encodeFrame({
        type: 'data',
        name: 'nt-concurrent',
        data: 'survivors only',
        generation: 'generation-concurrent'
      })
    )
    await vi.waitFor(() => {
      expect(initialData).toHaveBeenCalledWith('survivors only')
      expect(survivingData).toHaveBeenCalledWith('survivors only')
    })
    expect(rejectedData).not.toHaveBeenCalled()

    const closingSocket = firstSocket
    expect(closingSocket).toBeDefined()
    const firstClosed = new Promise<void>((resolve) => closingSocket?.once('close', resolve))
    closingSocket?.destroy()
    await firstClosed
    await expect(within(client.hasSession('nt-concurrent'))).resolves.toBe(true)
    await within(replayed)
    expect(replayedRequest).toEqual({
      id: expect.any(Number),
      cmd: 'attachExisting',
      name: 'nt-concurrent',
      expectedGeneration: 'generation-concurrent'
    })
    expect(replayedRequest && 'spawn' in replayedRequest).toBe(false)
  })
})

describe('SessionHostClient atomic warm attach and reconnect replay', () => {
  it('fails a probe-to-attach race without sending any spawn plan', async () => {
    const { userDataDir, paths } = createUserData()
    let attachExistingRequest: SessionHostRequest | undefined
    await serve(paths.endpoint, (request, socket) => {
      if (request.cmd === 'hello') {
        socket.write(acceptedHello(request.id))
      } else if (request.cmd === 'hasSession') {
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { exists: true, generation: 'generation-raced' }
          })
        )
      } else if (request.cmd === 'attachExisting') {
        attachExistingRequest = request
        socket.write(
          encodeFrame({ id: request.id, ok: false, error: "no existing session 'nt-raced'" })
        )
      }
    })

    const client = new SessionHostClient({ userDataDir })
    await expect(within(client.hasSession('nt-raced'))).resolves.toBe(true)
    await expect(within(client.attachExisting('nt-raced', subscriber()))).rejects.toThrow(
      "no existing session 'nt-raced'"
    )
    expect(attachExistingRequest).toEqual({
      id: expect.any(Number),
      cmd: 'attachExisting',
      name: 'nt-raced',
      expectedGeneration: 'generation-raced'
    })
    expect(attachExistingRequest && 'spawn' in attachExistingRequest).toBe(false)
  })

  it('returns the existing reconstructed screen without a spawn-capable request', async () => {
    const { userDataDir, paths } = createUserData()
    await serve(paths.endpoint, (request, socket) => {
      if (request.cmd === 'hello') {
        socket.write(acceptedHello(request.id))
      } else if (request.cmd === 'attachExisting') {
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: {
              fresh: false,
              screen: '\u001b[32mexisting screen',
              generation: 'generation-warm'
            }
          })
        )
      }
    })

    const client = new SessionHostClient({ userDataDir })
    await expect(within(client.attachExisting('nt-warm', subscriber()))).resolves.toEqual({
      fresh: false,
      screen: '\u001b[32mexisting screen',
      generation: 'generation-warm'
    })
  })

  it('retires an exact attachment and surfaces the host reason when reconnect replay rejects', async () => {
    const { userDataDir, paths } = createUserData()
    const commands = new Map<number, string[]>()
    const sockets = new Map<number, net.Socket>()
    let resolveReplayError!: (error: Error) => void
    const replayError = new Promise<Error>((resolve) => {
      resolveReplayError = resolve
    })

    await serve(paths.endpoint, (request, socket, connection) => {
      sockets.set(connection, socket)
      const seen = commands.get(connection) ?? []
      seen.push(request.cmd)
      commands.set(connection, seen)
      if (request.cmd === 'hello') {
        socket.write(acceptedHello(request.id))
      } else if (request.cmd === 'attach' && connection === 1) {
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { fresh: true, generation: 'generation-replay-rejected' }
          })
        )
      } else if (request.cmd === 'attachExisting') {
        socket.write(
          encodeFrame({ id: request.id, ok: false, error: 'replay rejected by host' })
        )
      } else if (request.cmd === 'hasSession') {
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { exists: true, generation: 'generation-replay-rejected' }
          })
        )
      }
    })

    const client = new SessionHostClient({ userDataDir })
    await within(
      client.attach('nt-replay-rejected', spawnOptions(userDataDir), 1_000, {
        onData: vi.fn(),
        onExit: vi.fn(),
        onAttachError: resolveReplayError
      })
    )
    sockets.get(1)?.destroy()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await expect(within(client.hasSession('nt-replay-rejected'))).resolves.toBe(true)
    await expect(within(replayError)).resolves.toMatchObject({ message: 'replay rejected by host' })

    sockets.get(2)?.destroy()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await expect(within(client.hasSession('nt-replay-rejected'))).resolves.toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(commands.get(3)).toEqual(['hello', 'hasSession'])
  })

  it('reconstructs the screen when reconnect replay succeeds', async () => {
    const { userDataDir, paths } = createUserData()
    const sockets = new Map<number, net.Socket>()
    const onData = vi.fn()
    const onAttachError = vi.fn()
    await serve(paths.endpoint, (request, socket, connection) => {
      sockets.set(connection, socket)
      if (request.cmd === 'hello') {
        socket.write(acceptedHello(request.id))
      } else if (request.cmd === 'attach' && connection === 1) {
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { fresh: true, generation: 'generation-replay-screen' }
          })
        )
      } else if (request.cmd === 'attachExisting') {
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: {
              fresh: false,
              screen: '\u001b[34mrestored screen',
              generation: 'generation-replay-screen'
            }
          })
        )
      } else if (request.cmd === 'hasSession') {
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { exists: true, generation: 'generation-replay-screen' }
          })
        )
      }
    })

    const client = new SessionHostClient({ userDataDir })
    await within(
      client.attach('nt-replay-screen', spawnOptions(userDataDir), 1_000, {
        onData,
        onExit: vi.fn(),
        onAttachError
      })
    )
    sockets.get(1)?.destroy()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await expect(within(client.hasSession('nt-replay-screen'))).resolves.toBe(true)
    await vi.waitFor(() => {
      expect(onData).toHaveBeenCalledWith('\u001b[2J\u001b[H\u001b[34mrestored screen')
    })
    expect(onAttachError).not.toHaveBeenCalled()
  })
})

describe('SessionHostClient persistent launch requests', () => {
  it('retries the same generation and launch id after an executed reply is lost', async () => {
    const { userDataDir, paths } = createUserData()
    const launchRequests: Array<Extract<SessionHostRequest, { cmd: 'executeLaunch' }>> = []
    await serve(paths.endpoint, (request, socket) => {
      if (request.cmd === 'hello') {
        socket.write(acceptedHello(request.id))
      } else if (request.cmd === 'attach') {
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: {
              fresh: true,
              generation: 'generation-launch-ledger',
              launchDialect: 'pwsh'
            }
          })
        )
      } else if (request.cmd === 'attachExisting') {
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: {
              fresh: false,
              generation: 'generation-launch-ledger',
              launchDialect: 'pwsh'
            }
          })
        )
      } else if (request.cmd === 'executeLaunch') {
        launchRequests.push(request)
        if (launchRequests.length === 1) socket.destroy()
        else {
          socket.write(
            encodeFrame({
              id: request.id,
              ok: true,
              result: { status: 'already-executed' }
            })
          )
        }
      }
    })

    const client = new SessionHostClient({ userDataDir })
    const info = await within(
      client.attach('nt-launch-ledger', spawnOptions(userDataDir), 1_000, subscriber())
    )
    expect(info.launchDialect).toBe('pwsh')
    const launchId = '123e4567-e89b-42d3-a456-426614174000'
    const plan = { command: 'private rendered command', stdinAfterStart: 'private prompt' }
    await expect(within(client.executeLaunch('nt-launch-ledger', launchId, plan))).rejects.toThrow(
      'session-host connection lost'
    )
    await expect(
      within(client.executeLaunch('nt-launch-ledger', launchId, plan))
    ).resolves.toEqual({ status: 'already-executed' })
    expect(launchRequests).toHaveLength(2)
    expect(launchRequests[1]).toMatchObject({
      name: 'nt-launch-ledger',
      generation: 'generation-launch-ledger',
      launchId,
      command: plan.command,
      stdinAfterStart: plan.stdinAfterStart
    })
  })

  it('fails closed before sending an opaque launch to a legacy host', async () => {
    const { userDataDir, paths } = createUserData()
    let launchRequests = 0
    await serve(paths.endpoint, (request, socket) => {
      if (request.cmd === 'hello') socket.write(acceptedLegacyHello(request.id))
      else if (request.cmd === 'hasSession') {
        socket.write(encodeFrame({ id: request.id, ok: true, result: { exists: true } }))
      } else if (request.cmd === 'attach') {
        socket.write(encodeFrame({ id: request.id, ok: true, result: { fresh: false } }))
      } else if (request.cmd === 'executeLaunch') launchRequests++
    })
    const client = new SessionHostClient({ userDataDir })
    await within(client.hasSession('nt-legacy-launch'))
    await within(client.attachExisting('nt-legacy-launch', subscriber()))
    await expect(
      within(
        client.executeLaunch('nt-legacy-launch', '123e4567-e89b-42d3-a456-426614174000', {
          command: 'must never cross legacy wire'
        })
      )
    ).rejects.toBeInstanceOf(SessionHostProtocolCompatibilityError)
    expect(launchRequests).toBe(0)
  })
})

describe('SessionHostClient confirmed kill barrier', () => {
  it('reuses one reserve operation and consumes its token only on the matching fresh attach', async () => {
    const { userDataDir, paths } = createUserData()
    const kills: Array<Extract<SessionHostRequest, { cmd: 'killSession' }>> = []
    const attaches: Array<Extract<SessionHostRequest, { cmd: 'attach' }>> = []
    await serve(paths.endpoint, (request, socket) => {
      if (request.cmd === 'hello') {
        socket.write(acceptedHello(request.id))
      } else if (request.cmd === 'attach') {
        attaches.push(request)
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: {
              fresh: true,
              generation: attaches.length === 1 ? 'generation-reserve-a' : 'generation-reserve-b'
            }
          })
        )
      } else if (request.cmd === 'killSession') {
        kills.push(request)
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { replacementToken: request.operationId }
          })
        )
      }
    })

    const client = new SessionHostClient({ userDataDir })
    await within(client.attach('nt-reserved', spawnOptions(userDataDir), 1_000, subscriber()))
    await within(client.killSession('nt-reserved', { reserveReplacement: true }))
    // Simulate a later source-backend teardown failure: retry must refresh lease A, not invent B.
    await within(client.killSession('nt-reserved', { reserveReplacement: true }))
    await within(
      client.attach(
        'nt-reserved',
        spawnOptions(path.join(userDataDir, 'replacement')),
        1_000,
        subscriber()
      )
    )

    expect(kills).toHaveLength(2)
    expect(kills[0]).toMatchObject({
      expectedGeneration: 'generation-reserve-a',
      reserveReplacement: true,
      operationId: expect.any(String)
    })
    expect(kills[1]).toMatchObject({
      name: kills[0].name,
      operationId: kills[0].operationId,
      expectedGeneration: kills[0].expectedGeneration,
      reserveReplacement: kills[0].reserveReplacement
    })
    expect(attaches[0].replacementToken).toBeUndefined()
    expect(attaches[1].replacementToken).toBe(kills[0].operationId)
    const internals = client as unknown as {
      replacementTokens: Map<string, string>
      killOperations: Map<string, unknown>
    }
    expect(internals.replacementTokens.has('nt-reserved')).toBe(false)
    expect(internals.killOperations.has('nt-reserved')).toBe(false)
  })

  it('replays the same token after a replacement spawn succeeds but its attach reply is lost', async () => {
    const { userDataDir, paths } = createUserData()
    let phase: 'old' | 'reserved' | 'replacement-created' = 'old'
    let replacementSpawns = 0
    const replacementTokens: string[] = []
    let operationId = ''
    await serve(paths.endpoint, (request, socket) => {
      if (request.cmd === 'hello') {
        socket.write(acceptedHello(request.id))
      } else if (request.cmd === 'attach' && phase === 'old') {
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { fresh: true, generation: 'generation-lost-reply-old' }
          })
        )
      } else if (request.cmd === 'killSession') {
        operationId = request.operationId
        phase = 'reserved'
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { replacementToken: request.operationId }
          })
        )
      } else if (request.cmd === 'attach' && phase === 'reserved') {
        replacementTokens.push(request.replacementToken ?? '')
        replacementSpawns++
        phase = 'replacement-created'
        // The host generation exists and owns this token, but the correlated response is lost.
        socket.destroy()
      } else if (request.cmd === 'attach' && phase === 'replacement-created') {
        replacementTokens.push(request.replacementToken ?? '')
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: {
              fresh: true,
              screen: 'screen from the already-created replacement',
              generation: 'generation-lost-reply-new'
            }
          })
        )
      }
    })

    const client = new SessionHostClient({ userDataDir })
    await within(client.attach('nt-lost-reply', spawnOptions(userDataDir), 1_000, subscriber()))
    await within(client.killSession('nt-lost-reply', { reserveReplacement: true }))
    await expect(
      within(
        client.attach(
          'nt-lost-reply',
          spawnOptions(path.join(userDataDir, 'replacement')),
          1_000,
          subscriber()
        ),
        2_000
      )
    ).resolves.toMatchObject({
      fresh: true,
      screen: 'screen from the already-created replacement',
      generation: 'generation-lost-reply-new'
    })
    expect(replacementSpawns).toBe(1)
    expect(replacementTokens).toEqual([operationId, operationId])
  })

  it('keeps generic deletion token-free and probes the current generation before killing', async () => {
    const { userDataDir, paths } = createUserData()
    let killRequest: Extract<SessionHostRequest, { cmd: 'killSession' }> | undefined
    let coldAttach: Extract<SessionHostRequest, { cmd: 'attach' }> | undefined
    await serve(paths.endpoint, (request, socket) => {
      if (request.cmd === 'hello') {
        socket.write(acceptedHello(request.id))
      } else if (request.cmd === 'hasSession') {
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { exists: true, generation: 'generation-current-delete' }
          })
        )
      } else if (request.cmd === 'killSession') {
        killRequest = request
        socket.write(encodeFrame({ id: request.id, ok: true, result: {} }))
      } else if (request.cmd === 'attach') {
        coldAttach = request
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { fresh: true, generation: 'generation-after-delete' }
          })
        )
      }
    })

    const client = new SessionHostClient({ userDataDir })
    await within(client.killSession('nt-generic-delete'))
    await within(
      client.attach('nt-generic-delete', spawnOptions(userDataDir), 1_000, subscriber())
    )
    expect(killRequest).toMatchObject({
      expectedGeneration: 'generation-current-delete',
      reserveReplacement: false,
      operationId: expect.any(String)
    })
    expect(coldAttach?.replacementToken).toBeUndefined()
  })

  it('keeps an expected-absent lease atomic instead of adopting a later generation', async () => {
    const { userDataDir, paths } = createUserData()
    let hasSessionRequests = 0
    const kills: Array<Extract<SessionHostRequest, { cmd: 'killSession' }>> = []
    await serve(paths.endpoint, (request, socket) => {
      if (request.cmd === 'hello') {
        socket.write(acceptedHello(request.id))
      } else if (request.cmd === 'hasSession') {
        hasSessionRequests++
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { exists: true, generation: 'generation-created-by-peer' }
          })
        )
      } else if (request.cmd === 'killSession') {
        kills.push(request)
        socket.write(
          encodeFrame({
            id: request.id,
            ok: false,
            error: 'session became live before its replacement lease was acquired'
          })
        )
      }
    })

    const client = new SessionHostClient({ userDataDir })
    await expect(
      within(
        client.killSession('nt-expected-absent', {
          reserveReplacement: true,
          requireV2: true,
          expectedAbsent: true
        }),
        2_000
      )
    ).rejects.toThrow('remains unconfirmed')
    expect(hasSessionRequests).toBe(0)
    expect(kills).toHaveLength(2)
    expect(kills[0]).toMatchObject({
      expectedGeneration: undefined,
      reserveReplacement: true,
      operationId: expect.any(String)
    })
    expect(kills[1]).toMatchObject({
      operationId: kills[0].operationId,
      expectedGeneration: undefined,
      reserveReplacement: true
    })
  })

  it('never replays a killed target after a lost reply and still restores another session', async () => {
    const { userDataDir, paths } = createUserData()
    let targetExists = true
    const targetReplayCommands: string[] = []
    let otherReplayCount = 0
    let killCount = 0
    let resolveOtherReplay!: () => void
    const otherReplayed = new Promise<void>((resolve) => {
      resolveOtherReplay = resolve
    })

    await serve(paths.endpoint, (request, socket, connection) => {
      if (request.cmd === 'hello') {
        socket.write(acceptedHello(request.id))
      } else if (request.cmd === 'attach') {
        if (connection > 1 && request.name === 'nt-kill-target') {
          targetReplayCommands.push(request.cmd)
          targetExists = true
        }
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { fresh: connection === 1, generation: `generation-${request.name}` }
          })
        )
      } else if (request.cmd === 'attachExisting') {
        if (request.name === 'nt-kill-target') {
          targetReplayCommands.push(request.cmd)
          targetExists = true
        } else if (request.name === 'nt-kill-other') {
          otherReplayCount++
          resolveOtherReplay()
        }
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { fresh: false, generation: `generation-${request.name}` }
          })
        )
      } else if (request.cmd === 'killSession') {
        killCount++
        if (connection === 1) {
          // The destructive operation happened, but its acknowledgement was lost.
          targetExists = false
          socket.destroy()
        } else {
          // Idempotent retry observes absence and confirms it.
          socket.write(encodeFrame({ id: request.id, ok: true, result: {} }))
        }
      }
    })

    const client = new SessionHostClient({ userDataDir })
    await within(
      client.attach(
        'nt-kill-target',
        spawnOptions(path.join(userDataDir, 'old-target-profile')),
        1_000,
        subscriber()
      )
    )
    await within(
      client.attach(
        'nt-kill-other',
        spawnOptions(path.join(userDataDir, 'other-profile')),
        1_000,
        subscriber()
      )
    )

    await expect(within(client.killSession('nt-kill-target'))).resolves.toBeUndefined()
    await within(otherReplayed)
    expect(killCount).toBe(2)
    expect(targetReplayCommands).toEqual([])
    expect(targetExists).toBe(false)
    expect(otherReplayCount).toBe(1)
  })

  it('reconnects and confirms the kill when the first write provably was not sent', async () => {
    const { userDataDir, paths } = createUserData()
    const killRequests: Array<{ connection: number; name: string }> = []
    await serve(paths.endpoint, (request, socket, connection) => {
      if (request.cmd === 'hello') {
        socket.write(acceptedHello(request.id))
      } else if (request.cmd === 'attach') {
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { fresh: true, generation: 'generation-unsent-kill' }
          })
        )
      } else if (request.cmd === 'killSession') {
        killRequests.push({ connection, name: request.name })
        socket.write(encodeFrame({ id: request.id, ok: true, result: {} }))
      }
    })

    const client = new SessionHostClient({ userDataDir })
    await within(
      client.attach('nt-unsent-kill', spawnOptions(userDataDir), 1_000, subscriber())
    )
    const liveSocket = (client as unknown as { socket: net.Socket | null }).socket
    expect(liveSocket).not.toBeNull()
    const writeFailure = new Error('kill write never reached the host')
    vi.spyOn(liveSocket as net.Socket, 'write').mockImplementationOnce(
      ((...args: unknown[]) => {
        const callback = args.find((arg) => typeof arg === 'function') as
          | ((error?: Error | null) => void)
          | undefined
        queueMicrotask(() => {
          callback?.(writeFailure)
          liveSocket?.destroy()
        })
        return false
      }) as net.Socket['write']
    )

    await expect(within(client.killSession('nt-unsent-kill'))).resolves.toBeUndefined()
    expect(killRequests).toEqual([{ connection: 2, name: 'nt-unsent-kill' }])
  })

  it('rejects a concurrent attach while kill confirmation is in progress', async () => {
    const { userDataDir, paths } = createUserData()
    let firstKillSocket: net.Socket | undefined
    let resolveKillSeen!: () => void
    const killSeen = new Promise<void>((resolve) => {
      resolveKillSeen = resolve
    })
    const requestedCwds: string[] = []
    await serve(paths.endpoint, (request, socket, connection) => {
      if (request.cmd === 'hello') {
        socket.write(acceptedHello(request.id))
      } else if (request.cmd === 'attach') {
        requestedCwds.push(request.spawn.cwd)
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { fresh: true, generation: 'generation-killing' }
          })
        )
      } else if (request.cmd === 'killSession' && connection === 1) {
        firstKillSocket = socket
        resolveKillSeen()
      } else if (request.cmd === 'killSession') {
        socket.write(encodeFrame({ id: request.id, ok: true, result: {} }))
      }
    })

    const client = new SessionHostClient({ userDataDir })
    const oldCwd = path.join(userDataDir, 'old-profile')
    const replacementCwd = path.join(userDataDir, 'replacement-profile')
    await within(client.attach('nt-killing', spawnOptions(oldCwd), 1_000, subscriber()))
    const killing = client.killSession('nt-killing')
    await killSeen

    await expect(
      within(client.attach('nt-killing', spawnOptions(replacementCwd), 1_000, subscriber()))
    ).rejects.toThrow("cannot attach 'nt-killing' while its kill result is unconfirmed")
    expect(requestedCwds).toEqual([oldCwd])
    firstKillSocket?.destroy()
    await expect(within(killing)).resolves.toBeUndefined()
  })

  it('keeps replay barred after bounded uncertainty and allows a later explicit kill retry', async () => {
    const { userDataDir, paths } = createUserData()
    let killRequests = 0
    await serve(paths.endpoint, (request, socket) => {
      if (request.cmd === 'hello') {
        socket.write(acceptedHello(request.id))
      } else if (request.cmd === 'attach') {
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { fresh: true, generation: 'generation-uncertain-kill' }
          })
        )
      } else if (request.cmd === 'killSession') {
        killRequests++
        if (killRequests <= 2) socket.destroy()
        else socket.write(encodeFrame({ id: request.id, ok: true, result: {} }))
      }
    })

    const client = new SessionHostClient({ userDataDir })
    await within(client.attach('nt-uncertain-kill', spawnOptions(userDataDir), 1_000, subscriber()))
    await expect(within(client.killSession('nt-uncertain-kill'))).rejects.toThrow(
      "kill of 'nt-uncertain-kill' remains unconfirmed after 2 attempts"
    )
    await expect(
      within(
        client.attach(
          'nt-uncertain-kill',
          spawnOptions(path.join(userDataDir, 'must-not-spawn')),
          1_000,
          subscriber()
        )
      )
    ).rejects.toThrow("cannot attach 'nt-uncertain-kill' while its kill result is unconfirmed")

    await expect(within(client.killSession('nt-uncertain-kill'))).resolves.toBeUndefined()
    expect(killRequests).toBe(3)
  })
})

describe('SessionHostClient request failures', () => {
  it('propagates uncertain capture and kill failures instead of claiming empty or gone', async () => {
    const { userDataDir, paths } = createUserData()

    await serve(paths.endpoint, (request, socket) => {
      if (request.cmd === 'hello') socket.write(acceptedHello(request.id))
      else if (request.cmd === 'hasSession') {
        socket.write(encodeFrame({ id: request.id, ok: true, result: { exists: false } }))
      }
      else if (request.cmd === 'capture' || request.cmd === 'killSession') socket.destroy()
    })

    const client = new SessionHostClient({ userDataDir })
    await expect(within(client.capture('nt-uncertain', true))).rejects.toThrow(
      'session-host connection lost'
    )
    await expect(within(client.killSession('nt-uncertain'))).rejects.toThrow(
      'session-host connection lost'
    )
  })

  it('rejects an asynchronous socket.write failure and clears the pending request', async () => {
    const writeError = new Error('asynchronous write failed')
    const fakeSocket = {
      destroyed: false,
      write: vi.fn((...args: unknown[]) => {
        const callback = args.find((arg) => typeof arg === 'function') as
          | ((error?: Error | null) => void)
          | undefined
        queueMicrotask(() => callback?.(writeError))
        return true
      })
    } as unknown as net.Socket
    const client = new SessionHostClient({ userDataDir: 'unused-for-live-fake-socket' })
    ;(client as unknown as { socket: net.Socket | null }).socket = fakeSocket

    await expect(within(client.capture('nt-write-error', true), 250)).rejects.toBe(writeError)
    expect(fakeSocket.write).toHaveBeenCalledOnce()
    expect((client as unknown as { pending: Map<number, unknown> }).pending.size).toBe(0)
  })

  it('rejects a request that receives no response after the preserved ten-second deadline', async () => {
    const { userDataDir, paths } = createUserData()
    let resolveCaptureSeen!: () => void
    const captureSeen = new Promise<void>((resolve) => {
      resolveCaptureSeen = resolve
    })

    await serve(paths.endpoint, (request, socket) => {
      if (request.cmd === 'hello') {
        socket.write(acceptedHello(request.id))
      } else if (request.cmd === 'hasSession') {
        socket.write(
          encodeFrame({
            id: request.id,
            ok: true,
            result: { exists: true, generation: 'generation-timeout' }
          })
        )
      } else if (request.cmd === 'capture') {
        resolveCaptureSeen()
        // Intentionally stay connected and silent: only the request deadline can settle this.
      }
    })

    const client = new SessionHostClient({ userDataDir })
    await expect(within(client.hasSession('nt-timeout'))).resolves.toBe(true)
    vi.useFakeTimers()
    const capture = client.capture('nt-timeout', true)
    let settled = false
    const outcome = capture.then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason })
    )
    void outcome.then(() => {
      settled = true
    })
    await captureSeen

    await vi.advanceTimersByTimeAsync(9_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const result = await outcome
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected') {
      expect(result.reason).toBeInstanceOf(Error)
      expect((result.reason as Error).message).toContain(
        "session-host: no reply to 'capture' within 10000ms"
      )
    }
    expect(settled).toBe(true)
  })
})
