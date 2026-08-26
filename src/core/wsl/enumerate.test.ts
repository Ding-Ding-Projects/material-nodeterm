import { describe, it, expect } from 'vitest'
import { listInstalledWslDistributions, wslNameCollides } from './enumerate'
import { fakeWslRuntime, STATUS_OK, VERBOSE_LIST_FIXTURE } from './__fixtures__'
import { inMemoryWslOwnershipStore } from './ownership'

describe('listInstalledWslDistributions', () => {
  it('reports ok:false, not an empty installed list, when WSL is not installed', async () => {
    const runtime = fakeWslRuntime({ wslExePath: null })
    const result = await listInstalledWslDistributions(runtime, inMemoryWslOwnershipStore())
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/not installed/i),
      wslInstalled: false
    })
  })

  it('reports ok:false with wslInstalled:true when the list command itself fails', async () => {
    const runtime = fakeWslRuntime({ responses: { '--status': STATUS_OK } })
    const result = await listInstalledWslDistributions(runtime, inMemoryWslOwnershipStore())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.wslInstalled).toBe(true)
      expect(result.error).toMatch(/could not be listed/i)
    }
  })

  it('marks nodeterm-created distributions owned:true and every other real distribution owned:false', async () => {
    const runtime = fakeWslRuntime({
      responses: {
        '--status': STATUS_OK,
        '--list --verbose': VERBOSE_LIST_FIXTURE
      }
    })
    const ownership = inMemoryWslOwnershipStore(['Ubuntu'])
    const result = await listInstalledWslDistributions(runtime, ownership)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.installed).toEqual([
        { name: 'Ubuntu', state: 'running', isDefault: true, version: 2, owned: true },
        { name: 'docker-desktop', state: 'stopped', isDefault: false, version: 2, owned: false },
        { name: 'my-old-distro', state: 'stopped', isDefault: false, version: 1, owned: false }
      ])
    }
  })

  it('reports every real distribution as unowned when the ownership ledger is empty', async () => {
    const runtime = fakeWslRuntime({
      responses: {
        '--status': STATUS_OK,
        '--list --verbose': VERBOSE_LIST_FIXTURE
      }
    })
    const result = await listInstalledWslDistributions(runtime, inMemoryWslOwnershipStore())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.installed.every((d) => d.owned === false)).toBe(true)
  })
})

describe('wslNameCollides', () => {
  it('is case-insensitive', () => {
    expect(wslNameCollides([{ name: 'Ubuntu' }], 'ubuntu')).toBe(true)
    expect(wslNameCollides([{ name: 'Ubuntu' }], 'Debian')).toBe(false)
  })

  it('catches a collision against a real, unowned distribution', () => {
    expect(wslNameCollides([{ name: 'docker-desktop' }], 'docker-desktop')).toBe(true)
  })
})
