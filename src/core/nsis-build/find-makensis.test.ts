import { describe, it, expect } from 'vitest'
import { findMakensis } from './find-makensis'

describe('findMakensis', () => {
  it('finds makensis on PATH and reports its version', async () => {
    const run = async (file: string) => {
      if (file === 'makensis.exe' || file === 'makensis') {
        return { stdout: 'v3.10\n', stderr: '' }
      }
      throw new Error('ENOENT')
    }
    const result = await findMakensis({ run, platform: 'win32' })
    expect(result.found).toBe(true)
    if (result.found) {
      expect(result.execPath).toBe('makensis.exe')
      expect(result.version).toBe('v3.10')
    }
  })

  it('falls back to well-known install directories when PATH has nothing', async () => {
    const seen: string[] = []
    const run = async (file: string) => {
      seen.push(file)
      if (file.includes('Program Files\\NSIS\\makensis.exe')) {
        return { stdout: 'v3.09', stderr: '' }
      }
      throw new Error('not found')
    }
    const exists = (p: string) => p.includes('Program Files\\NSIS\\makensis.exe')
    const result = await findMakensis({ run, exists, platform: 'win32' })
    expect(result.found).toBe(true)
    if (result.found) {
      expect(result.execPath).toContain('NSIS')
      expect(result.version).toBe('v3.09')
    }
  })

  it('reports found:false with the exact list of everywhere it looked', async () => {
    const run = async () => {
      throw new Error('not found anywhere')
    }
    const exists = () => false
    const result = await findMakensis({ run, exists, platform: 'win32' })
    expect(result.found).toBe(false)
    if (!result.found) {
      expect(result.checked.length).toBeGreaterThan(1)
      expect(result.checked[0]).toContain('PATH')
      expect(result.checked.some((c) => c.includes('NSIS'))).toBe(true)
    }
  })

  it('never claims a version when the binary exists but /VERSION fails', async () => {
    const run = async (file: string, args: string[]) => {
      if (args[0] === '/VERSION' && file.includes('NSIS')) {
        throw new Error('exec failed')
      }
      throw new Error('not on PATH')
    }
    const exists = (p: string) => p.includes('NSIS')
    const result = await findMakensis({ run, exists, platform: 'win32' })
    expect(result.found).toBe(true)
    if (result.found) {
      expect(result.version).toBeNull()
    }
  })
})
