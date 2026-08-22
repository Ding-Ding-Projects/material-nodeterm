import { describe, expect, it } from 'vitest'
import type { CanvasNodeState } from './types'
import {
  applyLocalNodeExec,
  localNodeExec,
  safeServiceConnection,
  safeServiceEndpoint,
  sanitizeInboundNode,
  stripSharedNodeExec
} from './node-exec'

const node = (over: Partial<CanvasNodeState> = {}): CanvasNodeState =>
  ({
    id: 'proxmox-a-1',
    kind: 'proxmox',
    position: { x: 0, y: 0 },
    size: { width: 520, height: 400 },
    title: 'Proxmox',
    color: '#0a84ff',
    group: null,
    ...over
  }) as CanvasNodeState

describe('service endpoints we are willing to store', () => {
  it('accepts the schemes a manager actually uses', () => {
    for (const ok of [
      'https://proxmox.local:8006',
      'http://127.0.0.1:8123',
      'ssh://docker@192.168.1.10',
      // The one that a mangled control-character class would have rejected while looking like a
      // security check. Hyphens are ordinary in hostnames.
      'https://my-home-server.local:9443/api'
    ]) {
      expect(safeServiceEndpoint(ok), ok).toBe(true)
    }
  })

  it('refuses a URL carrying a password, which is the whole point', () => {
    // A URL is the commonest way a password reaches a settings field, and this record is written to
    // disk in plain text. Storing it would put the secret in workspace.json, in every backup of it,
    // and in any screenshot of the file.
    expect(safeServiceEndpoint('https://user:hunter2@proxmox.local:8006')).toBe(false)
    expect(safeServiceEndpoint('https://user@proxmox.local:8006')).toBe(false)
    // ...but an ssh USERNAME is the target, not a secret. `ssh://docker@host` is the standard way
    // to name a Docker host, so refusing it would reject the likeliest endpoint this will ever be
    // given. A password is still refused there, because a password on disk is a password on disk
    // whatever the scheme.
    expect(safeServiceEndpoint('ssh://docker@192.168.1.10')).toBe(true)
    expect(safeServiceEndpoint('ssh://docker:secret@192.168.1.10')).toBe(false)
    // Percent-encoded, which a regex on the raw string would have waved through.
    expect(safeServiceEndpoint('https://user:pass%40word@host.local')).toBe(false)
  })

  it('refuses a scheme nobody vetted', () => {
    for (const bad of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,hi',
      'ftp://host.local'
    ]) {
      expect(safeServiceEndpoint(bad), bad).toBe(false)
    }
  })

  it('refuses control characters and nonsense', () => {
    expect(safeServiceEndpoint('https://host.local/\npath')).toBe(false)
    expect(safeServiceEndpoint('')).toBe(false)
    expect(safeServiceEndpoint('not a url')).toBe(false)
    expect(safeServiceEndpoint(undefined)).toBe(false)
    expect(safeServiceEndpoint(`https://host.local/${'a'.repeat(4000)}`)).toBe(false)
  })

  it('keeps a whole connection or none, never half of one', () => {
    // A record with no usable endpoint would render a node that looks configured and cannot
    // connect, which is a worse state than an unconfigured one.
    expect(safeServiceConnection({ credentialKey: 'k' })).toBeUndefined()
    expect(safeServiceConnection({ endpoint: 'file:///x', credentialKey: 'k' })).toBeUndefined()
    expect(safeServiceConnection(null)).toBeUndefined()
    const ok = safeServiceConnection({ endpoint: 'https://host.local', credentialKey: 'svc:1' })
    expect(ok).toEqual({ endpoint: 'https://host.local', credentialKey: 'svc:1' })
  })

  it('drops a malformed credential key but keeps the endpoint', () => {
    // The key only names a vault entry; a bad one costs a lookup, not the connection.
    const c = safeServiceConnection({ endpoint: 'https://host.local', credentialKey: 'has space' })
    expect(c).toEqual({ endpoint: 'https://host.local' })
  })
})

describe('the connection never reaches the shared document', () => {
  const configured = node({
    serviceConnection: { endpoint: 'https://proxmox.local:8006', credentialKey: 'svc:pve' }
  })

  it('is stripped from what we write to project.json', () => {
    const [out] = stripSharedNodeExec([configured])
    expect(out.serviceConnection).toBeUndefined()
    // Everything else survives: this is a strip, not a wipe.
    expect(out.kind).toBe('proxmox')
    expect(out.title).toBe('Proxmox')
  })

  it('is stripped from a node arriving over the wire', () => {
    // Without this the disk half is worthless: a peer mutation is applied verbatim, and the next
    // save would harvest the peer's endpoint into OUR machine-local index, where it would be
    // reattached as ours on every load thereafter.
    const out = sanitizeInboundNode(configured)
    expect(out.serviceConnection).toBeUndefined()
  })

  it('round-trips through the machine-local index instead', () => {
    const overlay = localNodeExec([configured])
    expect(overlay?.['proxmox-a-1']?.serviceConnection).toEqual({
      endpoint: 'https://proxmox.local:8006',
      credentialKey: 'svc:pve'
    })
    const [restored] = applyLocalNodeExec(stripSharedNodeExec([configured]), overlay)
    expect(restored.serviceConnection).toEqual({
      endpoint: 'https://proxmox.local:8006',
      credentialKey: 'svc:pve'
    })
  })

  it('refuses a bad connection on the way IN, so a peer cannot launder one', () => {
    const hostile = node({
      serviceConnection: { endpoint: 'file:///etc/passwd' } as never
    })
    expect(localNodeExec([hostile])?.['proxmox-a-1']).toBeUndefined()
  })

  it('refuses a bad connection on the way OUT, so an old record cannot be honoured', () => {
    // The index is machine-local but it is still a file. A hand edit, a partial write, or a record
    // from an older build all reach this path, and something we would refuse to accept today must
    // not be trusted merely because it is already on disk.
    const [restored] = applyLocalNodeExec([node()], {
      'proxmox-a-1': { serviceConnection: { endpoint: 'javascript:alert(1)' } as never }
    })
    expect(restored.serviceConnection).toBeUndefined()
  })
})
