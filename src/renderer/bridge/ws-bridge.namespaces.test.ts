import { afterEach, describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildFilesApi,
  buildRealApi,
  buildServerFilesApi,
  buildSessionMemoryApi,
  saveUploadBlobOverHttp,
  saveUploadOverHttp
} from './ws-bridge'
import { IPC } from '../../shared/ipc'
import {
  UPLOAD_MAX_BASE64_CHARS,
  UPLOAD_MAX_BYTES,
  UPLOAD_TOO_LARGE_MESSAGE
} from '../../shared/uploads'

function patternedBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = (i * 31 + (i >>> 8) * 17 + (i >>> 16) * 7 + 0x53) & 0xff
  }
  return bytes
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function sha256Blob(blob: Blob): Promise<string> {
  const hash = createHash('sha256')
  const reader = blob.stream().getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return hash.digest('hex')
    hash.update(value)
  }
}

function fakeClient() {
  const calls: Array<{ kind: string; method: string; args: unknown[] }> = []
  return {
    calls,
    request: (method: string, ...args: unknown[]) => {
      calls.push({ kind: 'request', method, args })
      return Promise.resolve('R')
    },
    cast: (method: string, ...args: unknown[]) => calls.push({ kind: 'cast', method, args }),
    subscribe: (channel: string, _fn: (...a: unknown[]) => void) => {
      calls.push({ kind: 'subscribe', method: channel, args: [] })
      return () => {}
    }
  }
}

describe('buildFilesApi', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fs/git/files members are request-shaped with the right channels', async () => {
    const c = fakeClient()
    const api = buildFilesApi(c as never)
    await api.fs.read('/x')
    await api.git.status('/repo')
    await api.git.showFile('/repo', 'HEAD', 'a.txt')
    await api.files.quickOpen('/repo')
    expect(c.calls).toEqual([
      { kind: 'request', method: IPC.fsRead, args: ['/x'] },
      { kind: 'request', method: IPC.gitStatus, args: ['/repo'] },
      { kind: 'request', method: IPC.gitShowFile, args: ['/repo', 'HEAD', 'a.txt'] },
      { kind: 'request', method: IPC.filesQuickOpen, args: ['/repo'] }
    ])
  })
  it('context.ensure is a cast; context.onUpdate/git.onCloneProgress subscribe', () => {
    const c = fakeClient()
    const api = buildFilesApi(c as never)
    api.context.ensure('sid', '/cwd', undefined)
    const un = api.context.onUpdate(() => {})
    const un2 = api.git.onCloneProgress(() => {})
    expect(c.calls[0]).toEqual({ kind: 'cast', method: IPC.contextEnsure, args: ['sid', '/cwd', undefined] })
    expect(c.calls[1]).toEqual({ kind: 'subscribe', method: IPC.contextUpdate, args: [] })
    expect(c.calls[2]).toEqual({ kind: 'subscribe', method: IPC.gitCloneProgress, args: [] })
    expect(typeof un).toBe('function')
    expect(typeof un2).toBe('function')
  })

  it('passes an exact 7 MiB Blob to authenticated HTTP without reading or making an RPC call', async () => {
    const c = fakeClient()
    const bytes = patternedBytes(7 * 1024 * 1024)
    const expectedHash = sha256(bytes)
    const raw = new Blob([bytes])
    const arrayBuffer = vi.spyOn(raw, 'arrayBuffer')
    const fetchUpload = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      expect(init?.credentials).toBe('same-origin')
      expect(init?.headers).toEqual({
        'Content-Type': 'application/octet-stream'
      })
      const body = init?.body as Blob
      expect(body).toBe(raw)
      expect(body.size).toBe(7 * 1024 * 1024)
      expect(await sha256Blob(body)).toBe(expectedHash)
      return new Response(JSON.stringify({ path: '/srv/uploads/token/file.bin' }), {
        status: 201,
        headers: { 'content-type': 'application/json' }
      })
    })
    vi.stubGlobal('fetch', fetchUpload)
    const api = buildServerFilesApi(c as never)

    expect(api.files.saveUploadBlob).toBeTypeOf('function')
    await expect(api.files.saveUploadBlob!('file.bin', raw)).resolves.toBe('/srv/uploads/token/file.bin')
    expect(fetchUpload).toHaveBeenCalledWith('/upload?name=file.bin', expect.any(Object))
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(c.calls).toEqual([])
  })

  it('preserves non-repeating legacy bytes when Server Edition base64 uses HTTP', async () => {
    const c = fakeClient()
    const bytes = patternedBytes(256 * 1024 + 13)
    const expectedHash = sha256(bytes)
    const fetchUpload = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body as Uint8Array
      expect(body).toBeInstanceOf(Uint8Array)
      expect(body.byteLength).toBe(bytes.byteLength)
      expect(sha256(body)).toBe(expectedHash)
      return new Response(JSON.stringify({ path: '/srv/uploads/token/legacy.bin' }), {
        status: 201,
        headers: { 'content-type': 'application/json' }
      })
    })
    vi.stubGlobal('fetch', fetchUpload)
    const api = buildServerFilesApi(c as never)

    await expect(api.files.saveUpload('legacy.bin', Buffer.from(bytes).toString('base64'))).resolves.toBe(
      '/srv/uploads/token/legacy.bin'
    )
    expect(fetchUpload).toHaveBeenCalledTimes(1)
    expect(c.calls).toEqual([])
  })

  it('refuses empty and oversized Blobs before fetch or a byte read', async () => {
    const fetchUpload = vi.fn()
    const emptyRead = vi.fn()
    const oversizedRead = vi.fn()
    const empty = { size: 0, arrayBuffer: emptyRead } as unknown as Blob
    const oversized = {
      size: UPLOAD_MAX_BYTES + 1,
      arrayBuffer: oversizedRead
    } as unknown as Blob

    await expect(saveUploadBlobOverHttp('empty.bin', empty, fetchUpload)).resolves.toBeNull()
    await expect(saveUploadBlobOverHttp('oversized.bin', oversized, fetchUpload)).rejects.toThrow(
      UPLOAD_TOO_LARGE_MESSAGE
    )
    expect(emptyRead).not.toHaveBeenCalled()
    expect(oversizedRead).not.toHaveBeenCalled()
    expect(fetchUpload).not.toHaveBeenCalled()
  })

  it('accepts a Blob at exactly 64 MiB without reading it in application JavaScript', async () => {
    const boundary = {
      size: UPLOAD_MAX_BYTES,
      arrayBuffer: vi.fn(() => Promise.reject(new Error('boundary Blob must stay unread')))
    } as unknown as Blob
    const fetchUpload = vi.fn(async () =>
      new Response(JSON.stringify({ path: '/srv/uploads/token/boundary.bin' }), {
        status: 201,
        headers: { 'content-type': 'application/json' }
      })
    )

    await expect(saveUploadBlobOverHttp('boundary.bin', boundary, fetchUpload)).resolves.toBe(
      '/srv/uploads/token/boundary.bin'
    )
    expect(fetchUpload).toHaveBeenCalledWith(
      '/upload?name=boundary.bin',
      expect.objectContaining({ body: boundary })
    )
    expect(boundary.arrayBuffer).not.toHaveBeenCalled()
  })

  it('refuses oversized legacy base64 before atob or fetch', async () => {
    const decode = vi.fn(() => {
      throw new Error('atob must not receive an over-limit value')
    })
    const fetchUpload = vi.fn()
    vi.stubGlobal('atob', decode)
    // The encoded input already exists at this boundary. The guard must inspect its cheap string
    // length and stop before allocating the additional decoded binary string and Uint8Array.
    const oversized = 'A'.repeat(UPLOAD_MAX_BASE64_CHARS + 1)

    await expect(saveUploadOverHttp('oversized.bin', oversized, fetchUpload)).rejects.toThrow(
      UPLOAD_TOO_LARGE_MESSAGE
    )
    expect(decode).not.toHaveBeenCalled()
    expect(fetchUpload).not.toHaveBeenCalled()
  })

  it('refuses malformed legacy base64 before fetch', async () => {
    const fetchUpload = vi.fn()
    await expect(saveUploadOverHttp('broken.bin', '%%%not-base64%%%', fetchUpload)).rejects.toThrow(
      'could not be decoded'
    )
    expect(fetchUpload).not.toHaveBeenCalled()
  })

  it('surfaces the server 64 MiB refusal as a specific thrown message', async () => {
    const refused = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: 'too_large',
            message: 'File exceeds the 64 MiB upload limit.',
            maxBytes: 64 * 1024 * 1024
          }),
          { status: 413, headers: { 'content-type': 'application/json' } }
        )
    )
    await expect(
      saveUploadOverHttp('large.bin', Buffer.from('small transport fixture').toString('base64'), refused)
    ).rejects.toThrow('File exceeds the 64 MiB upload limit.')
  })

  it('keeps relay uploads on the remote RPC carrier instead of viewer-local HTTP', async () => {
    const c = fakeClient()
    const api = buildFilesApi(c as never)
    expect('saveUploadBlob' in api.files).toBe(false)
    await api.files.saveUpload('relay.bin', 'cmVsYXk=')
    expect(c.calls).toEqual([
      {
        kind: 'request',
        method: IPC.filesSaveUpload,
        args: ['relay.bin', 'cmVsYXk=']
      }
    ])
  })
})

describe('buildRealApi: workspace', () => {
  // The server DOES serve workspace:probe-folder (WorkspaceStore.registerIpc, src/core). Stubbing
  // it to `null` in the browser told "Open folder…" that a repo carrying a committed
  // .nodeterm/project.json had no project in it — so addProjectFromFolder created an empty one and
  // the next writeDisk() overwrote the team's shared canvas. It must hit the real channel.
  it('probeFolder requests the real server channel (never a null stub)', async () => {
    const c = fakeClient()
    const api = buildRealApi(c as never)
    await api.workspace.probeFolder('/repo')
    expect(c.calls).toEqual([
      { kind: 'request', method: IPC.workspaceProbeFolder, args: ['/repo'] }
    ])
  })

  it('onMigrated subscribes to the channel core actually broadcasts', () => {
    const c = fakeClient()
    const api = buildRealApi(c as never)
    const un = api.workspace.onMigrated(() => {})
    expect(c.calls[0]).toEqual({ kind: 'subscribe', method: IPC.workspaceMigrated, args: [] })
    expect(typeof un).toBe('function')
  })

  it('onCorruptRecovered subscribes to the channel core actually broadcasts', () => {
    const c = fakeClient()
    const api = buildRealApi(c as never)
    const un = api.workspace.onCorruptRecovered(() => {})
    expect(c.calls[0]).toEqual({ kind: 'subscribe', method: IPC.workspaceCorruptRecovered, args: [] })
    expect(typeof un).toBe('function')
  })
})

describe('buildRealApi: private Windows launch intent boundary', () => {
  it('does not expose delayed launch execution on the Server Edition WebSocket API', () => {
    const c = fakeClient()
    const api = buildRealApi(c as never)

    expect(api.pty.executeLaunchIntent).toBeUndefined()
    expect('executeLaunchIntent' in api.pty).toBe(false)
    expect(c.calls).toEqual([])
  })
})

describe('buildRealApi: host platform', () => {
  it('requests pty destroy and propagates a rejected server acknowledgement', async () => {
    const c = fakeClient()
    c.request = (method: string, ...args: unknown[]) => {
      c.calls.push({ kind: 'request', method, args })
      return Promise.reject(new Error('session host outcome unknown'))
    }
    const api = buildRealApi(c as never)

    await expect(api.pty.destroy('node-1', { everySocket: true })).rejects.toThrow(
      'session host outcome unknown'
    )
    expect(c.calls).toEqual([
      { kind: 'request', method: IPC.ptyDestroy, args: ['node-1', true] }
    ])
  })

  it('requests pty recycle and propagates a rejected server acknowledgement', async () => {
    const c = fakeClient()
    c.request = (method: string, ...args: unknown[]) => {
      c.calls.push({ kind: 'request', method, args })
      return Promise.reject(new Error('recycle outcome unknown'))
    }
    const api = buildRealApi(c as never)

    await expect(api.pty.recycle('node-2')).rejects.toThrow('recycle outcome unknown')
    expect(c.calls).toEqual([
      { kind: 'request', method: IPC.ptyRecycle, args: ['node-2'] }
    ])
  })

  it('keeps a failed host read unknown instead of inventing Linux from the browser bridge', async () => {
    const c = fakeClient()
    c.request = (method: string, ...args: unknown[]) => {
      c.calls.push({ kind: 'request', method, args })
      return Promise.reject(new Error('server unavailable'))
    }
    const api = buildRealApi(c as never)

    await expect(api.pty.tmuxStatus()).resolves.toEqual({
      available: true,
      installCommand: null,
      installLabel: null,
      platform: null
    })
  })
})

describe('buildRealApi: sessionMemory', () => {
  // A real WS namespace, not a stub: the same core service (`startSessionMemoryService`) registers
  // both channels in the server shell, so the browser gets a genuine per-session breakdown of the
  // machine it is served from.
  it('read/host hit the real channels', async () => {
    const c = fakeClient()
    const api = buildSessionMemoryApi(c as never)
    await api.sessionMemory.read()
    await api.sessionMemory.host()
    expect(c.calls.map((x) => ({ kind: x.kind, method: x.method }))).toEqual([
      { kind: 'request', method: IPC.sessionMemory },
      { kind: 'request', method: IPC.sessionMemoryHost }
    ])
  })

  // The query is the ONLY thing that decides which machine answers: `projectId` names the scope and
  // `remote` is the renderer's own "this scope is an SSH host" claim, which the service ORs with its
  // own `isRemoteProject`. A layer that drops or rewrites either one turns a remote query into a
  // LOCAL sweep, and the panel publishes this machine's sessions under the host's name. So the
  // query must arrive at the RPC call byte-identical, on BOTH channels.
  it('passes projectId and the remote flag through unmodified', async () => {
    const c = fakeClient()
    const api = buildSessionMemoryApi(c as never)
    const q = { projectId: 'p1', remote: true }
    await api.sessionMemory.read(q)
    await api.sessionMemory.host(q)
    expect(c.calls).toEqual([
      { kind: 'request', method: IPC.sessionMemory, args: [{ projectId: 'p1', remote: true }] },
      { kind: 'request', method: IPC.sessionMemoryHost, args: [{ projectId: 'p1', remote: true }] }
    ])
  })

  // `remote: false` is a claim too ("the renderer says this is NOT an SSH scope"), and it must not
  // be normalized away into `undefined` — the shell's own predicate still gets to say otherwise,
  // but the renderer's answer has to reach it as written.
  it('keeps an explicit remote:false', async () => {
    const c = fakeClient()
    const api = buildSessionMemoryApi(c as never)
    await api.sessionMemory.read({ projectId: 'p2', remote: false })
    expect(c.calls[0].args).toEqual([{ projectId: 'p2', remote: false }])
  })

  // The builder above is dead code unless it is actually spread into the assembled api. It cannot
  // be caught by the compiler: `buildStubApi()` already supplies a `sessionMemory`, so dropping the
  // spread leaves `NodeTerminalApi` satisfied and the STUB silently wins in every live browser
  // session. installWsBridge needs a socket + DOM to run, so the wiring is pinned by source text.
  it('is spread into the assembled window.nodeTerminal', () => {
    const src = readFileSync(join(__dirname, 'ws-bridge.ts'), 'utf8')
    const install = src.slice(src.indexOf('export async function installWsBridge'))
    expect(install).toContain('...buildSessionMemoryApi(client)')
  })
})
