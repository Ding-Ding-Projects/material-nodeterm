import { describe, expect, it, vi } from 'vitest'
import {
  assertSupportedNodeRuntime,
  loadNodeSqlite,
  NODE_SQLITE_RUNTIME_RANGE,
  supportsNodeRuntimeVersion
} from './node-runtime'
import {
  assertNodeRuntime as assertInstallerNodeRuntime,
  NODE_RUNTIME_RANGE as INSTALLER_NODE_RUNTIME_RANGE,
  supportsNodeRuntimeVersion as installerSupportsNodeRuntimeVersion
} from '../../scripts/check-node-runtime.mjs'
import packageJson from '../../package.json'
import packageLock from '../../package-lock.json'

describe('Node runtime support', () => {
  it.each([
    ['20.20.0', false],
    ['22.4.1', false],
    ['22.12.99', false],
    ['22.13.99', false],
    ['22.14.0', false],
    ['22.22.1', false],
    ['22.22.2', true],
    ['22.99.0', true],
    ['23.3.99', false],
    ['23.4.0', false],
    ['24.0.0', false],
    ['24.14.99', false],
    ['24.15.0', true],
    ['v24.19.0', true],
    ['24.19.0-rc.1', false],
    ['24.19.0+custom.1', true],
    ['25.9.0', false],
    ['26.0.0', true],
    ['not-a-version', false]
  ])('classifies %s against the supported Node runtime boundary', (version, supported) => {
    expect(supportsNodeRuntimeVersion(version)).toBe(supported)
    expect(installerSupportsNodeRuntimeVersion(version)).toBe(supported)
  })

  it('keeps package and installer declarations on the startup preflight range', () => {
    expect(INSTALLER_NODE_RUNTIME_RANGE).toBe(NODE_SQLITE_RUNTIME_RANGE)
    expect(packageJson.engines.node).toBe(NODE_SQLITE_RUNTIME_RANGE)
    expect(packageLock.packages['node_modules/jsdom'].engines.node).toBe(NODE_SQLITE_RUNTIME_RANGE)
  })

  it('refuses a below-boundary runtime before attempting to load SQLite', () => {
    const loadBuiltin = vi.fn()
    expect(() => loadNodeSqlite('22.22.1', loadBuiltin)).toThrow(
      `nodeterm requires Node.js ${NODE_SQLITE_RUNTIME_RANGE}`
    )
    expect(loadBuiltin).not.toHaveBeenCalled()
  })

  it('refuses a supported version whose SQLite capability was explicitly disabled', () => {
    expect(() => loadNodeSqlite('22.22.2', () => undefined)).toThrow(
      'does not expose node:sqlite DatabaseSync'
    )
  })

  it('requires the installer capability probe to construct and close an in-memory database', () => {
    const close = vi.fn()
    const DatabaseSync = vi.fn(function FakeDatabaseSync(this: unknown, file: string) {
      expect(file).toBe(':memory:')
      return { close }
    })
    assertInstallerNodeRuntime('24.15.0', () => ({ DatabaseSync }))
    expect(DatabaseSync).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it('returns the exact supported built-in module', () => {
    class FakeDatabaseSync {}
    const sqlite = { DatabaseSync: FakeDatabaseSync }
    expect(loadNodeSqlite('24.15.0', (id) => id === 'node:sqlite' ? sqlite : undefined)).toBe(sqlite)
  })

  it('probes the current runtime with a real in-memory database', () => {
    expect(() => assertSupportedNodeRuntime()).not.toThrow()
  })
})
