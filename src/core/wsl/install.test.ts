import { describe, it, expect } from 'vitest'
import { detectWsl, installWsl } from './install'
import { fakeWslRuntime, STATUS_OK } from './__fixtures__'

describe('detectWsl', () => {
  it('reports not installed when wsl.exe cannot be found at all', async () => {
    const runtime = fakeWslRuntime({ wslExePath: null })
    expect(await detectWsl(runtime)).toEqual({ installed: false, reason: 'wsl-exe-not-found' })
  })

  it('reports not installed when wsl.exe exists but --status fails (feature never enabled)', async () => {
    const runtime = fakeWslRuntime({ responses: {} })
    const result = await detectWsl(runtime)
    expect(result.installed).toBe(false)
    if (!result.installed) expect(result.reason).toBe('command-failed')
  })

  it('reports installed with the resolved wsl.exe path when --status succeeds', async () => {
    const runtime = fakeWslRuntime({ responses: { '--status': STATUS_OK } })
    const result = await detectWsl(runtime)
    expect(result).toEqual({ installed: true, wslExePath: 'C:\\Windows\\System32\\wsl.exe' })
  })
})

describe('installWsl', () => {
  it('refuses when wsl.exe cannot be found', async () => {
    const runtime = fakeWslRuntime({ wslExePath: null })
    const result = await installWsl(runtime)
    expect(result.ok).toBe(false)
    expect(result.requiresReboot).toBe(false)
  })

  it('reports requiresReboot:true on success (a real first-time install always needs one)', async () => {
    const runtime = fakeWslRuntime({
      responses: { '--install --no-launch': { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0 } }
    })
    const result = await installWsl(runtime)
    expect(result).toEqual({ ok: true, requiresReboot: true })
  })

  it('reports requiresReboot:true even on failure (partial progress may still need one)', async () => {
    const runtime = fakeWslRuntime({ responses: {} })
    const result = await installWsl(runtime)
    expect(result.ok).toBe(false)
    expect(result.requiresReboot).toBe(true)
  })

  it('never mutates a real distribution: only ever calls --install, nothing distribution-scoped', async () => {
    const runtime = fakeWslRuntime({
      responses: { '--install --no-launch': { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0 } }
    })
    await installWsl(runtime)
    expect(runtime.calls).toEqual([['--install', '--no-launch']])
  })
})
