import { describe, expect, it, vi } from 'vitest'
import {
  applyWindowsAppUserModelId,
  WINDOWS_APP_USER_MODEL_ID
} from './windows-app-identity'

describe('Windows installed application identity', () => {
  it('uses the exact AppUserModelID Squirrel assigns to the nodeterm shortcut', () => {
    const setAppUserModelId = vi.fn()

    applyWindowsAppUserModelId('win32', setAppUserModelId)

    expect(WINDOWS_APP_USER_MODEL_ID).toBe('com.squirrel.node-terminal.nodeterm')
    expect(setAppUserModelId).toHaveBeenCalledOnce()
    expect(setAppUserModelId).toHaveBeenCalledWith('com.squirrel.node-terminal.nodeterm')
  })

  it.each(['darwin', 'linux'] as const)('does not claim a Windows identity on %s', (platform) => {
    const setAppUserModelId = vi.fn()

    applyWindowsAppUserModelId(platform, setAppUserModelId)

    expect(setAppUserModelId).not.toHaveBeenCalled()
  })
})
