import { describe, it, expect } from 'vitest'
import { parseWslOnlineList, listAvailableWslDistributions } from './catalog'
import { ONLINE_LIST_FIXTURE, STATUS_OK, utf16leFixture, fakeWslRuntime } from './__fixtures__'

describe('parseWslOnlineList', () => {
  it('parses the real fixture into every row wsl.exe reported, not a hardcoded subset', () => {
    const rows = parseWslOnlineList(ONLINE_LIST_FIXTURE.stdout)
    expect(rows.map((r) => r.name)).toEqual([
      'Ubuntu',
      'Debian',
      'kali-linux',
      'Ubuntu-18.04',
      'Ubuntu-20.04',
      'Ubuntu-22.04',
      'Ubuntu-24.04',
      'OracleLinux_7_9',
      'OracleLinux_8_7',
      'OracleLinux_9_1',
      'openSUSE-Leap-15.6',
      'SUSE-Linux-Enterprise-15-SP6',
      'openSUSE-Tumbleweed'
    ])
    expect(rows[1]).toEqual({ name: 'Debian', friendlyName: 'Debian GNU/Linux' })
  })

  it('returns an empty list for empty output', () => {
    expect(parseWslOnlineList(Buffer.alloc(0))).toEqual([])
  })

  it('throws when the header row is missing', () => {
    const raw = utf16leFixture('Ubuntu   Ubuntu\r\n')
    expect(() => parseWslOnlineList(raw)).toThrow(/header/i)
  })

  it('deduplicates a name repeated with different casing, keeping the first', () => {
    const raw = utf16leFixture(
      [
        'NAME                                   FRIENDLY NAME',
        'Ubuntu                                 Ubuntu',
        'ubuntu                                 Ubuntu (dup)'
      ].join('\r\n') + '\r\n'
    )
    expect(parseWslOnlineList(raw)).toEqual([{ name: 'Ubuntu', friendlyName: 'Ubuntu' }])
  })
})

describe('listAvailableWslDistributions', () => {
  it('reports ok:false, not an empty catalog, when WSL is not installed', async () => {
    const runtime = fakeWslRuntime({ wslExePath: null })
    const result = await listAvailableWslDistributions(runtime)
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/not installed/i) })
  })

  it('reports ok:false when the online list command fails', async () => {
    const runtime = fakeWslRuntime({
      responses: { '--status': STATUS_OK }
    })
    const result = await listAvailableWslDistributions(runtime)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/could not be fetched/i)
  })

  it('returns the full parsed catalog on success', async () => {
    const runtime = fakeWslRuntime({
      responses: {
        '--status': STATUS_OK,
        '--list --online': ONLINE_LIST_FIXTURE
      }
    })
    const result = await listAvailableWslDistributions(runtime)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.available.length).toBe(13)
  })
})
