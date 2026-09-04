import { describe, it, expect } from 'vitest'
import { classifyAnnouncement, shouldShowAnnouncement } from './announcementPolicy'

describe('classifyAnnouncement', () => {
  describe('promotional — never rendered', () => {
    it('classifies the cross-sell that motivated this gate (app store + subscribe)', () => {
      const kind = classifyAnnouncement({
        title: 'Our iOS app is officially live on the App Store!',
        body: "If you love what we're building, we'd really appreciate it if you could subscribe to the iOS app."
      })
      expect(kind).toBe('promotional')
    })

    it('classifies the same cross-sell without the words "app store" or "subscribe"', () => {
      // The blocklist this replaced only caught literal nag phrasings; a reworded promo has to
      // fail too, otherwise the gate is one rewrite away from useless.
      expect(
        classifyAnnouncement({
          title: 'Our new mobile app is here',
          body: 'Grab it and let us know what you think!',
          url: 'https://store.example.invalid/app/example'
        })
      ).toBe('promotional')
    })

    it('classifies a GitHub-stars nag', () => {
      expect(
        classifyAnnouncement({
          title: 'nodeterm just hit 600 GitHub stars!',
          body: 'A GitHub star would mean a lot to us — help us reach 1K!'
        })
      ).toBe('promotional')
    })

    it('classifies a donation / sponsorship nag', () => {
      expect(
        classifyAnnouncement({
          title: 'Support the project',
          body: 'Consider sponsoring us on GitHub Sponsors or buying us a coffee.'
        })
      ).toBe('promotional')
    })

    it('classifies a rate/review nag', () => {
      expect(
        classifyAnnouncement({
          title: 'Enjoying the app?',
          body: 'Please leave us a review — it really helps!'
        })
      ).toBe('promotional')
    })

    it('classifies a paid-upgrade nag', () => {
      expect(
        classifyAnnouncement({
          title: 'Unlock more',
          body: 'Upgrade to Pro today — 20% off for a limited time.'
        })
      ).toBe('promotional')
    })

    it('classifies a promo that dresses itself up as urgent (promotional beats operational)', () => {
      // Fail closed for marketing: a campaign that sprinkles in "critical"/"security" must not
      // buy itself a render. The blocking required-update path is UpdateCard, not this banner.
      expect(
        classifyAnnouncement({
          title: 'Critical: our new iOS app is live',
          body: 'A security-hardened mobile client — subscribe now!'
        })
      ).toBe('promotional')
    })

    it('classifies a promo whose only tell is the donation link', () => {
      expect(
        classifyAnnouncement({
          title: 'Thanks for using it',
          body: 'A note from the team.',
          url: 'https://github.com/sponsors/example'
        })
      ).toBe('promotional')
    })
  })

  describe('operational — still rendered', () => {
    it('classifies a security notice', () => {
      expect(
        classifyAnnouncement({
          title: 'Security advisory',
          body: 'A vulnerability (CVE-2026-12345) in the SSH transport is fixed in this build.'
        })
      ).toBe('operational')
    })

    it('classifies a mandatory-update notice', () => {
      expect(
        classifyAnnouncement({
          title: 'Mandatory update',
          body: 'This version is no longer supported and will stop connecting.'
        })
      ).toBe('operational')
    })

    it('classifies a "this release is broken" warning', () => {
      expect(
        classifyAnnouncement({
          title: 'v0.4.1 is broken — do not install',
          body: 'A regression can corrupt the workspace file. Roll back to v0.4.0.'
        })
      ).toBe('operational')
    })

    it('classifies an outage notice', () => {
      expect(
        classifyAnnouncement({
          title: 'Sync outage',
          body: 'The relay is degraded; sessions may not reconnect until the incident is resolved.'
        })
      ).toBe('operational')
    })

    it('classifies a breaking-change / deprecation notice', () => {
      expect(
        classifyAnnouncement({
          title: 'Breaking change in v3.0',
          body: 'The old workspace file format is deprecated after this release.'
        })
      ).toBe('operational')
    })
  })

  describe('unknown — fail closed', () => {
    it('does not classify ordinary product news as operational', () => {
      // "v0.4 is out, see the changelog" is not something a terminal must interrupt anyone for,
      // and treating "mentions a release" as operational is the loophole a promo would use.
      expect(
        classifyAnnouncement({
          title: 'v0.4 is out — editor & diff nodes',
          body: 'See the changelog for details.'
        })
      ).toBe('unknown')
    })

    it('treats missing / empty text as unknown', () => {
      expect(classifyAnnouncement(null)).toBe('unknown')
      expect(classifyAnnouncement(undefined)).toBe('unknown')
      expect(classifyAnnouncement({})).toBe('unknown')
      expect(classifyAnnouncement({ title: '', body: '' })).toBe('unknown')
      expect(classifyAnnouncement({ title: '   ', body: undefined })).toBe('unknown')
    })
  })
})

describe('shouldShowAnnouncement', () => {
  it('shows only operational messages', () => {
    expect(
      shouldShowAnnouncement({
        title: 'Security advisory',
        body: 'Update immediately: a vulnerability in the SSH transport is fixed in this build.'
      })
    ).toBe(true)
  })

  it('refuses a promotional message', () => {
    expect(
      shouldShowAnnouncement({
        title: 'Our iOS app is officially live on the App Store!',
        body: "If you love what we're building, we'd really appreciate it if you could subscribe."
      })
    ).toBe(false)
  })

  it('refuses an unclassifiable message', () => {
    expect(shouldShowAnnouncement({ title: 'Hello', body: 'Some words.' })).toBe(false)
  })

  it('refuses nothing at all', () => {
    expect(shouldShowAnnouncement(null)).toBe(false)
    expect(shouldShowAnnouncement(undefined)).toBe(false)
    expect(shouldShowAnnouncement({})).toBe(false)
  })
})
