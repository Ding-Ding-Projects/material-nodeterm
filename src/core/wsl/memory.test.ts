import { describe, it, expect } from 'vitest'
import { readWslDistributionMemory } from './memory'
import { fakeWslRuntime, utf8Fixture } from './__fixtures__'
import type { WslInstalledDistribution } from './enumerate'

function distro(overrides: Partial<WslInstalledDistribution> = {}): WslInstalledDistribution {
  return { name: 'my-project', state: 'running', isDefault: false, version: 2, owned: true, ...overrides }
}

describe('readWslDistributionMemory', () => {
  it('reports ok:false, not an empty report, when WSL is unavailable', async () => {
    const runtime = fakeWslRuntime()
    const result = await readWslDistributionMemory(runtime, null, [distro()])
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/not installed/i) })
  })

  it('a stopped distribution is measured:false with no error (there is nothing to read, not a failure)', async () => {
    const runtime = fakeWslRuntime()
    const result = await readWslDistributionMemory(runtime, 'C:\\Windows\\System32\\wsl.exe', [
      distro({ name: 'docker-desktop', state: 'stopped', owned: false })
    ])
    expect(result).toEqual({
      ok: true,
      rows: [{ name: 'docker-desktop', state: 'stopped', owned: false, measured: false }]
    })
    // A stopped distribution's memory is never probed, exactly because there is no guest kernel
    // running inside it to ask.
    expect(runtime.calls).toEqual([])
  })

  it('reads real guest /proc/meminfo for a running distribution and computes used from total-available', async () => {
    const runtime = fakeWslRuntime({
      responses: {
        '-d my-project -- cat /proc/meminfo': {
          stdout: utf8Fixture('MemTotal:       16384000 kB\nMemFree:         2000000 kB\nMemAvailable:    4000000 kB\n'),
          stderr: Buffer.alloc(0),
          exitCode: 0
        }
      }
    })
    const result = await readWslDistributionMemory(runtime, 'C:\\Windows\\System32\\wsl.exe', [distro()])
    expect(result).toEqual({
      ok: true,
      rows: [
        {
          name: 'my-project',
          state: 'running',
          owned: true,
          measured: true,
          totalKb: 16384000,
          availableKb: 4000000,
          usedKb: 12384000
        }
      ]
    })
    expect(runtime.calls).toEqual([['-d', 'my-project', '--', 'cat', '/proc/meminfo']])
  })

  it('a running distribution whose guest read fails is measured:false with an error, not an ok:false report', async () => {
    const runtime = fakeWslRuntime({ responses: {} })
    const result = await readWslDistributionMemory(runtime, 'C:\\Windows\\System32\\wsl.exe', [
      distro({ name: 'docker-desktop', owned: false })
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.rows).toEqual([
        { name: 'docker-desktop', state: 'running', owned: false, measured: false, error: expect.any(String) }
      ])
    }
  })

  it('handles a report mixing an owned running distribution and an unowned stopped one', async () => {
    const runtime = fakeWslRuntime({
      responses: {
        '-d my-project -- cat /proc/meminfo': {
          stdout: utf8Fixture('MemTotal:       1000 kB\nMemAvailable:    500 kB\n'),
          stderr: Buffer.alloc(0),
          exitCode: 0
        }
      }
    })
    const result = await readWslDistributionMemory(runtime, 'C:\\Windows\\System32\\wsl.exe', [
      distro(),
      distro({ name: 'ding-pbx-console', state: 'stopped', owned: false })
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.rows.map((r) => r.name)).toEqual(['my-project', 'ding-pbx-console'])
      expect(result.rows[1]).toEqual({
        name: 'ding-pbx-console',
        state: 'stopped',
        owned: false,
        measured: false
      })
    }
  })
})
