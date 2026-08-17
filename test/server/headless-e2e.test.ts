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
    const sentinel = net.createServer()
    const scheduledStop = vi.spyOn(ScheduledSettingsService.prototype, 'stop')
    let srv: Awaited<ReturnType<typeof startServer>> | undefined
    try {
      // Hold the configured port open for the whole boot. If headless mode ever tries to bind its
      // public listener, startServer fails with EADDRINUSE. A fixed "probably unused" port can be
      // owned by Docker or another local service and falsely attribute that listener to nodeterm.
      await new Promise<void>((resolve, reject) => {
        sentinel.once('error', reject)
        sentinel.listen(0, '127.0.0.1', () => {
          sentinel.off('error', reject)
          resolve()
        })
      })
      const occupiedPort = (sentinel.address() as net.AddressInfo).port
      srv = await startServer({
        port: occupiedPort,
        host: '127.0.0.1',
        dataDir,
        rendererDir: path.join(dataDir, 'no-renderer'),
        insecureHttp: false,
        headless: true,
        // Never touch the developer's real ~/.claude — the hook would point into `dataDir`,
        // which the teardown removes, leaving a dangling hook that breaks agent sessions.
        installHooks: false
      })
      // Nothing public was bound: headless returns its documented port-0 sentinel.
      expect(srv.port).toBe(0)
      expect(sentinel.listening).toBe(true)

      // Release the sentinel after boot, while the headless server is still alive, so the
      // configured port can be probed without confusing the sentinel for a public listener.
      await new Promise<void>((resolve, reject) => {
        sentinel.close((error) => (error ? reject(error) : resolve()))
      })
      // The configured port is NOT listening — a connect attempt is refused.
      const listening = await new Promise<boolean>((resolve) => {
        const sock = net
          .connect({ host: '127.0.0.1', port: occupiedPort }, () => {
            sock.destroy()
            resolve(true)
          })
          .on('error', () => resolve(false))
        sock.setTimeout(500, () => {
          sock.destroy()
          resolve(false)
        })
      })
      expect(listening).toBe(false)
      await srv.close()
      srv = undefined
      // Headless starts the same scheduled-settings interval as the serving shell. Its separate
      // early return must stop that interval too; otherwise repeated in-process starts leak one
      // timer + store subscription each even though close() appears to resolve successfully.
      expect(scheduledStop).toHaveBeenCalledTimes(1)
    } finally {
      await srv?.close()
      if (sentinel.listening) {
        await new Promise<void>((resolve) => sentinel.close(() => resolve()))
      }
      scheduledStop.mockRestore()
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  }, 30_000)
})
