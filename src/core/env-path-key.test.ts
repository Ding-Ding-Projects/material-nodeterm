import { describe, expect, it } from 'vitest'
import { envPathKey } from './env-path-key'

describe('envPathKey', () => {
  it('prepends onto the spelling a Windows environment copy already uses', () => {
    const env: Record<string, string | undefined> = { Path: 'C:\\Windows' }
    const key = envPathKey(env)
    env[key] = `C:\\launcher;${env[key] ?? ''}`
    expect(env).toEqual({ Path: 'C:\\launcher;C:\\Windows' })
  })

  it('keeps an exact PATH, and answers PATH when there is no path variable at all', () => {
    expect(envPathKey({ PATH: '/usr/bin', Path: 'x' })).toBe('PATH')
    expect(envPathKey({ HOME: '/home/me' })).toBe('PATH')
  })
})
