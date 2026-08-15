import { describe, expect, it, vi } from 'vitest'
import { getRoom } from '../core/engine.js'
import {
  IOS_APP_STORE_URL,
  SERVER_EDITION_DOC_URL,
  registerPairDevice,
  remoteAccessRoomHtml,
} from './pair-device.js'

describe('Pages playground remote access routes', () => {
  it('registers an informational room without a pairing action', () => {
    const registerAction = vi.fn()

    registerPairDevice({}, {}, registerAction)

    expect(registerAction).not.toHaveBeenCalled()
    expect(getRoom('pair').render()).toBe(remoteAccessRoomHtml())
  })

  it('routes browser users to the Server Edition guide and iOS users to the live app', () => {
    const html = remoteAccessRoomHtml()

    expect(new URL(SERVER_EDITION_DOC_URL).pathname).toMatch(/\/site\/docs\/server-edition\.html$/)
    expect(new URL(IOS_APP_STORE_URL).hostname).toBe('apps.apple.com')
    expect(html).toContain(`href="${SERVER_EDITION_DOC_URL}"`)
    expect(html).toContain(`href="${IOS_APP_STORE_URL}"`)
    expect(html).toContain('including its Docker image')
  })

  it('states that this static tour does not perform the credential exchange', () => {
    const html = remoteAccessRoomHtml()
    const copy = html.replace(/\s+/g, ' ')

    expect(copy).toContain('not a terminal client')
    expect(copy).toContain('does not ask for a pairing code or install an SSH key')
    expect(html).not.toContain('data-action="pair-')
    expect(html).not.toContain('<textarea')
  })
})
