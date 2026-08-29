import { describe, expect, it } from 'vitest'
import { ensureJavaRuntime, parseJavaMajorVersion } from './java'

describe('parseJavaMajorVersion', () => {
  it('reads the modern (Java 9+) three-part scheme', () => {
    expect(
      parseJavaMajorVersion('openjdk version "17.0.2" 2022-01-18\nOpenJDK Runtime Environment (build 17.0.2+8-86)')
    ).toBe(17)
  })

  it('reads a bare modern major with no minor/patch (e.g. Java 21, 25)', () => {
    expect(parseJavaMajorVersion('openjdk version "21" 2023-09-19')).toBe(21)
    expect(parseJavaMajorVersion('java version "25" 2025-09-16')).toBe(25)
  })

  it('reads the legacy 1.x scheme, where the major is the SECOND dotted component', () => {
    expect(parseJavaMajorVersion('java version "1.8.0_301"\nJava(TM) SE Runtime Environment')).toBe(8)
  })

  it('is case/vendor agnostic (openjdk vs java, oracle-style banners)', () => {
    expect(parseJavaMajorVersion('java version "1.8.0_202"')).toBe(8)
    expect(parseJavaMajorVersion('openjdk version "11.0.20" 2023-07-18')).toBe(11)
  })

  it('returns null rather than guessing on unrecognizable output', () => {
    // A wrong major fed into checkJavaCompatibility would produce a confidently wrong verdict,
    // which is worse than an honestly unknown one — so anything that doesn't match is refused.
    expect(parseJavaMajorVersion('')).toBeNull()
    expect(parseJavaMajorVersion('command not found')).toBeNull()
    expect(parseJavaMajorVersion('bash: java: command not found')).toBeNull()
    expect(parseJavaMajorVersion('version banner with no quoted version at all')).toBeNull()
  })
})

describe('ensureJavaRuntime', () => {
  it('reuses a compatible runtime without making a network request', async () => {
    let fetched = false
    const probe = await ensureJavaRuntime({
      userDataDir: 'unused',
      requiredMajor: 25,
      detect: async () => ({ path: 'C:/Java/bin/java.exe', major: 25 }),
      fetchJson: async () => {
        fetched = true
        return []
      }
    })
    expect(probe).toEqual({ path: 'C:/Java/bin/java.exe', major: 25 })
    expect(fetched).toBe(false)
  })

  it('never consults the platform when an already-compatible Java is detected, even off Windows', async () => {
    // Auto-install is Windows-only, but "does this machine already have Java?" is a question every
    // platform can answer. Checking the platform first meant a macOS/Linux machine with a perfectly
    // good Java on PATH was refused with "Windows only" instead of just being left alone.
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    try {
      const probe = await ensureJavaRuntime({
        userDataDir: 'unused',
        requiredMajor: 21,
        detect: async () => ({ path: '/usr/bin/java', major: 21 }),
        fetchJson: async () => {
          throw new Error('should not reach the network when Java is already compatible')
        }
      })
      expect(probe).toEqual({ path: '/usr/bin/java', major: 21 })
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })

  it('reports the exact platform limitation, and what to do instead, when installation is actually needed off Windows', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    try {
      await expect(
        ensureJavaRuntime({
          userDataDir: 'unused',
          requiredMajor: 21,
          detect: async () => ({ path: null, major: null }),
          fetchJson: async () => []
        })
      ).rejects.toThrow(/Windows only.*install a java runtime yourself/is)
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })
})
