import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(__dirname, '../../scripts/release-notes.mjs')

describe('release notes asset verification evidence', () => {
  let root: string
  let asset: string
  let digest: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nodeterm-release-notes-'))
    asset = join(root, 'nodeterm-Setup-0.4.0.exe')
    const bytes = Buffer.from('unsigned setup fixture\n')
    writeFileSync(asset, bytes)
    digest = createHash('sha256').update(bytes).digest('hex')
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function run(manifest: unknown) {
    const moduleURL = pathToFileURL(SCRIPT).href
    const command = `import(${JSON.stringify(moduleURL)}).then(async ({ renderAssetsSection }) => console.log(await renderAssetsSection()))`
    return spawnSync(process.execPath, ['--input-type=module', '--eval', command], {
      cwd: resolve(__dirname, '../..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        RELEASE_TAG: 'v0.4.0',
        RELEASE_ASSET_PATHS: asset,
        RELEASE_ASSET_MANIFEST: JSON.stringify(manifest),
      },
    })
  }

  it('lists the validated SHA-256 beside each downloadable release asset', () => {
    const result = run({
      version: '0.4.0',
      packageId: 'node-terminal',
      productName: 'nodeterm',
      assets: [{ name: 'nodeterm-Setup-0.4.0.exe', size: 23, sha256: digest }],
    })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(`\`nodeterm-Setup-0.4.0.exe\``)
    expect(result.stdout).toContain(`SHA-256 \`${digest}\``)
    expect(result.stdout).not.toContain('SHA-256 unavailable')
  })

  it('fails closed instead of publishing malformed hash evidence', () => {
    const result = run({ assets: [{ name: 'nodeterm-Setup-0.4.0.exe', sha256: 'not-a-digest' }] })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('invalid asset SHA-256')
  })
})
