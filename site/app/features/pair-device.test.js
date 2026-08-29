import { readFileSync } from 'node:fs'
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

  it('publishes a loopback-only Docker recipe with an owner-only password file', () => {
    const article = readFileSync(new URL('../../docs/server-edition.html', import.meta.url), 'utf8')
    const recipe = [...article.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)]
      .map((match) => match[1])
      .join('\n')

    expect(recipe).toContain('-p 127.0.0.1:8443:8443')
    expect(recipe).toContain('--env-file ./nodeterm-server.env')
    expect(recipe).toContain('chmod 600 nodeterm-server.env')
    expect(recipe).toContain("read -rsp 'Initial password: '")
    expect(recipe).not.toMatch(/(?:^|\s)-p 8443:8443(?:\s|$)/)
    expect(recipe).not.toContain('-e NODETERM_SERVER_PASSWORD=')
    expect(article).toContain('user-defined private Docker network')
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
