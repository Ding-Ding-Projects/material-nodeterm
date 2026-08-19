import { describe, expect, it } from 'vitest'
import { parseChangelog } from './changelog'

describe('parseChangelog', () => {
  it('parses a released version heading with its date, category and bullets', () => {
    const sha = 'a'.repeat(40)
    const md = `## [1.2.3] — 2026-01-15\n\nCommit: [\`${sha}\`](https://example.com/commit/${sha})\n\n### Added\n\n- did a thing\n- did another thing\n`
    const [release] = parseChangelog(md)
    expect(release.version).toBe('1.2.3')
    expect(release.date).toBe('2026-01-15')
    expect(release.dateMs).toBe(Date.parse('2026-01-15T00:00:00.000Z'))
    expect(release.commits).toEqual([
      { sha, label: sha, url: `https://example.com/commit/${sha}` }
    ])
    expect(release.items).toEqual([
      { category: 'Added', text: 'did a thing' },
      { category: 'Added', text: 'did another thing' }
    ])
  })

  it('parses "Unreleased" with no date and multiple commits, wrapped across lines', () => {
    const sha1 = '1'.repeat(40)
    const sha2 = '2'.repeat(40)
    const md =
      `## [Unreleased]\n\n` +
      `Commits: [\`${sha1.slice(0, 8)}\`](https://example.com/commit/${sha1}) ·\n` +
      `[\`${sha2.slice(0, 8)}\`](https://example.com/commit/${sha2})\n\n` +
      `### Fixed\n\n- fixed it\n`
    const [release] = parseChangelog(md)
    expect(release.version).toBe('Unreleased')
    expect(release.date).toBeNull()
    expect(release.dateMs).toBeNull()
    expect(release.commits.map((c) => c.sha)).toEqual([sha1, sha2])
    expect(release.commits.map((c) => c.label)).toEqual([sha1.slice(0, 8), sha2.slice(0, 8)])
  })

  it('joins a bullet that wraps across continuation lines into one item', () => {
    const md = `## [1.0.0] — 2026-01-01\n\n### Fixed\n\n- **A long title.** The first sentence\n  continues on the next line,\n  and a third.\n`
    const [release] = parseChangelog(md)
    expect(release.items).toEqual([
      { category: 'Fixed', text: '**A long title.** The first sentence continues on the next line, and a third.' }
    ])
  })

  it('resets the current bullet on a blank line, so unrelated prose is never appended to it', () => {
    const md = `## [1.0.0] — 2026-01-01\n\n### Fixed\n\n- one thing\n\nnot part of any bullet\n\n- another thing\n`
    const [release] = parseChangelog(md)
    expect(release.items).toEqual([
      { category: 'Fixed', text: 'one thing' },
      { category: 'Fixed', text: 'another thing' }
    ])
  })

  it('keeps categories as an open set, never a hard-coded closed list', () => {
    const md = `## [1.0.0] — 2026-01-01\n\n### Performance\n\n- faster now\n\n### Security\n\n- patched a hole\n`
    const [release] = parseChangelog(md)
    expect(release.items.map((i) => i.category)).toEqual(['Performance', 'Security'])
  })

  it('never starts a release for an unbracketed heading like "## Earlier releases"', () => {
    const md = `## [1.0.0] — 2026-01-01\n\n### Fixed\n\n- one\n\n## Earlier releases\n\nSome prose that names no version.\n\n\`\`\`bash\ngit log --oneline\n\`\`\`\n`
    const releases = parseChangelog(md)
    expect(releases).toHaveLength(1)
    expect(releases[0].items).toEqual([{ category: 'Fixed', text: 'one' }])
  })

  it('returns releases in document order (the file itself is newest-first)', () => {
    const md = `## [Unreleased]\n\n### Added\n\n- new stuff\n\n## [1.0.0] — 2026-01-01\n\n### Fixed\n\n- old fix\n`
    const releases = parseChangelog(md)
    expect(releases.map((r) => r.version)).toEqual(['Unreleased', '1.0.0'])
  })

  it('parses no releases from an empty or heading-less document', () => {
    expect(parseChangelog('')).toEqual([])
    expect(parseChangelog('Just some prose, no headings at all.\n')).toEqual([])
  })

  it('handles CRLF line endings identically to LF', () => {
    const lf = `## [1.0.0] — 2026-01-01\n\n### Fixed\n\n- one\n- two\n`
    const crlf = lf.replace(/\n/g, '\r\n')
    expect(parseChangelog(crlf)).toEqual(parseChangelog(lf))
  })
})
