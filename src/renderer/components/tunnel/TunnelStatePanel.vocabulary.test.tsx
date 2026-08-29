// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { usePersonalVocabulary } from '../../state/personalVocabulary'
import { useSchoolMode } from '../../state/schoolMode'
import { TunnelStatePanel } from './TunnelStatePanel'
import type { TunnelPortableIntent } from '@shared/tunnel-state'

const intent: TunnelPortableIntent = {
  schemaVersion: 1,
  nodeId: 'node-1',
  displayName: 'My tunnel',
  hostname: 'example.test',
  originProtocol: 'http',
  originPort: 8080,
  connectorMode: 'process',
  accessPolicyMode: 'unconfigured',
  routeMode: 'unbound'
}

afterEach(() => {
  cleanup()
  usePersonalVocabulary.setState({ status: 'no-file', entries: {}, entryCount: 0, loadedAt: null, lastError: null })
  useSchoolMode.setState({ enabled: false, hydrated: false })
})

describe('TunnelStatePanel personal vocabulary boundaries', () => {
  it('preserves a user-provided display name while mapping only the fallback label', () => {
    usePersonalVocabulary.setState({
      status: 'loaded',
      entries: { 'My tunnel': 'Mapped user intent', 'Cloudflare Tunnel': 'Mapped fallback' },
      entryCount: 2,
      loadedAt: Date.now(),
      lastError: null
    })
    useSchoolMode.setState({ enabled: false, hydrated: true })

    render(<TunnelStatePanel intent={intent} live={null} />)

    expect(screen.getByRole('heading', { name: 'My tunnel' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Mapped user intent' })).toBeNull()
  })

  it('maps the shipped fallback Cloudflare Tunnel label', () => {
    usePersonalVocabulary.setState({
      status: 'loaded',
      entries: { 'Cloudflare Tunnel': 'Mapped fallback' },
      entryCount: 1,
      loadedAt: Date.now(),
      lastError: null
    })
    useSchoolMode.setState({ enabled: false, hydrated: true })

    render(<TunnelStatePanel intent={{ ...intent, displayName: '' }} live={null} />)

    expect(screen.getByRole('heading', { name: 'Mapped fallback' })).toBeTruthy()
  })
})
