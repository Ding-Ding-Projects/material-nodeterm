import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runner = path.join(repo, 'scripts', 'run-headless-gallery.mjs')

describe('run-headless-gallery CLI boundaries', () => {
  it('rejects a relative candidate before it can create a run root or launch a process', () => {
    const result = spawnSync(process.execPath, [
      runner, '--candidate', 'relative.exe', '--run-root', 'C:\\Temp\\gallery-run', '--repo', repo,
      '--provenance', 'C:\\missing.json', '--cheap', 'C:\\missing.exe', '--desktop', 'gallery-test',
      '--port', '9939', '--width', '640', '--height', '540'
    ], { encoding: 'utf8', windowsHide: true })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('--candidate must be absolute.')
  })
})
