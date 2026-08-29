import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SQUIRREL_SETUP_VENDOR_ICON_POLICY,
  WINDOWS_RELEASE_IDENTITY,
  assertPackagedIconContract,
  cleanWindowsPackageOutputs,
  downloadMatchingIcon,
  immutableIconUrl,
  inspectIco,
  inspectPeIconInventory,
  inspectPeProductIdentity,
  inspectUnsignedPe,
  parseGitHubRepository,
  readReleaseIdentity,
  requireCleanSourceStatus,
  validateImmutableIconUrl,
} from '../../scripts/windows-installer.mjs'
import { patchWindowsAppIdentity } from '../../scripts/windows-pe-identity.mjs'
import { SQUIRREL_SHORTCUT_EXECUTABLE } from './squirrel-lifecycle'
import { WINDOWS_APP_USER_MODEL_ID } from './windows-app-identity'

const require = createRequire(import.meta.url)
const ResEdit = require('resedit') as typeof import('resedit')
const REPO_ROOT = resolve(import.meta.dirname, '../..')
const SOURCE_ICON = readFileSync(join(REPO_ROOT, 'build', 'icon.ico'))
const VENDOR_SETUP = readFileSync(join(dirname(require.resolve('electron-winstaller/package.json')), 'vendor', 'Setup.exe'))
const VENDOR_SETUP_SHA256 = '1e47eb606dad4c5c1568cfb8f4e970e1051ba5806aedb1ff3256284a8280d83b'
const SHA = 'a'.repeat(40)
const REPOSITORY = 'Ding-Ding-Projects/material-nodeterm'
const ICON_URL = immutableIconUrl(REPOSITORY, SHA)
const RELEASE_IDENTITY = { ...WINDOWS_RELEASE_IDENTITY, version: '0.4.0' }
const APP_RESOURCE_IDENTITY = {
  ...RELEASE_IDENTITY,
  originalFilename: RELEASE_IDENTITY.executableName,
  internalName: 'nodeterm',
}

type ResourceIdentity = {
  packageId: string
  productName: string
  executableName: string
  executionStubName: string
  appUserModelId: string
  version: string
  originalFilename: string
  internalName: string
}
type PackageOptions = {
  appPe?: Buffer
  stubPe?: Buffer
  setupPe?: Buffer
  iconUrl?: string
}
type PackageConfigFixture = {
  name: string
  version: string
  scripts: Record<string, string>
  build: {
    appId: string
    productName: string
    afterSign: string
    forceCodeSigning: boolean
    win: {
      icon: string
      forceCodeSigning: boolean
      signExecutable: boolean
      signAndEditExecutable?: boolean
    }
    squirrelWindows: { artifactName: string; iconUrl?: string }
  }
}

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

function replaceIconGroup(executableBytes: Buffer, iconBytes: Buffer, id: number, lang = 1033): Buffer {
  const executable = ResEdit.NtExecutable.from(executableBytes, { ignoreCert: true })
  const resources = ResEdit.NtExecutableResource.from(executable)
  const icon = ResEdit.Data.IconFile.from(iconBytes)
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    id,
    lang,
    icon.icons.map((frame) => frame.data),
  )
  resources.outputResource(executable)
  return Buffer.from(executable.generate())
}

function peWithIdentity(identity: ResourceIdentity = APP_RESOURCE_IDENTITY, iconBytes: Buffer = SOURCE_ICON): Buffer {
  const executable = ResEdit.NtExecutable.createEmpty(true, false)
  const resources = ResEdit.NtExecutableResource.from(executable)
  const icon = ResEdit.Data.IconFile.from(iconBytes)
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    1,
    1033,
    icon.icons.map((frame) => frame.data),
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
        FileVersion: identity.version,
        ProductVersion: `${identity.version}.0`,
        OriginalFilename: identity.originalFilename,
        InternalName: identity.internalName,
      },
    }],
  })
  version.setFileVersion(`${identity.version}.0`, 1033)
  version.setProductVersion(`${identity.version}.0`, 1033)
  version.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileVersion: identity.version,
    ProductVersion: `${identity.version}.0`,
  })
  version.outputToResourceEntries(resources.entries)
  resources.outputResource(executable)
  return Buffer.from(executable.generate())
}

function brandedVendorSetup(identity: typeof RELEASE_IDENTITY = RELEASE_IDENTITY): Buffer {
  const executable = ResEdit.NtExecutable.from(VENDOR_SETUP, { ignoreCert: true })
  const resources = ResEdit.NtExecutableResource.from(executable)
  const icon = ResEdit.Data.IconFile.from(SOURCE_ICON)
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    1,
    1033,
    icon.icons.map((frame) => frame.data),
  )
  const versions = ResEdit.Resource.VersionInfo.fromEntries(resources.entries)
  expect(versions).toHaveLength(1)
  const version = versions[0]
  version.setFileVersion(`${identity.version}.0`, 1033)
  version.setProductVersion(`${identity.version}.0`, 1033)
  for (const language of version.getAllLanguagesForStringValues()) {
    version.setStringValues(language, {
      FileDescription: identity.productName,
      ProductName: identity.productName,
      FileVersion: identity.version,
      ProductVersion: `${identity.version}.0`,
      OriginalFilename: 'Setup.exe',
      InternalName: 'Setup.exe',
    })
  }
  version.outputToResourceEntries(resources.entries)
  resources.outputResource(executable)
  return Buffer.from(executable.generate())
}

function markCertificateDirectory(executableBytes: Buffer): Buffer {
  const changed = Buffer.from(executableBytes)
  const peOffset = changed.readUInt32LE(0x3c)
  const optional = peOffset + 24
  const dataDirectory = changed.readUInt16LE(optional) === 0x20b ? optional + 112 : optional + 96
  changed.writeUInt32LE(changed.length, dataDirectory + 32)
  changed.writeUInt32LE(8, dataDirectory + 36)
  return Buffer.concat([changed, Buffer.alloc(8)])
}

describe('Windows installer identity contract', () => {
  let root = ''
  let squirrel = ''
  let metadataFile = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nodeterm-windows-identity-'))
    squirrel = join(root, 'dist', 'squirrel-windows')
    metadataFile = join(root, 'dist', 'windows-icon-contract.json')
    mkdirSync(join(root, 'build'), { recursive: true })
    mkdirSync(squirrel, { recursive: true })
    copyFileSync(join(REPO_ROOT, 'build', 'icon.ico'), join(root, 'build', 'icon.ico'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: RELEASE_IDENTITY.packageId,
      version: RELEASE_IDENTITY.version,
      scripts: { 'dist:win': 'node scripts/windows-installer.mjs build' },
      build: {
        appId: 'com.nodeterm.app',
        productName: RELEASE_IDENTITY.productName,
        afterSign: './scripts/windows-pe-identity.mjs',
        forceCodeSigning: false,
        win: { icon: 'build/icon.ico', forceCodeSigning: false, signExecutable: false },
        squirrelWindows: { artifactName: '${productName}-Setup-${version}.${ext}' },
      },
    }))
  })

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  function writePackage(options: PackageOptions = {}) {
    const appPe = options.appPe ?? peWithIdentity()
    const stubPe = options.stubPe ?? peWithIdentity()
    const setupPe = options.setupPe ?? brandedVendorSetup()
    const iconUrl = options.iconUrl ?? ICON_URL
    const packageBytes = storedZip([
      {
        name: 'node-terminal.nuspec',
        value: Buffer.from(
          `<package><metadata><id>node-terminal</id><version>0.4.0</version><title>nodeterm</title><iconUrl>${iconUrl}</iconUrl></metadata></package>`,
        ),
      },
      { name: 'lib/net45/nodeterm.exe', value: appPe },
      { name: 'lib/net45/nodeterm_ExecutionStub.exe', value: stubPe },
    ])
    const packageName = 'node-terminal-0.4.0-full.nupkg'
    const unpacked = join(root, 'dist', 'win-unpacked')
    mkdirSync(unpacked, { recursive: true })
    writeFileSync(join(unpacked, 'nodeterm.exe'), appPe)
    writeFileSync(join(unpacked, 'nodeterm_ExecutionStub.exe'), stubPe)
    writeFileSync(join(squirrel, 'nodeterm-Setup-0.4.0.exe'), setupPe)
    writeFileSync(join(squirrel, packageName), packageBytes)
    writeFileSync(
      join(squirrel, 'RELEASES'),
      `${createHash('sha1').update(packageBytes).digest('hex')} ${packageName} ${packageBytes.length}\r\n`,
    )
    writeFileSync(metadataFile, `${JSON.stringify({
      schemaVersion: 1,
      sourceSha: SHA,
      repository: REPOSITORY,
      iconUrl: ICON_URL,
      sha256: createHash('sha256').update(SOURCE_ICON).digest('hex'),
      frames: [16, 24, 32, 48, 64, 128, 256],
    })}\n`)
  }

  it('parses the committed seven-frame ICO and exact branded application resources', () => {
    expect(inspectIco(SOURCE_ICON).map((frame) => frame.width)).toEqual([16, 24, 32, 48, 64, 128, 256])
    expect(inspectPeIconInventory(peWithIdentity(), SOURCE_ICON)).toEqual({
      kind: 'application',
      primaryGroup: 1,
      primaryLanguage: 1033,
      frames: 7,
      auxiliaryGroups: [],
    })
    expect(inspectPeProductIdentity(peWithIdentity(), APP_RESOURCE_IDENTITY)).toMatchObject({
      ProductName: 'nodeterm',
      OriginalFilename: 'nodeterm.exe',
      InternalName: 'nodeterm',
      version: '0.4.0',
    })
    expect(inspectUnsignedPe(peWithIdentity())).toEqual({ authenticode: 'NotSigned' })
  })

  it('removes every fixed stale app/package output without widening cleanup beyond the repository', async () => {
    const staleFiles = [
      join(root, 'out', 'session-host', 'stale.js'),
      join(root, 'dist', 'win-unpacked', 'stale.exe'),
      join(root, 'dist', 'squirrel-windows', 'stale.nupkg'),
      join(root, 'dist', 'windows-icon-contract.json'),
    ]
    const preserved = join(root, 'dist', 'unrelated-proof.txt')
    for (const file of [...staleFiles, preserved]) {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, 'stale')
    }
    await cleanWindowsPackageOutputs(root)
    for (const file of staleFiles) expect(() => readFileSync(file)).toThrow()
    expect(readFileSync(preserved, 'utf8')).toBe('stale')
  })

  it('accepts the pinned real Squirrel Setup template groups 107/108 beside branded group 1', () => {
    expect(createHash('sha256').update(VENDOR_SETUP).digest('hex')).toBe(VENDOR_SETUP_SHA256)
    expect(SQUIRREL_SETUP_VENDOR_ICON_POLICY.map((group) => group.id)).toEqual([107, 108])
    expect(inspectPeIconInventory(brandedVendorSetup(), SOURCE_ICON, 'real vendor Setup', { kind: 'setup' })).toEqual({
      kind: 'setup',
      primaryGroup: 1,
      primaryLanguage: 1033,
      frames: 7,
      auxiliaryGroups: [107, 108],
    })
  })

  it('rejects synthetic extra groups, missing vendor groups, and a vendor-frame mutation', () => {
    const application = peWithIdentity()
    expect(() => inspectPeIconInventory(replaceIconGroup(application, SOURCE_ICON, 2), SOURCE_ICON)).toThrow(
      /unexpected RT_GROUP_ICON resource 2/,
    )
    expect(() => inspectPeIconInventory(application, SOURCE_ICON, 'synthetic Setup', { kind: 'setup' })).toThrow(
      /pinned Squirrel icon group 107/,
    )
    expect(() => inspectPeIconInventory(
      replaceIconGroup(brandedVendorSetup(), SOURCE_ICON, 109),
      SOURCE_ICON,
      'mutated Setup',
      { kind: 'setup' },
    )).toThrow(/unexpected RT_GROUP_ICON resource 109/)
    expect(() => inspectPeIconInventory(
      replaceIconGroup(brandedVendorSetup(), SOURCE_ICON, 107),
      SOURCE_ICON,
      'mutated Setup vendor group',
      { kind: 'setup' },
    )).toThrow(/group 107 (?:frame count changed|does not match the pinned vendor resource inventory)/)
  })

  it('rejects changed branded bytes, stock Electron filenames, and certificate-table metadata', () => {
    const different = Buffer.from(SOURCE_ICON)
    different[different.length - 1] ^= 1
    expect(() => inspectPeIconInventory(peWithIdentity(APP_RESOURCE_IDENTITY, different), SOURCE_ICON)).toThrow(
      /does not match build\/icon\.ico/,
    )
    expect(() => inspectPeProductIdentity(
      peWithIdentity({ ...APP_RESOURCE_IDENTITY, originalFilename: 'electron.exe' }),
      APP_RESOURCE_IDENTITY,
    )).toThrow(/OriginalFilename/)
    expect(() => inspectUnsignedPe(markCertificateDirectory(peWithIdentity()))).toThrow(/Authenticode certificate/)
  })

  it('patches electron-builder empty OriginalFilename before Squirrel copies stub resources', async () => {
    const file = join(root, 'nodeterm.exe')
    writeFileSync(file, peWithIdentity({ ...APP_RESOURCE_IDENTITY, originalFilename: '', internalName: 'nodeterm' }))
    await expect(patchWindowsAppIdentity(file)).resolves.toMatchObject({
      originalFilename: 'nodeterm.exe',
      internalName: 'nodeterm',
    })
    expect(inspectPeProductIdentity(readFileSync(file), APP_RESOURCE_IDENTITY)).toMatchObject({
      OriginalFilename: 'nodeterm.exe',
    })
  })

  it('verifies real-structure Setup, app, stub, nuspec, RELEASES, and unsigned policy together', async () => {
    writePackage()
    await expect(assertPackagedIconContract(squirrel, metadataFile, root, {
      sourceIdentity: { sourceSha: SHA, repository: REPOSITORY },
    })).resolves.toMatchObject({
      iconUrl: ICON_URL,
      identity: {
        packageId: 'node-terminal',
        productName: 'nodeterm',
        executableName: 'nodeterm.exe',
        appUserModelId: 'com.squirrel.node-terminal.nodeterm',
      },
    })
  })

  it('rejects a stale unpacked executable that differs from the inspected full package', async () => {
    writePackage()
    writeFileSync(
      join(root, 'dist', 'win-unpacked', 'nodeterm.exe'),
      peWithIdentity({ ...APP_RESOURCE_IDENTITY, originalFilename: 'electron.exe' }),
    )
    await expect(assertPackagedIconContract(squirrel, metadataFile, root, {
      sourceIdentity: { sourceSha: SHA, repository: REPOSITORY },
    })).rejects.toThrow(/dist\/win-unpacked\/nodeterm\.exe does not exactly match/)
  })

  it('rejects mutable nuspec metadata and isolated app/stub/Setup identity mutations', async () => {
    writePackage({ iconUrl: ICON_URL.replace(SHA, 'main') })
    await expect(assertPackagedIconContract(squirrel, metadataFile, root, {
      sourceIdentity: { sourceSha: SHA, repository: REPOSITORY },
    })).rejects.toThrow(/nuspec iconUrl/)

    const mutations: Array<[string, PackageOptions]> = [
      ['app', { appPe: peWithIdentity({ ...APP_RESOURCE_IDENTITY, originalFilename: 'electron.exe' }) }],
      ['stub', { stubPe: peWithIdentity({ ...APP_RESOURCE_IDENTITY, originalFilename: 'electron.exe' }) }],
      ['Setup', { setupPe: brandedVendorSetup({ ...RELEASE_IDENTITY, version: '0.3.0' }) }],
    ]
    for (const [field, options] of mutations) {
      rmSync(squirrel, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
      mkdirSync(squirrel, { recursive: true })
      writePackage(options)
      await expect(assertPackagedIconContract(squirrel, metadataFile, root, {
        sourceIdentity: { sourceSha: SHA, repository: REPOSITORY },
      }), field).rejects.toThrow(/OriginalFilename|package version/)
    }
  })

  it('pins immutable source-SHA metadata, clean-source status, and unsigned build config', async () => {
    expect(WINDOWS_RELEASE_IDENTITY.executableName).toBe(SQUIRREL_SHORTCUT_EXECUTABLE)
    expect(WINDOWS_RELEASE_IDENTITY.appUserModelId).toBe(WINDOWS_APP_USER_MODEL_ID)
    expect(parseGitHubRepository('https://github.com/Ding-Ding-Projects/material-nodeterm.git')).toBe(REPOSITORY)
    expect(validateImmutableIconUrl(ICON_URL, REPOSITORY, SHA)).toBe(ICON_URL)
    for (const bad of [
      ICON_URL.replace(SHA, 'main'),
      ICON_URL.replace('raw.githubusercontent.com', 'github.com'),
      `${ICON_URL}?raw=true`,
    ]) {
      expect(() => validateImmutableIconUrl(bad, REPOSITORY, SHA)).toThrow(/exact immutable raw source URL|full lowercase/)
    }
    expect(() => requireCleanSourceStatus('')).not.toThrow()
    for (const status of ['M  package.json', ' M package.json', '?? injected.js']) {
      expect(() => requireCleanSourceStatus(status)).toThrow(/dirty source tree/)
    }
    await expect(readReleaseIdentity(join(root, 'package.json'))).resolves.toMatchObject(WINDOWS_RELEASE_IDENTITY)
    const baseline = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageConfigFixture
    const mutations: Array<[string, (config: PackageConfigFixture) => void]> = [
      ['signAndEditExecutable', (config) => { config.build.win.signAndEditExecutable = false }],
      ['signExecutable', (config) => { config.build.win.signExecutable = true }],
      ['win forceCodeSigning', (config) => { config.build.win.forceCodeSigning = true }],
      ['win icon', (config) => { config.build.win.icon = 'build/icon.png' }],
      ['static iconUrl', (config) => { config.build.squirrelWindows.iconUrl = 'https://example.invalid/icon.ico' }],
      ['unguarded script', (config) => { config.scripts['dist:win'] = 'electron-builder --win squirrel' }],
    ]
    for (const [label, mutate] of mutations) {
      const config = structuredClone(baseline)
      mutate(config)
      writeFileSync(join(root, 'package.json'), JSON.stringify(config))
      await expect(readReleaseIdentity(join(root, 'package.json')), label).rejects.toThrow()
    }
  })

  it('downloads without credentials or redirects and requires exact committed icon bytes', async () => {
    const fetchImpl = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.redirect).toBe('error')
      expect(new Headers(options.headers).has('authorization')).toBe(false)
      const response = new Response(SOURCE_ICON, {
        status: 200,
        headers: { 'content-length': String(SOURCE_ICON.length) },
      })
      Object.defineProperty(response, 'url', { value: ICON_URL })
      return response
    })
    await expect(downloadMatchingIcon(ICON_URL, SOURCE_ICON, fetchImpl)).resolves.toEqual(SOURCE_ICON)
    const changed = Buffer.from(SOURCE_ICON)
    changed[changed.length - 1] ^= 1
    await expect(downloadMatchingIcon(ICON_URL, SOURCE_ICON, async () => {
      const response = new Response(changed, { status: 200 })
      Object.defineProperty(response, 'url', { value: ICON_URL })
      return response
    })).rejects.toThrow(/do not match/)
  })
})
