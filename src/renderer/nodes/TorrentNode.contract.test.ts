import { describe, expect, it } from 'vitest'
import { torrentNodeOptionalFeatureVisible } from './TorrentNode'

describe('torrent node School-mode boundary', () => {
  it('omits the optional downloader while the shared mode is enabled or not hydrated', () => {
    expect(torrentNodeOptionalFeatureVisible({ enabled: true, hydrated: true })).toBe(false)
    expect(torrentNodeOptionalFeatureVisible({ enabled: false, hydrated: false })).toBe(false)
  })

  it('restores the downloader only after a confirmed disabled shared mode', () => {
    expect(torrentNodeOptionalFeatureVisible({ enabled: false, hydrated: true })).toBe(true)
  })
})
