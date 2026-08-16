import { readFileSync } from 'node:fs'
import path from 'node:path'
import { AppInfo } from 'app-builder-lib/out/appInfo'
import { getConfig, validateConfiguration } from 'app-builder-lib/out/util/config/config'
import { DebugLogger } from 'builder-util'
import SquirrelWindowsTarget from 'electron-builder-squirrel-windows/out/SquirrelWindowsTarget'
import { describe, expect, it, vi } from 'vitest'
import {
  WINDOWS_SQUIRREL_IDENTITY,
  applyWindowsSquirrelAppUserModelId,
  deriveWindowsSquirrelIdentity,
  squirrelAppUserModelId,
  type WindowsSquirrelPackageMetadata
} from './windows-squirrel-identity'

interface PackageMetadata extends WindowsSquirrelPackageMetadata {
  version: string
  description: string
}

interface PatchableSquirrelTarget {
  options: {
    useAppIdAsId?: boolean
  }
  createNuspecTemplateWithProjectUrl(): Promise<string>
  prepareSignedVendorDirectory(): Promise<string>
  select7zipArch(directory: string): void
}

const root = path.resolve(__dirname, '../..')
const packageMetadata = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf8')
) as PackageMetadata
const publishedBaselineNuspec = readFileSync(
  path.join(__dirname, 'fixtures/node-terminal-0.3.0.nuspec'),
  'utf8'
)

function nuspecMetadataValue(nuspec: string, element: string): string {
  const match = nuspec.match(new RegExp(`<${element}>([^<]+)</${element}>`))
  if (match == null) throw new Error(`Missing ${element} in baseline nuspec fixture`)
  return match[1]
}

describe('Windows Squirrel identity', () => {
  it('matches Electron Builder\'s effective Squirrel package id and executable', async () => {
    const config = await getConfig(root, null, null)
    await validateConfiguration(config, new DebugLogger(false))

    const appInfo = new AppInfo(
      {
        metadata: packageMetadata,
        devMetadata: {},
        config
      } as never,
      null,
      config.win
    )
    const packager = {
      platformSpecificBuildOptions: config.win ?? {},
      config,
      appInfo,
      info: {
        repositoryInfo: Promise.resolve({ user: 'fixture-owner', project: 'fixture-project' }),
        relativeBuildResourcesDirname: 'build'
      },
      resourceList: Promise.resolve([]),
      projectDir: root,
      buildResourcesDir: path.join(root, 'build')
    }
    const target = new SquirrelWindowsTarget(packager as never, path.join(root, 'dist'))
    const patchableTarget = target as unknown as PatchableSquirrelTarget
    patchableTarget.createNuspecTemplateWithProjectUrl = async () => 'fixture.nuspectemplate'
    patchableTarget.prepareSignedVendorDirectory = async () => path.join(root, 'fixture-vendor')
    patchableTarget.select7zipArch = () => undefined

    const effective = await target.computeEffectiveDistOptions(
      path.join(root, 'fixture-app'),
      path.join(root, 'fixture-output'),
      'fixture-Setup.exe'
    )

    expect(patchableTarget.options.useAppIdAsId).not.toBe(true)
    expect(effective.name).toBe(WINDOWS_SQUIRREL_IDENTITY.packageId)
    expect(effective.exe).toBe(`${WINDOWS_SQUIRREL_IDENTITY.executableName}.exe`)
    if (effective.name == null || effective.exe == null) {
      throw new Error('Electron Builder omitted its effective Squirrel identity')
    }
    expect(squirrelAppUserModelId(effective.name, effective.exe)).toBe(
      WINDOWS_SQUIRREL_IDENTITY.appUserModelId
    )
  })

  it('sets exactly the builder-derived AppUserModelID on Windows', () => {
    const setAppUserModelId = vi.fn()

    expect(applyWindowsSquirrelAppUserModelId('win32', { setAppUserModelId })).toBe(
      WINDOWS_SQUIRREL_IDENTITY.appUserModelId
    )
    expect(setAppUserModelId).toHaveBeenCalledOnce()
    expect(setAppUserModelId).toHaveBeenCalledWith('com.squirrel.node-terminal.nodeterm')
  })

  it('does not set a Windows identity on other operating systems', () => {
    const setAppUserModelId = vi.fn()

    expect(applyWindowsSquirrelAppUserModelId('darwin', { setAppUserModelId })).toBeNull()
    expect(applyWindowsSquirrelAppUserModelId('linux', { setAppUserModelId })).toBeNull()
    expect(setAppUserModelId).not.toHaveBeenCalled()
  })

  it('derives a distinct identity when the fixture package metadata is compiled', () => {
    expect(
      deriveWindowsSquirrelIdentity({
        name: 'node-terminal-squirrel-fixture',
        build: {
          appId: 'com.nodeterm.squirrel-fixture',
          productName: 'nodeterm Squirrel Fixture',
          squirrelWindows: {}
        }
      })
    ).toEqual({
      packageId: 'node-terminal-squirrel-fixture',
      executableName: 'nodeterm Squirrel Fixture',
      appUserModelId: 'com.squirrel.node-terminal-squirrel-fixture.nodetermSquirrelFixture'
    })
  })

  it('keeps the effective 0.4 package id continuous with the published 0.3 nupkg', async () => {
    const config = await getConfig(root, null, null)
    const appInfo = new AppInfo(
      {
        metadata: packageMetadata,
        devMetadata: {},
        config
      } as never,
      null,
      config.win
    )
    const target = new SquirrelWindowsTarget(
      {
        platformSpecificBuildOptions: config.win ?? {},
        config,
        appInfo
      } as never,
      path.join(root, 'dist')
    ) as unknown as PatchableSquirrelTarget

    expect(nuspecMetadataValue(publishedBaselineNuspec, 'version')).toBe('0.3.0')
    expect(nuspecMetadataValue(publishedBaselineNuspec, 'id')).toBe('node-terminal')
    expect(target.options.useAppIdAsId).not.toBe(true)
    expect(WINDOWS_SQUIRREL_IDENTITY.packageId).toBe(
      nuspecMetadataValue(publishedBaselineNuspec, 'id')
    )
  })

  it('fails closed if packaging could sanitize the executable into a different identity', () => {
    expect(() =>
      deriveWindowsSquirrelIdentity({
        name: 'node-terminal',
        build: {
          appId: 'com.nodeterm.app',
          productName: 'nodeterm?',
          squirrelWindows: { useAppIdAsId: false }
        }
      })
    ).toThrow(/valid filename/)
  })

  it('fails closed if useAppIdAsId would rename the established package', () => {
    expect(() =>
      deriveWindowsSquirrelIdentity({
        name: 'node-terminal',
        build: {
          appId: 'com.nodeterm.app',
          productName: 'nodeterm',
          squirrelWindows: { useAppIdAsId: true }
        }
      })
    ).toThrow(/preserve the existing Squirrel package identity/)
  })
})
