import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import net from 'net'
import { startServer } from '../../src/server/index'
import { ScheduledSettingsService } from '../../src/core/scheduled-settings-service'

// Headless notification-host boot smoke: every core service (incl. the loopback hook server) boots,
// but NO public HTTP/WS listener is bound. Follows the same startServer harness as server-e2e, minus
// tmux/pty (nothing is spawned here), so it runs everywhere.
describe('server headless mode: boots core services, binds no public listener', () => {
  it('startServer with headless:true returns port 0 and closes cleanly', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-headless-'))
    const scheduledStop = vi.spyOn(ScheduledSettingsService.prototype, 'stop')
    const occupiedPort = net.createServer()
    await new Promise<void>((resolve, reject) => {
      occupiedPort.once('error', reject)
      occupiedPort.listen(0, '127.0.0.1', () => {
        occupiedPort.off('error', reject)
        resolve()
      })
    })
    let srv: Awaited<ReturnType<typeof startServer>> | undefined
    try {
      const address = occupiedPort.address()
      if (!address || typeof address === 'string') throw new Error('test port did not bind')
      // Keep our private port occupied while headless startup runs. If the public HTTP branch ever
      // starts listening, startup fails with EADDRINUSE; unlike probing a fixed port afterwards,
      // this cannot mistake an unrelated developer service for a nodeterm listener.
      srv = await startServer({
        port: address.port,
        host: '127.0.0.1',
        dataDir,
        rendererDir: path.join(dataDir, 'no-renderer'),
        insecureHttp: false,
        headless: true,
        // Never touch the developer's real ~/.claude — the hook would point into `dataDir`,
        // which the teardown removes, leaving a dangling hook that breaks agent sessions.
        installHooks: false
      })
      // Nothing bound: the sentinel port is 0.
      expect(srv.port).toBe(0)
      await srv.close()
      srv = undefined
      // Headless returns before the normal HTTP/WS close implementation. Its independent close
      // path must still stop this poller or `docker stop`/SIGTERM leaves a live 30s interval and
      // store listener behind while the rest of the host is already torn down.
      expect(scheduledStop).toHaveBeenCalledTimes(1)
    } finally {
      if (srv) await srv.close()
      await new Promise<void>((resolve, reject) => {
        occupiedPort.close((error) => (error ? reject(error) : resolve()))
      })
      scheduledStop.mockRestore()
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  }, 30_000)
})
