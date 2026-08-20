import { describe, expect, it } from 'vitest'
import { DEFAULT_MINECRAFT_PORT, parseServerPort, pickLanIPv4 } from './lan-address'

describe('parseServerPort', () => {
  it('reads an explicit server-port key', () => {
    expect(parseServerPort('server-port=25566\nmotd=hi\n')).toBe(25566)
  })

  it('defaults to 25565 when the key is absent', () => {
    expect(parseServerPort('motd=hi\ngamemode=survival\n')).toBe(DEFAULT_MINECRAFT_PORT)
  })

  it('defaults on an empty file', () => {
    expect(parseServerPort('')).toBe(DEFAULT_MINECRAFT_PORT)
  })

  it('defaults on a non-numeric value', () => {
    expect(parseServerPort('server-port=not-a-number\n')).toBe(DEFAULT_MINECRAFT_PORT)
  })

  it('defaults on an out-of-range value', () => {
    expect(parseServerPort('server-port=70000\n')).toBe(DEFAULT_MINECRAFT_PORT)
    expect(parseServerPort('server-port=0\n')).toBe(DEFAULT_MINECRAFT_PORT)
  })

  it('ignores commented-out lines', () => {
    expect(parseServerPort('#server-port=25566\n')).toBe(DEFAULT_MINECRAFT_PORT)
  })

  it('tolerates CRLF line endings', () => {
    expect(parseServerPort('motd=hi\r\nserver-port=25580\r\n')).toBe(25580)
  })
})

describe('pickLanIPv4', () => {
  it('skips internal (loopback) addresses', () => {
    const result = pickLanIPv4({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }]
    })
    expect(result).toBeNull()
  })

  it('skips link-local (169.254.x.x) addresses', () => {
    const result = pickLanIPv4({
      eth0: [{ address: '169.254.1.2', family: 'IPv4', internal: false }]
    })
    expect(result).toBeNull()
  })

  it('skips IPv6 addresses', () => {
    const result = pickLanIPv4({
      eth0: [{ address: 'fe80::1', family: 'IPv6', internal: false }]
    })
    expect(result).toBeNull()
  })

  it('picks the first real external IPv4', () => {
    const result = pickLanIPv4({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      eth0: [{ address: '192.168.1.42', family: 'IPv4', internal: false }]
    })
    expect(result).toBe('192.168.1.42')
  })

  it('returns null when no interfaces are usable', () => {
    expect(pickLanIPv4({})).toBeNull()
  })

  it('accepts numeric family 4 as well as the string form', () => {
    const result = pickLanIPv4({
      eth0: [{ address: '10.0.0.5', family: 4, internal: false }]
    })
    expect(result).toBe('10.0.0.5')
  })
})
