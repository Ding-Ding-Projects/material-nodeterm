import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { validateInstallerReceipt } from './installer-receipt.mjs'

const commit = 'a'.repeat(40)
const digest = (value) => createHash('sha256').update(value).digest('hex')
const roots = []

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'nodeterm-installer-receipt-'))
  roots.push(root)
  const squirrel = path.join(root, 'dist', 'squirrel-windows')
  const unpacked = path.join(root, 'dist', 'win-unpacked')
  await mkdir(squirrel, { recursive: true })
  await mkdir(unpacked, { recursive: true })
  const setup = path.join(squirrel, 'nodeterm-Setup-1.0.0.exe')
  const setupBytes = Buffer.from('real setup bytes')
  await writeFile(setup, setupBytes)
  const releaseBytes = Buffer.from('releases')
  const fullBytes = Buffer.from('full package')
  await writeFile(path.join(squirrel, 'RELEASES'), releaseBytes)
  await writeFile(path.join(squirrel, 'node-terminal-1.0.0-full.nupkg'), fullBytes)
  const assets = [
    { name: 'RELEASES', size: releaseBytes.length, sha256: digest(releaseBytes) },
    { name: path.basename(setup), size: setupBytes.length, sha256: digest(setupBytes) },
    { name: 'node-terminal-1.0.0-full.nupkg', size: fullBytes.length, sha256: digest(fullBytes) },
  ]
  return {
    root,
    unpacked,
    setup,
    receipt: {
      schemaVersion: 1,
      status: 'verified',
      version: '1.0.0',
      packageId: 'node-terminal',
      productName: 'nodeterm',
      source: { commit },
      installer: setup,
      sha256: digest(setupBytes),
      assets,
    },
  }
}

afterEach(async () => {
  while (roots.length) await rm(roots.pop(), { recursive: true, force: true })
})

describe('installer receipt validator', () => {
  it('accepts a real Squirrel Setup receipt with exact source and identity', async () => {
    const value = await fixture()
    await expect(validateInstallerReceipt(value.receipt, { commit, squirrelRoot: path.dirname(value.setup) })).resolves.toMatchObject({
      version: '1.0.0',
      packageId: 'node-terminal',
      productName: 'nodeterm',
      sha256: digest('real setup bytes'),
    })
  })

  it('rejects an unpacked executable even when its bytes and identity look right', async () => {
    const value = await fixture()
    const unpacked = path.join(value.unpacked, 'nodeterm.exe')
    await writeFile(unpacked, 'real setup bytes')
    const receipt = { ...value.receipt, installer: unpacked, sha256: digest('real setup bytes') }
    await expect(validateInstallerReceipt(receipt, { commit })).rejects.toThrow(/not dist\/win-unpacked/)
  })

  it.each([
    ['source SHA', (receipt) => ({ ...receipt, source: { commit: 'b'.repeat(40) } }), /source commit mismatch/],
    ['installer SHA', (receipt) => ({ ...receipt, sha256: 'b'.repeat(64) }), /SHA-256 mismatch/],
    ['version', (receipt) => ({ ...receipt, version: '0.4.152' }), /version mismatch/],
    ['package identity', (receipt) => ({ ...receipt, packageId: 'other-package' }), /packageId mismatch/],
    ['asset count', (receipt) => ({ ...receipt, assets: receipt.assets.slice(0, 2) }), /exactly three/],
    ['delta asset', (receipt) => ({ ...receipt, assets: [...receipt.assets.slice(0, 2), { name: 'node-terminal-1.0.0-delta.nupkg', sha256: 'a'.repeat(64) }] }), /unexpected asset/],
  ])('rejects a mismatched %s receipt', async (_name, mutate, expected) => {
    const value = await fixture()
    await expect(validateInstallerReceipt(mutate(value.receipt), {
      commit,
      version: '1.0.0',
      packageId: 'node-terminal',
      productName: 'nodeterm',
    })).rejects.toThrow(expected)
  })
})
