import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(__dirname, '../../scripts/release-assets.mjs')
const SETUP = 'nodeterm-Setup-0.4.0.exe'
const FULL = 'node-terminal-0.4.0-full.nupkg'
const DELTA = 'node-terminal-0.4.0-delta.nupkg'
const SETUP_BYTES = Buffer.from('setup executable\n')

function crc32(value: Buffer): number {
  let crc = 0xffffffff
  for (const byte of value) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function storedZip(entries: Array<{ name: string; value: Buffer }>): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const crc = crc32(entry.value)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(entry.value.length, 18)
    header.writeUInt32LE(entry.value.length, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, entry.value)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50, 0)
    directory.writeUInt16LE(20, 4)
    directory.writeUInt16LE(20, 6)
    directory.writeUInt32LE(crc, 16)
    directory.writeUInt32LE(entry.value.length, 20)
    directory.writeUInt32LE(entry.value.length, 24)
    directory.writeUInt16LE(name.length, 28)
    directory.writeUInt32LE(offset, 42)
    central.push(directory, name)
    offset += header.length + name.length + entry.value.length
  }
  const centralOffset = offset
  const centralSize = central.reduce((total, item) => total + item.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(centralOffset, 16)
  return Buffer.concat([...local, ...central, end])
}

function packageBytes(version = '0.4.0', title = 'nodeterm'): Buffer {
  return storedZip([{
    name: 'node-terminal.nuspec',
    value: Buffer.from(
      `<?xml version="1.0"?><package><metadata><id>node-terminal</id><version>${version}</version><title>${title}</title></metadata></package>`
    )
  }])
}

const FULL_BYTES = packageBytes()
const DELTA_BYTES = packageBytes()

function sha1(value: Buffer): string {
  return createHash('sha1').update(value).digest('hex')
}

function releasesLine(name: string, value: Buffer, size = value.length, hash = sha1(value)): string {
  return `${hash.toUpperCase()} ${name} ${size}`
}

describe('release-assets helper CLI', () => {
  let root = ''
  let output = ''
  let packageJson = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nodeterm-release-assets-'))
    output = `${root}-github-output.txt`
    packageJson = `${root}-package.json`
    writeFileSync(packageJson, JSON.stringify({
      name: 'node-terminal',
      version: '0.4.0',
      build: { productName: 'nodeterm' }
    }))
    writeFileSync(join(root, SETUP), SETUP_BYTES)
    writeFileSync(join(root, FULL), FULL_BYTES)
    writeFileSync(join(root, DELTA), DELTA_BYTES)
    writeFileSync(
      join(root, 'RELEASES'),
      `${releasesLine(FULL, FULL_BYTES)}\r\n${releasesLine(DELTA, DELTA_BYTES)}\r\n`
    )
    writeFileSync(output, '')
  })

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    if (output) rmSync(output, { force: true })
    if (packageJson) rmSync(packageJson, { force: true })
  })

  function collect() {
    return spawnSync(process.execPath, [SCRIPT, 'collect', root, packageJson], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: output }
    })
  }

  it('collects a bidirectionally verified RELEASES inventory', () => {
    const result = collect()

    expect(result.status, result.stderr).toBe(0)
    const emitted = readFileSync(output, 'utf8')
    expect(emitted).toContain(`setup=${resolve(root, SETUP)}`)
    expect(emitted).toContain(`"name":"${FULL}","size":${FULL_BYTES.length}`)
    expect(emitted).toContain(`"name":"${DELTA}","size":${DELTA_BYTES.length}`)
  })

  it('writes only the exact validated Setup path for local BAT consumption', () => {
    const resultFile = join(root, 'setup-result.txt')
    const result = spawnSync(process.execPath, [SCRIPT, 'collect-local', root, packageJson, resultFile], {
      encoding: 'utf8'
    })

    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(resultFile, 'utf8')).toBe(resolve(root, SETUP))
  })

  it.each([
    ['missing setup', () => unlinkSync(join(root, SETUP)), `exactly one ${SETUP}`],
    [
      'duplicate setup',
      () => writeFileSync(join(root, 'other-Setup-0.4.0.exe'), SETUP_BYTES),
      `unexpected Squirrel output entry: other-Setup-0.4.0.exe`
    ],
    ['missing RELEASES', () => unlinkSync(join(root, 'RELEASES')), 'exactly one RELEASES'],
    [
      'missing full package',
      () => {
        unlinkSync(join(root, FULL))
        writeFileSync(join(root, 'RELEASES'), `${releasesLine(DELTA, DELTA_BYTES)}\n`)
      },
      `exactly one ${FULL}`
    ]
  ])('rejects $0', (_name, mutate, message) => {
    mutate()
    const result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(message)
  })

  it('rejects RELEASES SHA-1 and byte-size mutations', () => {
    writeFileSync(
      join(root, 'RELEASES'),
      `${releasesLine(FULL, FULL_BYTES, FULL_BYTES.length, '0'.repeat(40))}\n${releasesLine(DELTA, DELTA_BYTES)}\n`
    )
    let result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`SHA1 mismatch for ${FULL}`)

    writeFileSync(
      join(root, 'RELEASES'),
      `${releasesLine(FULL, FULL_BYTES, FULL_BYTES.length + 1)}\n${releasesLine(DELTA, DELTA_BYTES)}\n`
    )
    result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`size mismatch for ${FULL}`)
  })

  it('rejects an unlisted package', () => {
    writeFileSync(join(root, 'orphan-full.nupkg'), Buffer.from('orphan'))
    const result = collect()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('unexpected package identity/version: orphan-full.nupkg')
  })

  it('rejects a wrong but self-consistent Setup, package filename, RELEASES row, and nuspec version', () => {
    const wrongSetup = 'nodeterm-Setup-0.3.0.exe'
    const wrongPackage = 'node-terminal-0.3.0-full.nupkg'
    const bytes = packageBytes('0.3.0')
    unlinkSync(join(root, SETUP))
    unlinkSync(join(root, FULL))
    unlinkSync(join(root, DELTA))
    writeFileSync(join(root, wrongSetup), SETUP_BYTES)
    writeFileSync(join(root, wrongPackage), bytes)
    writeFileSync(join(root, 'RELEASES'), `${releasesLine(wrongPackage, bytes)}\r\n`)

    const result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`expected exactly one ${SETUP}`)
  })

  it.each([
    ['package ID', '<id>node-terminal</id>', '<id>other-app</id>', 'packageId mismatch'],
    ['package version', '<version>0.4.0</version>', '<version>0.3.0</version>', 'version mismatch'],
    ['product title', '<title>nodeterm</title>', '<title>other product</title>', 'productName mismatch']
  ])('rejects a wrong nuspec %s even when RELEASES is recomputed', (_name, before, after, message) => {
    const original = `<?xml version="1.0"?><package><metadata><id>node-terminal</id><version>0.4.0</version><title>nodeterm</title></metadata></package>`
    const bytes = storedZip([{ name: 'node-terminal.nuspec', value: Buffer.from(original.replace(before, after)) }])
    writeFileSync(join(root, FULL), bytes)
    writeFileSync(
      join(root, 'RELEASES'),
      `${releasesLine(FULL, bytes)}\r\n${releasesLine(DELTA, DELTA_BYTES)}\r\n`
    )
    const result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(message)
  })

  it('ignores a commented lookalike and requires the semantic metadata element', () => {
    const bytes = storedZip([{
      name: 'node-terminal.nuspec',
      value: Buffer.from(
        '<package><!-- <metadata><id>node-terminal</id><version>0.4.0</version><title>nodeterm</title></metadata> --><other><id>node-terminal</id></other></package>'
      )
    }])
    writeFileSync(join(root, FULL), bytes)
    writeFileSync(join(root, 'RELEASES'), `${releasesLine(FULL, bytes)}\r\n${releasesLine(DELTA, DELTA_BYTES)}\r\n`)
    const result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('exactly one direct package metadata element')
  })

  it.each(['leftover.log', 'subdirectory'])('rejects unexpected residue %s', (name) => {
    if (name.includes('.')) writeFileSync(join(root, name), 'stale')
    else mkdirSync(join(root, name))
    const result = collect()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`unexpected Squirrel output entry: ${name}`)
  })

  it.runIf(process.platform === 'win32')('rejects a junction instead of traversing it', () => {
    const target = join(root, 'junction-target')
    mkdirSync(target)
    symlinkSync(target, join(root, 'unexpected-junction'), 'junction')
    const result = collect()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('unexpected-junction')
  })

  it.each(['Valid', 'HashMismatch', 'NotTrusted', 'UnknownError', ''])(
    'rejects Authenticode status %j',
    (status) => {
      const result = spawnSync(process.execPath, [SCRIPT, 'assert-unsigned', status], {
        encoding: 'utf8'
      })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('expected an unsigned installer')
    }
  )

  it('accepts only exact NotSigned and exact one-line SHA-256 text', () => {
    let result = spawnSync(process.execPath, [SCRIPT, 'assert-unsigned', 'NotSigned'], {
      encoding: 'utf8'
    })
    expect(result.status, result.stderr).toBe(0)

    const digestFile = join(root, 'digest.txt')
    writeFileSync(digestFile, 'a'.repeat(64))
    result = spawnSync(process.execPath, [SCRIPT, 'assert-sha256-file', digestFile], {
      encoding: 'utf8'
    })
    expect(result.status, result.stderr).toBe(0)

    writeFileSync(digestFile, `${'a'.repeat(64)}\r\ninherited`)
    result = spawnSync(process.execPath, [SCRIPT, 'assert-sha256-file', digestFile], {
      encoding: 'utf8'
    })
    expect(result.status).not.toBe(0)
  })
})
