import { describe, expect, it } from 'vitest'
import { classifyOllamaHealth, detectOllamaInstalled } from './installation'

describe('detectOllamaInstalled', () => {
  it('finds the binary on PATH', () => {
    const result = detectOllamaInstalled({
      platform: 'linux',
      env: { PATH: '/opt/nothing:/usr/bin' },
      exists: (p) => p === '/usr/bin/ollama'
    })
    expect(result).toEqual({ found: true, via: 'path' })
  })

  it('falls back to well-known install locations when PATH misses it (a packaged GUI app often has a narrower PATH than an interactive shell)', () => {
    const result = detectOllamaInstalled({
      platform: 'darwin',
      env: { PATH: '/usr/bin' },
      exists: (p) => p === '/usr/local/bin/ollama'
    })
    expect(result).toEqual({ found: true, via: 'known-location' })
  })

  it('checks the macOS .app Resources dir too, not only /usr/local/bin', () => {
    const result = detectOllamaInstalled({
      platform: 'darwin',
      env: { PATH: '' },
      exists: (p) => p === '/Applications/Ollama.app/Contents/Resources/ollama'
    })
    expect(result).toEqual({ found: true, via: 'known-location' })
  })

  it('checks the Windows LOCALAPPDATA install directory with the .exe suffix', () => {
    const seen: string[] = []
    const result = detectOllamaInstalled({
      platform: 'win32',
      env: { Path: 'C:\\Windows\\System32', LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local' },
      exists: (p) => {
        seen.push(p)
        return p === 'C:\\Users\\dev\\AppData\\Local\\Programs\\Ollama\\ollama.exe'
      }
    })
    expect(result).toEqual({ found: true, via: 'known-location' })
    expect(seen).toContain('C:\\Users\\dev\\AppData\\Local\\Programs\\Ollama\\ollama.exe')
    // Never checks the POSIX name on Windows.
    expect(seen.some((p) => p.endsWith('\\ollama') && !p.endsWith('.exe'))).toBe(false)
  })

  it('reports not found, honestly, when no check succeeds — never a guess', () => {
    expect(
      detectOllamaInstalled({ platform: 'linux', env: { PATH: '/usr/bin' }, exists: () => false })
    ).toEqual({ found: false, via: null })
  })

  it('tolerates a missing PATH entirely', () => {
    expect(
      detectOllamaInstalled({ platform: 'linux', env: {}, exists: (p) => p === '/usr/bin/ollama' })
    ).toEqual({ found: true, via: 'known-location' })
  })

  it('treats a throwing exists() as "not here" and keeps looking, never as a crash', () => {
    let calls = 0
    const result = detectOllamaInstalled({
      platform: 'linux',
      env: { PATH: '/a:/b' },
      exists: (p) => {
        calls++
        if (calls === 1) throw new Error('permission denied')
        return p === '/b/ollama'
      }
    })
    expect(result).toEqual({ found: true, via: 'path' })
  })
})

describe('classifyOllamaHealth', () => {
  it('a refused connection classifies as "stopped" when the binary is found', () => {
    expect(classifyOllamaHealth('ECONNREFUSED', 'fetch failed', () => ({ found: true, via: 'path' }))).toBe(
      'stopped'
    )
  })

  it('a refused connection classifies as "not-installed" when no evidence of the binary is found', () => {
    expect(classifyOllamaHealth('ECONNREFUSED', 'fetch failed', () => ({ found: false, via: null }))).toBe(
      'not-installed'
    )
  })

  it('recognizes a refusal from the message text too, not only the structured code (belt and suspenders)', () => {
    expect(
      classifyOllamaHealth(null, 'connect ECONNREFUSED 127.0.0.1:11434', () => ({ found: false, via: null }))
    ).toBe('not-installed')
  })

  it('never calls checkInstalled for a timeout/abort — Ollama is plainly there, just slow', () => {
    let called = false
    const result = classifyOllamaHealth(null, 'This operation was aborted', () => {
      called = true
      return { found: true, via: 'path' }
    })
    expect(result).toBe('unreachable')
    expect(called).toBe(false)
  })

  it('a non-2xx response with no distinguishing text is "unhealthy", never misreported as unreachable', () => {
    expect(
      classifyOllamaHealth(null, 'Ollama /api/version → HTTP 500: boom', () => ({ found: false, via: null }))
    ).toBe('unhealthy')
  })

  it('no detail at all is "unreachable"', () => {
    expect(classifyOllamaHealth(null, null, () => ({ found: false, via: null }))).toBe('unreachable')
  })

  it('a throwing checkInstalled degrades to "not-installed" rather than crashing the whole status check', () => {
    expect(
      classifyOllamaHealth('ECONNREFUSED', 'fetch failed', () => {
        throw new Error('boom')
      })
    ).toBe('not-installed')
  })
})
