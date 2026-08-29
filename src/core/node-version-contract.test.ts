import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const SCRIPT = resolve(__dirname, '../../scripts/check-node-version.cjs')
const {
  SUPPORTED_NODE_RANGE,
  isSupportedNodeVersion,
  parseVersion
}: {
  SUPPORTED_NODE_RANGE: string
  isSupportedNodeVersion: (value: string) => boolean
  parseVersion: (value: string) => number[] | null
} = require(SCRIPT)

describe('Node version contract', () => {
  it('matches the exact root build range', () => {
    expect(SUPPORTED_NODE_RANGE).toBe('^22.22.2 || ^24.15.0 || >=26.0.0')
  })

  it.each([
    ['22.22.1', false],
    ['22.22.2', true],
    ['22.23.2', true],
    ['23.0.0', false],
    ['24.14.9', false],
    ['24.15.0', true],
    ['24.19.0', true],
    ['25.9.9', false],
    ['26.0.0', true],
    ['27.0.0', true],
    ['not-a-version', false],
    ['', false]
  ])('classifies Node %s as supported=%s', (version, expected) => {
    expect(isSupportedNodeVersion(version)).toBe(expected)
  })

  it('parses only exact three-part versions', () => {
    expect(parseVersion('v24.19.0')).toEqual([24, 19, 0])
    expect(parseVersion('24.19')).toBeNull()
    expect(parseVersion('24.19.0-rc.1')).toBeNull()
  })

  it('runs as a real candidate gate and rejects the immediately lower boundary', () => {
    let result = spawnSync(process.execPath, [SCRIPT, '--check', '22.22.2'], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('v22.22.2')

    result = spawnSync(process.execPath, [SCRIPT, '--check', '22.22.1'], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('does not satisfy')
  })
})
