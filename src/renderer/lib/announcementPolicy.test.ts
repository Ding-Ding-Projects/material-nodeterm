import { describe, it, expect } from 'vitest'
import { isSolicitationAnnouncement } from './announcementPolicy'

describe('isSolicitationAnnouncement', () => {
  it('suppresses a GitHub-stars nag', () => {
    expect(
      isSolicitationAnnouncement({
        title: 'nodeterm just hit 600 GitHub stars!',
        body: 'A GitHub star would mean a lot to us — help us reach 1K!'
      })
    ).toBe(true)
  })

  it('suppresses a donation / sponsorship nag', () => {
    expect(
      isSolicitationAnnouncement({
        title: 'Support nodeterm',
        body: 'If you love nodeterm, consider sponsoring us on GitHub Sponsors or buying us a coffee.'
      })
    ).toBe(true)
  })

  it('suppresses a "rate us" / review nag', () => {
    expect(
      isSolicitationAnnouncement({
        title: 'Enjoying nodeterm?',
        body: 'Please leave us a review — it really helps!'
      })
    ).toBe(true)
  })

  it('suppresses a paid-upgrade nag', () => {
    expect(
      isSolicitationAnnouncement({
        title: 'Unlock more',
        body: 'Upgrade to Pro today and support ongoing development.'
      })
    ).toBe(true)
  })

  it('keeps a security notice', () => {
    expect(
      isSolicitationAnnouncement({
        title: 'Security advisory',
        body: 'We patched a critical vulnerability (CVE-2026-12345) in the SSH transport. Update as soon as possible.'
      })
    ).toBe(false)
  })

  it('keeps a breaking-change notice', () => {
    expect(
      isSolicitationAnnouncement({
        title: 'Breaking change in v3.0',
        body: 'The old workspace file format is no longer supported after this release.'
      })
    ).toBe(false)
  })

  it('keeps a plain, non-promotional release note', () => {
    expect(
      isSolicitationAnnouncement({
        title: 'v0.4 is out',
        body: 'See the changelog for details.'
      })
    ).toBe(false)
  })

  it('keeps a message that mentions both a nag and a security fix', () => {
    expect(
      isSolicitationAnnouncement({
        title: 'We hit 600 GitHub stars! Also: a critical fix',
        body: 'Thanks for the stars! This release also patches a critical vulnerability, please update.'
      })
    ).toBe(false)
  })

  it('never filters a mandatory-update message, even if it also carries nag wording', () => {
    expect(
      isSolicitationAnnouncement({
        title: 'Mandatory update required',
        body: 'This version is no longer supported. While you are here, please also star us on GitHub!'
      })
    ).toBe(false)
  })

  it('handles missing/empty text', () => {
    expect(isSolicitationAnnouncement(null)).toBe(false)
    expect(isSolicitationAnnouncement(undefined)).toBe(false)
    expect(isSolicitationAnnouncement({})).toBe(false)
    expect(isSolicitationAnnouncement({ title: '', body: '' })).toBe(false)
    expect(isSolicitationAnnouncement({ title: '   ', body: undefined })).toBe(false)
  })
})
