import { describe, expect, it } from 'vitest'
import {
  MinecraftMetadataError,
  checkJavaCompatibility,
  parseServerDownload,
  parseVersionManifest,
  resolveServerDownload,
  verifySha1
} from './version-resolve'

const MANIFEST = {
  latest: { release: '1.21.4', snapshot: '25w01a' },
  versions: [
    { id: '1.21.4', type: 'release', url: 'https://example.test/1.21.4.json' },
    { id: '25w01a', type: 'snapshot', url: 'https://example.test/25w01a.json' }
  ]
}

const VERSION_DOC = {
  id: '1.21.4',
  javaVersion: { component: 'java-runtime-delta', majorVersion: 21 },
  downloads: {
    server: {
      sha1: 'a'.repeat(40),
      size: 54_000_000,
      url: 'https://example.test/server.jar'
    },
    client: { sha1: 'b'.repeat(40), size: 1, url: 'https://example.test/client.jar' }
  }
}

describe('version manifest', () => {
  it('reads the version list', () => {
    const versions = parseVersionManifest(MANIFEST)
    expect(versions).toHaveLength(2)
    expect(versions[0]).toEqual({ id: '1.21.4', type: 'release', url: 'https://example.test/1.21.4.json' })
  })

  it('skips a malformed entry without denying the rest', () => {
    // One bad record in a list of hundreds must not cost the user every other version.
    const versions = parseVersionManifest({
      versions: [{ id: 'good', type: 'release', url: 'u' }, null, { id: 'no-url' }, 'nonsense']
    })
    expect(versions.map((v) => v.id)).toEqual(['good'])
  })

  it('refuses a document that is not a manifest, rather than calling it empty', () => {
    // "There are no versions" and "this is not the manifest" are different answers, and reporting
    // the second as the first sends the user to look for a Mojang outage that is not happening.
    expect(() => parseVersionManifest({ nope: true })).toThrow(MinecraftMetadataError)
    expect(() => parseVersionManifest('a string')).toThrow(MinecraftMetadataError)
    expect(() => parseVersionManifest(null)).toThrow(MinecraftMetadataError)
  })

  it('names the field when the shape has drifted', () => {
    try {
      parseVersionManifest({ nope: true })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as MinecraftMetadataError).field).toBe('versions')
    }
  })
})

describe('per-version document — the second fetch', () => {
  it('carries the url, the checksum and the Java pin', () => {
    const d = parseServerDownload('1.21.4', VERSION_DOC)
    expect(d.url).toBe('https://example.test/server.jar')
    expect(d.sha1).toBe('a'.repeat(40))
    expect(d.sizeBytes).toBe(54_000_000)
    // The pin nothing was checking. Reading it is the entire reason for the second request.
    expect(d.requiredJavaMajor).toBe(21)
  })

  it('treats a missing checksum as fatal, never as a warning', () => {
    // Downloading an artifact nobody can verify is worse than not downloading it, because it looks
    // like success. This is the assertion that keeps the second fetch worth making.
    const doc = { downloads: { server: { url: 'https://example.test/server.jar' } } }
    expect(() => parseServerDownload('1.21.4', doc)).toThrow(/sha1/i)
  })

  it('says a version publishes no server, rather than calling the document malformed', () => {
    const doc = { downloads: { client: { sha1: 'b'.repeat(40), url: 'u' } } }
    expect(() => parseServerDownload('1.2.5', doc)).toThrow(/no server download/i)
  })

  it('reports an absent Java pin as null, not as zero or as "any version"', () => {
    // Older versions predate the field. Unstated is a real state and must stay distinguishable
    // from a requirement we failed to read.
    const d = parseServerDownload('1.7.10', {
      downloads: { server: { sha1: 'c'.repeat(40), url: 'u' } }
    })
    expect(d.requiredJavaMajor).toBeNull()
  })

  it('drops a nonsense size but keeps the download', () => {
    const d = parseServerDownload('1.21.4', {
      downloads: { server: { sha1: 'a'.repeat(40), url: 'u', size: -1 } }
    })
    // A missing size is a weaker signal than a missing checksum and must not block a download that
    // can still be verified by hash.
    expect(d.sizeBytes).toBeUndefined()
    expect(d.sha1).toBe('a'.repeat(40))
  })
})

describe('resolving end to end', () => {
  it('makes BOTH fetches, in the order that makes the second meaningful', async () => {
    const seen: string[] = []
    const fetchJson = async (url: string): Promise<unknown> => {
      seen.push(url)
      return url.endsWith('version_manifest_v2.json') ? MANIFEST : VERSION_DOC
    }
    const d = await resolveServerDownload('1.21.4', fetchJson, 'https://example.test/version_manifest_v2.json')
    expect(seen).toEqual([
      'https://example.test/version_manifest_v2.json',
      'https://example.test/1.21.4.json'
    ])
    expect(d.sha1).toBe('a'.repeat(40))
    expect(d.requiredJavaMajor).toBe(21)
  })

  it('refuses an unknown version instead of fetching a guessed URL', async () => {
    const fetchJson = async (): Promise<unknown> => MANIFEST
    await expect(
      resolveServerDownload('9.9.9', fetchJson, 'https://example.test/version_manifest_v2.json')
    ).rejects.toThrow(/not in the version manifest/i)
  })
})

describe('Java compatibility', () => {
  it('passes when nothing is pinned', () => {
    expect(checkJavaCompatibility(null, 8).ok).toBe(true)
    expect(checkJavaCompatibility(null, null).ok).toBe(true)
  })

  it('refuses a Java that is definitely too old, and says what it will look like', () => {
    const r = checkJavaCompatibility(21, 17)
    expect(r.ok).toBe(false)
    // The message earns its length: this failure presents as a corrupt download, so a user told
    // only "it did not start" goes and re-downloads a perfectly good jar.
    expect(r.reason).toMatch(/corrupt download/i)
  })

  it('refuses when no Java could be found at all', () => {
    expect(checkJavaCompatibility(21, null).ok).toBe(false)
  })

  it('allows a newer Java through, rather than blocking a combination that works', () => {
    expect(checkJavaCompatibility(17, 21).ok).toBe(true)
    expect(checkJavaCompatibility(21, 21).ok).toBe(true)
  })
})

describe('checksum verification', () => {
  it('accepts a match in either case', () => {
    expect(verifySha1('A'.repeat(40), 'a'.repeat(40)).ok).toBe(true)
  })

  it('rejects a mismatch', () => {
    const r = verifySha1('a'.repeat(40), 'b'.repeat(40))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/does not match/i)
  })

  it('refuses to accept a download on trust when the published digest is not a sha1', () => {
    // An empty or truncated expectation must not compare equal to anything. Without the length and
    // shape check, `'' === ''` would wave a completely unverified artifact through.
    for (const bad of ['', 'abc', 'z'.repeat(40), ' '.repeat(40)]) {
      expect(verifySha1(bad, bad).ok).toBe(false)
    }
  })
})
