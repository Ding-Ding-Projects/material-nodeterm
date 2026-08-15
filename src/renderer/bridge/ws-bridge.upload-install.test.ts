// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { installWsBridge } from './ws-bridge'

class OpenWebSocket extends EventTarget {
  binaryType = ''

  constructor(_url: string | URL) {
    super()
    queueMicrotask(() => this.dispatchEvent(new Event('open')))
  }

  send(_data: string): void {}
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('installed Server Edition upload capability', () => {
  it('installs the raw Blob carrier on the live window API', async () => {
    vi.stubGlobal('WebSocket', OpenWebSocket)
    const body = new Blob([new Uint8Array([0x13, 0x37, 0x42])])
    const fetchUpload = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.body).toBe(body)
      return new Response(JSON.stringify({ path: '/srv/uploads/token/live.bin' }), {
        status: 201,
        headers: { 'content-type': 'application/json' }
      })
    })
    vi.stubGlobal('fetch', fetchUpload)

    await expect(installWsBridge()).resolves.toBe(true)
    expect(window.nodeTerminal.files.saveUploadBlob).toBeTypeOf('function')
    await expect(window.nodeTerminal.files.saveUploadBlob!('live.bin', body)).resolves.toBe(
      '/srv/uploads/token/live.bin'
    )
    expect(fetchUpload).toHaveBeenCalledWith('/upload?name=live.bin', expect.any(Object))
  })
})
