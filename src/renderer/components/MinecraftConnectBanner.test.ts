import { describe, expect, it } from 'vitest'
import type { MinecraftServerStatus } from '@shared/minecraft'
import { toRow } from './MinecraftConnectBanner'

function baseStatus(overrides: Partial<MinecraftServerStatus> = {}): MinecraftServerStatus {
  return {
    id: 'minecraft-1',
    phase: 'stopped',
    dir: '/tmp/mc',
    versionId: '1.21.4',
    eulaAccepted: true,
    installedJavaMajor: 21,
    installedJavaPath: '/usr/bin/java',
    requiredJavaMajor: 21,
    javaOk: true,
    javaReason: null,
    error: null,
    pid: null,
    startedAt: null,
    downloadedBytes: null,
    totalBytes: null,
    downloadPercent: null,
    port: 25565,
    localAddress: '127.0.0.1',
    lanAddress: null,
    ...overrides
  }
}

describe('MinecraftConnectBanner toRow', () => {
  it('is absent while the server is stopped', () => {
    expect(toRow(baseStatus({ phase: 'stopped' }))).toBeNull()
  })

  it('is absent while the server is starting', () => {
    expect(toRow(baseStatus({ phase: 'starting' }))).toBeNull()
  })

  it('is absent while the server is stopping', () => {
    expect(toRow(baseStatus({ phase: 'stopping' }))).toBeNull()
  })

  it('is absent for an unconfigured/downloading/error instance', () => {
    expect(toRow(baseStatus({ phase: 'unconfigured', dir: null, versionId: null }))).toBeNull()
    expect(toRow(baseStatus({ phase: 'downloading' }))).toBeNull()
    expect(toRow(baseStatus({ phase: 'error', error: 'boom' }))).toBeNull()
  })

  it('shows the local address when running with no LAN address', () => {
    const row = toRow(baseStatus({ phase: 'running', port: 25565, lanAddress: null }))
    expect(row).toEqual({ id: 'minecraft-1', local: '127.0.0.1:25565', lan: null })
  })

  it('shows both addresses when running with a real LAN address', () => {
    const row = toRow(
      baseStatus({ phase: 'running', port: 25580, lanAddress: '192.168.1.42' })
    )
    expect(row).toEqual({ id: 'minecraft-1', local: '127.0.0.1:25580', lan: '192.168.1.42:25580' })
  })

  it('never mistakes the loopback address for a LAN address', () => {
    const row = toRow(baseStatus({ phase: 'running', lanAddress: null }))
    expect(row?.lan).toBeNull()
    expect(row?.local.startsWith('127.0.0.1')).toBe(true)
  })
})
