import { describe, expect, it } from 'vitest'
import type { MinecraftServerStatus } from '@shared/minecraft'
import {
  acceptEulaDisabledReason,
  createServerDisabledReason,
  sendCommandDisabledReason,
  startServerDisabledReason,
  stopServerDisabledReason
} from './minecraftDisabledReasons'

function baseStatus(overrides: Partial<MinecraftServerStatus> = {}): MinecraftServerStatus {
  return {
    id: 'n1',
    phase: 'stopped',
    dir: '/tmp/server',
    versionId: '1.21.1',
    eulaAccepted: true,
    installedJavaMajor: null,
    installedJavaPath: null,
    requiredJavaMajor: 21,
    javaOk: false,
    javaReason: null,
    error: null,
    pid: null,
    startedAt: null,
    downloadedBytes: null,
    totalBytes: null,
    downloadPercent: null,
    // Connect-address fields. These arrived from the canvas-banner work after this fixture was
    // written, and the type requires them — a default here rather than making them optional on
    // the real status, because a running server always HAS a port, and softening the type to keep
    // one test compiling would push the uncertainty out to every consumer.
    port: 25565,
    localAddress: '127.0.0.1',
    // null is the honest default: this machine may have no usable LAN IPv4, and the banner is
    // required to say so rather than invent one.
    lanAddress: null,
    ...overrides
  }
}

describe('createServerDisabledReason', () => {
  it('is null (enabled) when busy — a transient state needs no explanation', () => {
    expect(createServerDisabledReason({ busy: true, selectedVersion: '', selectedDir: '' })).toBeNull()
  })

  it('names the missing folder specifically — this is the exact screenshot report', () => {
    expect(
      createServerDisabledReason({ busy: false, selectedVersion: '1.21.1', selectedDir: '' })
    ).toBe('Choose a server folder first.')
  })

  it('names the missing version specifically', () => {
    expect(
      createServerDisabledReason({ busy: false, selectedVersion: '', selectedDir: '/tmp/x' })
    ).toBe('Choose a Minecraft version first.')
  })

  it('names both when both are missing', () => {
    const reason = createServerDisabledReason({ busy: false, selectedVersion: '', selectedDir: '' })
    expect(reason).toContain('Choose a Minecraft version first')
    expect(reason).toContain('Choose a server folder first')
  })

  it('is null (enabled) once both are chosen', () => {
    expect(
      createServerDisabledReason({ busy: false, selectedVersion: '1.21.1', selectedDir: '/tmp/x' })
    ).toBeNull()
  })
})

describe('startServerDisabledReason', () => {
  it('is null while busy', () => {
    expect(startServerDisabledReason({ busy: true, status: baseStatus() })).toBeNull()
  })

  it('distinguishes "nothing installed" from "installed but wrong version"', () => {
    const nothingInstalled = startServerDisabledReason({
      busy: false,
      status: baseStatus({ installedJavaMajor: null, javaOk: false })
    })
    expect(nothingInstalled).toMatch(/no java runtime is installed/i)

    const wrongVersion = startServerDisabledReason({
      busy: false,
      status: baseStatus({ installedJavaMajor: 8, javaOk: false, javaReason: 'Java 8 is too old for this version.' })
    })
    expect(wrongVersion).toBe('Java 8 is too old for this version.')
  })

  it('is null once Java is ok', () => {
    expect(
      startServerDisabledReason({ busy: false, status: baseStatus({ installedJavaMajor: 21, javaOk: true }) })
    ).toBeNull()
  })
})

describe('acceptEulaDisabledReason', () => {
  it('names the unchecked box', () => {
    expect(acceptEulaDisabledReason({ busy: false, eulaChecked: false })).toMatch(/check the box/i)
  })
  it('is null once checked', () => {
    expect(acceptEulaDisabledReason({ busy: false, eulaChecked: true })).toBeNull()
  })
})

describe('sendCommandDisabledReason', () => {
  it('says the server is not running', () => {
    expect(sendCommandDisabledReason({ phase: 'stopped', commandDraft: 'say hi' })).toMatch(/not running/i)
  })
  it('says there is nothing to send while running with an empty draft', () => {
    expect(sendCommandDisabledReason({ phase: 'running', commandDraft: '   ' })).toMatch(/type a command/i)
  })
  it('is null once running with a real command', () => {
    expect(sendCommandDisabledReason({ phase: 'running', commandDraft: 'say hi' })).toBeNull()
  })
})

describe('stopServerDisabledReason', () => {
  it('says the server is not running', () => {
    expect(stopServerDisabledReason({ phase: 'stopped' })).toMatch(/not running/i)
  })
  it('is null while running', () => {
    expect(stopServerDisabledReason({ phase: 'running' })).toBeNull()
  })
})
