import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ghFallbacks, ghPath, _resetGhPathForTest } from './gh-path'
import * as execPath from './exec-path'

describe('ghPath', () => {
  beforeEach(() => {
    _resetGhPathForTest()
    vi.restoreAllMocks()
  })

  it('memoizes on hit so repeated calls do not re-probe', () => {
    const spy = vi.spyOn(execPath, 'findExecutableSync').mockReturnValue('/usr/local/bin/gh')

    expect(ghPath()).toBe('/usr/local/bin/gh')
    expect(ghPath()).toBe('/usr/local/bin/gh')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('does not memoize on miss so a newly installed gh is picked up', () => {
    const spy = vi.spyOn(execPath, 'findExecutableSync')
      .mockReturnValueOnce(null)
      .mockReturnValueOnce('/opt/homebrew/bin/gh')

    expect(ghPath()).toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)

    expect(ghPath()).toBe('/opt/homebrew/bin/gh')
    expect(spy).toHaveBeenCalledTimes(2)

    // Now cached because it was a hit
    expect(ghPath()).toBe('/opt/homebrew/bin/gh')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('probes with common bin dirs fallbacks', () => {
    const spy = vi.spyOn(execPath, 'findExecutableSync').mockReturnValue('/usr/bin/gh')

    expect(ghPath()).toBe('/usr/bin/gh')
    expect(spy).toHaveBeenCalledWith('gh', ghFallbacks())
  })

  it('walks the POSIX bin dirs off Windows', () => {
    expect(ghFallbacks('linux', {}, '/home/u')).toEqual([
      '/opt/homebrew/bin/gh',
      '/usr/local/bin/gh',
      '/usr/bin/gh'
    ])
  })

  it('walks both GitHub CLI installer locations on Windows', () => {
    expect(ghFallbacks('win32', {
      ProgramFiles: 'D:\\Apps',
      LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local'
    }, 'C:\\Users\\u')).toEqual([
      'D:\\Apps\\GitHub CLI\\gh.exe',
      'C:\\Users\\u\\AppData\\Local\\Programs\\GitHub CLI\\gh.exe'
    ])
    expect(ghFallbacks('win32', {}, 'C:\\Users\\u')).toEqual([
      'C:\\Program Files\\GitHub CLI\\gh.exe',
      'C:\\Users\\u\\AppData\\Local\\Programs\\GitHub CLI\\gh.exe'
    ])
  })
})
