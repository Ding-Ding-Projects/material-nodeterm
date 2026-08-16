import { createHash } from 'node:crypto'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as ResEdit from 'resedit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertPackagedIconContract,
  cleanWindowsPackageOutputs,
  downloadMatchingIcon,
  immutableIconUrl,
  inspectIco,
  inspectPeIconInventory,
  inspectPeProductIdentity,
  parseGitHubRepository,
  requireCleanSourceStatus,
  validateImmutableIconUrl
} from '../../scripts/windows-installer.mjs'

const REPO_ROOT = resolve(__dirname, '../..')
const SOURCE_ICON = readFileSync(join(REPO_ROOT, 'build', 'icon.ico'))
const SHA = 'a'.repeat(40)
const REPOSITORY = 'Ding-Ding-Projects/material-nodeterm'
const ICON_URL = immutableIconUrl(REPOSITORY, SHA)
const RELEASE_IDENTITY = { packageId: 'node-terminal', version: '0.4.0', productName: 'nodeterm' }

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

function peWithIcon(
  iconBytes: Buffer,
  minimumSize = 0,
  identity = RELEASE_IDENTITY
): Buffer {
  const executable = ResEdit.NtExecutable.createEmpty(true, false)
  const resources = ResEdit.NtExecutableResource.from(executable)
  const icon = ResEdit.Data.IconFile.from(iconBytes)
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    1,
    1033,
    icon.icons.map((frame) => frame.data)
  )
  const version = ResEdit.Resource.VersionInfo.create({
    lang: 1033,
    fixedInfo: {},
    strings: [{
      lang: 1033,
      codepage: 1200,
      values: {
        FileDescription: identity.productName,
        ProductName: identity.productName,
        FileVersion: `${identity.version}.0`,
        ProductVersion: `${identity.version}.0`
      }
    }]
  })
  version.setFileVersion(`${identity.version}.0`, 1033)
  version.setProductVersion(`${identity.version}.0`, 1033)
  version.outputToResourceEntries(resources.entries)
  resources.outputResource(executable)
  const generated = Buffer.from(executable.generate())
  return generated.length >= minimumSize
    ? generated
    : Buffer.concat([generated, Buffer.alloc(minimumSize - generated.length)])
}

function addPeIconGroup(executableBytes: Buffer, iconBytes: Buffer, id: number, lang: number): Buffer {
  const executable = ResEdit.NtExecutable.from(executableBytes, { ignoreCert: true })
  const resources = ResEdit.NtExecutableResource.from(executable)
  const icon = ResEdit.Data.IconFile.from(iconBytes)
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    id,
    lang,
    icon.icons.map((frame) => frame.data)
  )
  resources.outputResource(executable)
  return Buffer.from(executable.generate())
}

function sha1(value: Buffer): string {
  return createHash('sha1').update(value).digest('hex')
}

describe('Windows installer icon contract', () => {
  let root = ''
  let squirrel = ''
  let metadataFile = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nodeterm-windows-icon-'))
    squirrel = join(root, 'dist', 'squirrel-windows')
    metadataFile = join(root, 'dist', 'windows-icon-contract.json')
    mkdirSync(join(root, 'build'), { recursive: true })
    mkdirSync(squirrel, { recursive: true })
    copyFileSync(join(REPO_ROOT, 'build', 'icon.ico'), join(root, 'build', 'icon.ico'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: RELEASE_IDENTITY.packageId,
      version: RELEASE_IDENTITY.version,
      build: { productName: RELEASE_IDENTITY.productName }
    }))
  })

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  function writePackage(options: {
    iconUrl?: string
    appIcon?: Buffer
    stubIcon?: Buffer
    setupIcon?: Buffer
    peIdentity?: typeof RELEASE_IDENTITY
    nuspecVersion?: string
  } = {}) {
    const peIdentity = options.peIdentity ?? RELEASE_IDENTITY
    const appPe = peWithIcon(options.appIcon ?? SOURCE_ICON, 0, peIdentity)
    const stubPe = peWithIcon(options.stubIcon ?? SOURCE_ICON, 0, peIdentity)
    const packageBytes = storedZip([
      {
        name: 'node-terminal.nuspec',
        value: Buffer.from(
          `<package><metadata><id>node-terminal</id><version>${options.nuspecVersion ?? '0.4.0'}</version><title>nodeterm</title><iconUrl>${options.iconUrl ?? ICON_URL}</iconUrl></metadata></package>`
        )
      },
      { name: 'lib/net45/nodeterm.exe', value: appPe },
      { name: 'lib/net45/nodeterm_ExecutionStub.exe', value: stubPe }
    ])
    const packageName = 'node-terminal-0.4.0-full.nupkg'
    writeFileSync(
      join(squirrel, 'nodeterm-Setup-0.4.0.exe'),
      peWithIcon(options.setupIcon ?? SOURCE_ICON, 5 * 1024 * 1024, peIdentity)
    )
    writeFileSync(join(squirrel, packageName), packageBytes)
    writeFileSync(join(squirrel, 'RELEASES'), `${sha1(packageBytes)} ${packageName} ${packageBytes.length}\r\n`)
    writeFileSync(
      metadataFile,
      `${JSON.stringify({
        schemaVersion: 1,
        sourceSha: SHA,
        repository: REPOSITORY,
        iconUrl: ICON_URL,
        sha256: createHash('sha256').update(SOURCE_ICON).digest('hex'),
        frames: [16, 24, 32, 48, 64, 128, 256]
      })}\n`
    )
  }

  it('parses the committed seven-frame ICO and exact branded PE resource inventory', () => {
    expect(inspectIco(SOURCE_ICON).map((frame) => frame.width)).toEqual([
      16, 24, 32, 48, 64, 128, 256
    ])
    expect(inspectPeIconInventory(peWithIcon(SOURCE_ICON), SOURCE_ICON)).toEqual({
      group: 1,
      languages: [1033],
      frames: 7
    })
    expect(inspectPeProductIdentity(peWithIcon(SOURCE_ICON), RELEASE_IDENTITY)).toMatchObject({
      productName: RELEASE_IDENTITY.productName,
      version: RELEASE_IDENTITY.version
    })
  })

  it('removes stale app, Squirrel, and icon-metadata output before a package build', async () => {
    const stale = [
      join(root, 'out', 'session-host', 'stale-injected.js'),
      join(root, 'dist', 'squirrel-windows', 'stale.nupkg'),
      join(root, 'dist', 'windows-icon-contract.json')
    ]
    for (const file of stale) {
      mkdirSync(join(file, '..'), { recursive: true })
      writeFileSync(file, 'stale')
    }
    await cleanWindowsPackageOutputs(root)
    for (const file of stale) expect(() => readFileSync(file)).toThrow()
  })

  it('rejects a same-shaped PE carrying different icon bytes', () => {
    const different = Buffer.from(SOURCE_ICON)
    different[different.length - 1] ^= 1
    expect(() => inspectPeIconInventory(peWithIcon(different), SOURCE_ICON, 'mutated app')).toThrow(
      /does not match build\/icon\.ico/
    )
  })

  it('rejects extra icon groups and a mismatched alternate-language group', () => {
    const base = peWithIcon(SOURCE_ICON)
    expect(() => inspectPeIconInventory(addPeIconGroup(base, SOURCE_ICON, 2, 1033), SOURCE_ICON)).toThrow(
      /unexpected RT_GROUP_ICON/
    )
    const different = Buffer.from(SOURCE_ICON)
    different[different.length - 1] ^= 1
    expect(() => inspectPeIconInventory(addPeIconGroup(base, different, 1, 0), SOURCE_ICON)).toThrow(
      /does not match build\/icon\.ico/
    )
  })

  it('requires an exact raw GitHub source-SHA URL', () => {
    expect(parseGitHubRepository('https://github.com/Ding-Ding-Projects/material-nodeterm.git')).toBe(
      REPOSITORY
    )
    expect(validateImmutableIconUrl(ICON_URL, REPOSITORY, SHA)).toBe(ICON_URL)
    for (const bad of [
      ICON_URL.replace(SHA, 'main'),
      ICON_URL.replace('raw.githubusercontent.com', 'github.com'),
      `${ICON_URL}?raw=true`,
      ICON_URL.replace('build/icon.ico', 'build/icon.png')
    ]) {
      expect(() => validateImmutableIconUrl(bad, REPOSITORY, SHA)).toThrow(/exact immutable raw source URL|full lowercase/)
    }
  })

  it('rejects staged, unstaged, and untracked source status before deriving an artifact identity', () => {
    expect(() => requireCleanSourceStatus('')).not.toThrow()
    for (const status of ['M  package.json', ' M package.json', '?? injected.js']) {
      expect(() => requireCleanSourceStatus(status)).toThrow(/dirty source tree/)
    }
  })

  it('downloads without credentials or redirects and requires exact icon bytes', async () => {
    const fetchImpl = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.redirect).toBe('error')
      expect(new Headers(options.headers).has('authorization')).toBe(false)
      return new Response(SOURCE_ICON, {
        status: 200,
        headers: { 'content-length': String(SOURCE_ICON.length) }
      })
    })
    const wrappedFetch = async (url: string, options: RequestInit) => {
      const response = await fetchImpl(url, options)
      Object.defineProperty(response, 'url', { value: ICON_URL })
      return response
    }

    await expect(downloadMatchingIcon(ICON_URL, SOURCE_ICON, wrappedFetch)).resolves.toEqual(SOURCE_ICON)
    const changed = Buffer.from(SOURCE_ICON)
    changed[changed.length - 1] ^= 1
    await expect(downloadMatchingIcon(ICON_URL, SOURCE_ICON, async () => {
      const response = new Response(changed, { status: 200 })
      Object.defineProperty(response, 'url', { value: ICON_URL })
      return response
    })).rejects.toThrow(/do not match/)
  })

  it('verifies Setup, installed app, execution stub, nuspec URL, and RELEASES together', async () => {
    writePackage()
    await expect(assertPackagedIconContract(squirrel, metadataFile, root, {
      sourceIdentity: { sourceSha: SHA, repository: REPOSITORY }
    })).resolves.toMatchObject({
      iconUrl: ICON_URL
    })
  })

  it('rejects a mutable nuspec URL and an Electron-shaped app icon mutation', async () => {
    writePackage({ iconUrl: ICON_URL.replace(SHA, 'main') })
    await expect(assertPackagedIconContract(squirrel, metadataFile, root, {
      sourceIdentity: { sourceSha: SHA, repository: REPOSITORY }
    })).rejects.toThrow(
      /nuspec iconUrl/
    )

    rmSync(squirrel, { recursive: true, force: true })
    mkdirSync(squirrel, { recursive: true })
    const different = Buffer.from(SOURCE_ICON)
    different[different.length - 1] ^= 1
    writePackage({ appIcon: different })
    await expect(assertPackagedIconContract(squirrel, metadataFile, root, {
      sourceIdentity: { sourceSha: SHA, repository: REPOSITORY }
    })).rejects.toThrow(
      /packaged nodeterm\.exe .*does not match/
    )
  })

  it.each([
    ['Setup', { setupIcon: Buffer.from(SOURCE_ICON) }],
    ['execution stub', { stubIcon: Buffer.from(SOURCE_ICON) }]
  ])('rejects an icon mutation isolated to the %s PE', async (_name, options) => {
    const key = options.setupIcon ? 'setupIcon' : 'stubIcon'
    options[key][options[key].length - 1] ^= 1
    writePackage(options)
    await expect(assertPackagedIconContract(squirrel, metadataFile, root, {
      sourceIdentity: { sourceSha: SHA, repository: REPOSITORY }
    })).rejects.toThrow(/does not match build\/icon\.ico/)
  })

  it('rejects self-consistent wrong PE product/version metadata', async () => {
    writePackage({
      peIdentity: { packageId: 'node-terminal', version: '0.3.0', productName: 'nodeterm' }
    })
    await expect(assertPackagedIconContract(squirrel, metadataFile, root, {
      sourceIdentity: { sourceSha: SHA, repository: REPOSITORY }
    })).rejects.toThrow(/does not match package version 0\.4\.0/)
  })

  it('rejects stale icon metadata that names a different source commit', async () => {
    writePackage()
    await expect(assertPackagedIconContract(squirrel, metadataFile, root, {
      sourceIdentity: { sourceSha: 'b'.repeat(40), repository: REPOSITORY }
    })).rejects.toThrow(/metadata source identity/)
  })
})
