import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spectreLibComplaints } from './windows-spectre-preflight.mjs'

describe('Windows Spectre preflight', () => {
  let root = ''
  let installationPath = ''
  let msvc = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nodeterm preflight ! '))
    installationPath = join(root, 'Build Tools')
    msvc = join(installationPath, 'VC', 'Tools', 'MSVC')
  })

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  function addLibraries(version, architectures) {
    for (const arch of architectures) {
      const dir = join(msvc, version, 'lib', 'spectre', arch)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'vcruntime.lib'), arch)
    }
  }

  function complaints(arch, installs, fs) {
    const calls = []
    const result = spectreLibComplaints({
      platform: 'win32',
      arch,
      programFilesX86: join(root, 'Program Files (x86)'),
      execFile: (program, args) => {
        calls.push({ program, args: [...args] })
        return JSON.stringify(installs ?? [
          {
            installationPath,
            installationVersion: '17.14.37516.0',
            displayName: 'Visual Studio Build Tools 2022'
          }
        ])
      },
      ...(fs ? { fs } : {})
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toEqual(['-products', '*', '-format', 'json'])
    return result
  }

  it('rejects empty latest directories and does not accept mitigated libraries in an older toolset', () => {
    addLibraries('14.43.34808', ['x86', 'x64'])
    mkdirSync(join(msvc, '14.44.35207', 'lib', 'spectre', 'x86'), { recursive: true })
    mkdirSync(join(msvc, '14.44.35207', 'lib', 'spectre', 'x64'), { recursive: true })

    expect(complaints('x64').join('\n')).toContain('toolset 14.44.35207')
    expect(complaints('x64').join('\n')).toContain('x86, x64')
  })

  it('requires ARM64 libraries as well as x86/x64 on an ARM64 host', () => {
    addLibraries('14.44.35207', ['x86', 'x64'])
    mkdirSync(join(msvc, '14.44.35207', 'lib', 'spectre', 'arm64'), { recursive: true })

    expect(complaints('arm64').join('\n')).toContain('arm64')

    writeFileSync(
      join(msvc, '14.44.35207', 'lib', 'spectre', 'arm64', 'vcruntime.lib'),
      'arm64'
    )
    expect(complaints('arm64')).toEqual([])
  })

  it('does not let complete VS 2019 libraries mask the selected VS 2022 toolset', () => {
    const oldInstallation = join(root, 'Visual Studio 2019')
    const oldMsvc = join(oldInstallation, 'VC', 'Tools', 'MSVC')
    for (const arch of ['x86', 'x64']) {
      const dir = join(oldMsvc, '14.29.30133', 'lib', 'spectre', arch)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'vcruntime.lib'), arch)
    }
    mkdirSync(join(msvc, '14.44.35207'), { recursive: true })

    const result = complaints('x64', [
      {
        installationPath: oldInstallation,
        installationVersion: '16.11.50.0',
        displayName: 'Visual Studio Build Tools 2019'
      },
      {
        installationPath,
        installationVersion: '17.14.37516.0',
        displayName: 'Visual Studio Build Tools 2022'
      }
    ])
    expect(result.join('\n')).toContain('Visual Studio Build Tools 2022')
    expect(result.join('\n')).toContain('x86, x64')
  })

  it('keeps an unreadable library probe unknown instead of claiming the files are absent', () => {
    const denied = Object.assign(new Error('access denied'), { code: 'EACCES' })
    const fs = {
      readdir(path) {
        if (path === msvc) return [{ name: '14.44.35207', isDirectory: () => true }]
        throw denied
      }
    }
    expect(complaints('x64', undefined, fs)).toEqual([])
  })
})
