import { describe, it, expect } from 'vitest'
import {
  buildArticle,
  docSectionFor,
  docTitleFrom,
  groupArticles,
  headingSlug,
  resolveDocLink,
  resolveDocPath,
  searchArticles,
  splitSearchWindows,
  type DocArticle
} from './docs'

function article(path: string, body: string): DocArticle {
  return buildArticle(path, body)
}

describe('docTitleFrom', () => {
  it('takes the first H1', () => {
    expect(docTitleFrom('docs/a.md', '# Regex builder\n\nbody\n\n# Later\n')).toBe('Regex builder')
  })

  it('ignores an H2 and a hash inside a line', () => {
    expect(docTitleFrom('docs/session-memory.md', '## Not this\n\nsee #1234\n')).toBe('Session memory')
  })

  it('humanizes the filename when there is no H1 at all', () => {
    expect(docTitleFrom('docs/features/remote/ssh_projects.md', 'no heading here')).toBe('Ssh projects')
  })
})

describe('docSectionFor', () => {
  it('files top-level docs under Reference', () => {
    expect(docSectionFor('docs/regex-builder.md')).toBe('Reference')
  })

  it('files the features index under Features', () => {
    expect(docSectionFor('docs/features/README.md')).toBe('Features')
  })

  it('files a feature area under its own humanized name', () => {
    expect(docSectionFor('docs/features/source-control/source-control-and-worktrees.md')).toBe('Source control')
  })
})

describe('groupArticles', () => {
  it('orders Features first, Reference last, and a README ahead of its siblings', () => {
    const grouped = groupArticles([
      article('docs/zzz.md', '# Zzz'),
      article('docs/features/terminals/session-continuity.md', '# Session continuity'),
      article('docs/features/terminals/README.md', '# Terminals'),
      article('docs/features/README.md', '# Feature documentation')
    ])
    expect(grouped.map((s) => s.label)).toEqual(['Features', 'Terminals', 'Reference'])
    expect(grouped[1].articles.map((a) => a.title)).toEqual(['Terminals', 'Session continuity'])
  })
})

describe('headingSlug', () => {
  it('matches the GitHub shape a `#anchor` link expects', () => {
    expect(headingSlug('Credential storage')).toBe('credential-storage')
    expect(headingSlug('  The `tmux` socket — why?  ')).toBe('the-tmux-socket--why')
  })

  it('keeps non-Latin letters rather than emptying the slug', () => {
    expect(headingSlug('說明')).toBe('說明')
  })
})

describe('resolveDocPath', () => {
  it('resolves ./ and ../ against the containing directory', () => {
    expect(resolveDocPath('docs/features/remote/README.md', './ssh-projects.md')).toBe(
      'docs/features/remote/ssh-projects.md'
    )
    expect(resolveDocPath('docs/features/remote/README.md', '../terminals/README.md')).toBe(
      'docs/features/terminals/README.md'
    )
  })

  it('keeps a `..` that climbs past the root instead of quietly swallowing it', () => {
    // `docs/features/x.md` + `../../../elsewhere.md` escapes the repo; the resolved path must stay
    // visibly wrong so it lands as `missing`, not as a plausible in-repo file.
    expect(resolveDocPath('docs/features/x.md', '../../../elsewhere.md')).toBe('../elsewhere.md')
  })

  it('treats a leading slash as repo-root-relative', () => {
    expect(resolveDocPath('docs/features/x.md', '/docs/windows.md')).toBe('docs/windows.md')
  })
})

describe('resolveDocLink', () => {
  const known = new Set(['docs/a.md', 'docs/features/remote/ssh-projects.md'])

  it('resolves a bundled article, with and without a hash', () => {
    expect(resolveDocLink('docs/b.md', './a.md', known)).toEqual({
      kind: 'article',
      path: 'docs/a.md',
      hash: null
    })
    expect(resolveDocLink('docs/b.md', './a.md#credential-storage', known)).toEqual({
      kind: 'article',
      path: 'docs/a.md',
      hash: 'credential-storage'
    })
  })

  it('reports an in-repo target that is not bundled as missing, never as external', () => {
    // The honest state the contract demands: a route forward, not a click that does nothing and
    // not a browser window opened onto a file:// path.
    expect(resolveDocLink('docs/features/README.md', '../../README.md', known)).toEqual({
      kind: 'missing',
      path: 'README.md'
    })
  })

  it('classifies schemes and protocol-relative URLs as external', () => {
    expect(resolveDocLink('docs/a.md', 'https://example.com/x', known)).toEqual({
      kind: 'external',
      href: 'https://example.com/x'
    })
    expect(resolveDocLink('docs/a.md', 'mailto:x@example.com', known).kind).toBe('external')
    expect(resolveDocLink('docs/a.md', '//example.com/x', known).kind).toBe('external')
  })

  it('classifies a bare hash as an anchor in the current article', () => {
    expect(resolveDocLink('docs/a.md', '#some-heading', known)).toEqual({
      kind: 'anchor',
      hash: 'some-heading'
    })
  })

  it('decodes a percent-encoded path, and survives a malformed escape', () => {
    const withSpace = new Set(['docs/a b.md'])
    expect(resolveDocLink('docs/x.md', './a%20b.md', withSpace)).toEqual({
      kind: 'article',
      path: 'docs/a b.md',
      hash: null
    })
    // A lone `%` is not a valid escape; it must degrade to `missing`, never throw and take the
    // whole rendered article down with it.
    expect(resolveDocLink('docs/x.md', './100%.md', known).kind).toBe('missing')
  })
})

describe('splitSearchWindows', () => {
  it('leaves a short line alone', () => {
    expect(splitSearchWindows('abc', 300, 150)).toEqual(['abc'])
  })

  it('covers every position of a long line, with the promised overlap', () => {
    const line = 'x'.repeat(1000)
    const windows = splitSearchWindows(line, 300, 150)
    expect(windows.length).toBeGreaterThan(1)
    for (const w of windows) expect(w.length).toBeLessThanOrEqual(300)
    // Reassembling by the step must reproduce the line — i.e. nothing was skipped.
    const step = 300 - 150
    let rebuilt = ''
    windows.forEach((w, i) => {
      rebuilt = rebuilt.slice(0, i * step) + w
    })
    expect(rebuilt).toBe(line)
  })

  it('finds a needle sitting past the clamp, which a single clamped test would miss', () => {
    // This is the whole reason the splitter exists: `useRegexSearchField().test` clamps its
    // candidate at 300 characters because every other filter surface feeds it a label.
    const line = `${'a'.repeat(500)}NEEDLE${'b'.repeat(500)}`
    const clamped = (s: string): boolean => s.slice(0, 300).includes('NEEDLE')
    expect(clamped(line)).toBe(false)
    expect(splitSearchWindows(line, 300, 150).some(clamped)).toBe(true)
  })
})

describe('searchArticles', () => {
  const articles = [
    article('docs/tmux.md', '# tmux sessions\n\nSessions survive a restart.\nThey do not survive a reboot.\n'),
    article('docs/other.md', '# Something else\n\nNothing relevant here.\n')
  ]
  const contains =
    (q: string) =>
    (s: string): boolean =>
      s.toLowerCase().includes(q.toLowerCase())

  it('matches titles and bodies, and says which', () => {
    const hits = searchArticles(articles, contains('survive'))
    expect(hits.map((h) => h.path)).toEqual(['docs/tmux.md'])
    expect(hits[0].titleMatch).toBe(false)
    expect(hits[0].matchCount).toBe(2)
    expect(hits[0].snippets.map((s) => s.text)).toEqual([
      'Sessions survive a restart.',
      'They do not survive a reboot.'
    ])
  })

  it('ranks a title match above a body-only match', () => {
    const hits = searchArticles(
      [article('docs/body.md', '# Zzz\n\ntmux is mentioned here.\n'), article('docs/title.md', '# tmux\n\nnothing\n')],
      contains('tmux')
    )
    expect(hits.map((h) => h.path)).toEqual(['docs/title.md', 'docs/body.md'])
  })

  it('caps snippets and reports the count as truncated rather than as a total', () => {
    const many = article('docs/many.md', `# Many\n\n${'hit\n'.repeat(20)}`)
    const hits = searchArticles([many], contains('hit'), { snippetCap: 3 })
    expect(hits[0].snippets).toHaveLength(3)
    expect(hits[0].truncated).toBe(true)
    expect(hits[0].matchCount).toBe(4)
  })

  it('still scans the body of an article whose title matched', () => {
    const hits = searchArticles(articles, contains('tmux'))
    expect(hits[0].titleMatch).toBe(true)
    // The prefilter must not be consulted for a title match — a reader searching "tmux" wants the
    // lines too, not just the fact that an article is called that.
    expect(searchArticles(articles, contains('tmux'), { prefilter: () => false })[0].titleMatch).toBe(true)
  })

  it('honours the prefilter for body-only candidates', () => {
    const seen: string[] = []
    const hits = searchArticles(articles, contains('survive'), {
      prefilter: (a) => {
        seen.push(a.path)
        return a.path === 'docs/other.md'
      }
    })
    expect(seen).toEqual(['docs/tmux.md', 'docs/other.md'])
    // tmux.md was rejected by the prefilter, so its lines were never scanned.
    expect(hits).toHaveLength(0)
  })
})
