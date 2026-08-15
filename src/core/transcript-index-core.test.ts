import { describe, expect, it } from 'vitest'
import {
  extractEntryFields,
  makeSnippet,
  searchEntries,
  planRefresh,
  INDEX_TEXT_CAP_BYTES,
  type ScanFile,
  type TranscriptIndexEntry
} from './transcript-index-core'

const raw = [
  JSON.stringify({ type: 'user', cwd: '/Users/me/proj', message: { content: 'fix the tmux config please' } }),
  JSON.stringify({ type: 'assistant', cwd: '/Users/me/proj', message: { content: [{ type: 'text', text: 'editing tmux.conf now' }] } })
].join('\n')

describe('extractEntryFields', () => {
  it('pulls cwd, first-user-message title, and concatenated text', () => {
    const f = extractEntryFields(raw)
    expect(f.cwd).toBe('/Users/me/proj')
    expect(f.title).toBe('fix the tmux config please')
    expect(f.text).toContain('fix the tmux config')
    expect(f.text).toContain('editing tmux.conf now')
  })

  it('trims a long title to ~80 chars and caps text at INDEX_TEXT_CAP_BYTES', () => {
    const long = 'x'.repeat(500)
    const big = Array.from({ length: 5000 }, (_, i) =>
      JSON.stringify({ type: 'user', cwd: '/c', message: { content: long } })
    ).join('\n')
    const f = extractEntryFields(big)
    expect(f.title.length).toBeLessThanOrEqual(80)
    expect(f.text.length).toBeLessThanOrEqual(INDEX_TEXT_CAP_BYTES)
  })

  it('returns empty fields for unparseable input', () => {
    expect(extractEntryFields('garbage\n{bad json')).toEqual({ cwd: '', title: '', text: '' })
  })
})

describe('makeSnippet', () => {
  it('centers on the match and trims', () => {
    const s = makeSnippet('a'.repeat(300) + 'NEEDLE' + 'b'.repeat(300), 'needle')
    expect(s.toLowerCase()).toContain('needle')
    expect(s.length).toBeLessThanOrEqual(170)
  })
})

describe('searchEntries', () => {
  const entries: TranscriptIndexEntry[] = [
    { sessionId: 's1', transcriptPath: '/p/s1.jsonl', cwd: '/Users/me/alpha', mtime: 100, title: 'old tmux work', text: 'tmux mouse mode' },
    { sessionId: 's2', transcriptPath: '/p/s2.jsonl', cwd: '/Users/me/beta', mtime: 200, title: 'recent', text: 'something about TMUX clipboard' }
  ]

  it('matches title+text case-insensitively, newest first, capped', () => {
    const hits = searchEntries(entries, 'tmux', 20)
    expect(hits.map((h) => h.sessionId)).toEqual(['s2', 's1'])
    expect(hits[0].projectLabel).toBe('beta')
    expect(hits[0].snippet.toLowerCase()).toContain('tmux')
  })

  it('returns nothing for queries shorter than 2 chars', () => {
    expect(searchEntries(entries, 't')).toEqual([])
  })

  it('respects the limit', () => {
    expect(searchEntries(entries, 'tmux', 1)).toHaveLength(1)
  })
})

describe('planRefresh', () => {
  const prior: TranscriptIndexEntry[] = [
    { sessionId: 'a', transcriptPath: '/p/a.jsonl', cwd: '/c', mtime: 100, title: 't', text: 'x' },
    { sessionId: 'b', transcriptPath: '/p/b.jsonl', cwd: '/c', mtime: 100, title: 't', text: 'x' }
  ]

  it('re-reads new and changed files, keeps unchanged, drops vanished', () => {
    const scan: ScanFile[] = [
      { sessionId: 'a', transcriptPath: '/p/a.jsonl', mtime: 100 }, // unchanged -> keep
      { sessionId: 'b', transcriptPath: '/p/b.jsonl', mtime: 200 }, // changed -> read
      { sessionId: 'c', transcriptPath: '/p/c.jsonl', mtime: 50 }   // new -> read
    ]
    const plan = planRefresh(prior, scan)
    expect(plan.keep.map((e) => e.sessionId)).toEqual(['a'])
    expect(plan.toRead.map((f) => f.sessionId).sort()).toEqual(['b', 'c'])
  })

  it('drops entries whose file is gone (not in scan)', () => {
    const plan = planRefresh(prior, [{ sessionId: 'a', transcriptPath: '/p/a.jsonl', mtime: 100 }])
    expect(plan.keep.map((e) => e.sessionId)).toEqual(['a'])
    expect(plan.toRead).toEqual([])
  })
})

describe('projectLabel on a Windows cwd', () => {
  // Was `cwd.split('/').filter(Boolean).pop()`. A Windows cwd contains no '/' at all, so the
  // split returned the WHOLE path and the find bar labelled every result with an absolute path
  // instead of the project's name. The suite above never caught it because every fixture cwd is
  // POSIX — which is exactly the shape of the bug: the code is correct on the platform the
  // fixtures were written on.
  const WIN = String.raw`C:\Users\me\beta`

  it('labels with the folder name, not the whole path', () => {
    const entries: TranscriptIndexEntry[] = [
      { sessionId: 's1', transcriptPath: '/p/s1.jsonl', cwd: WIN, mtime: 1, title: 'x', text: 'tmux' }
    ]
    const hits = searchEntries(entries, 'tmux', 20)
    expect(hits[0].projectLabel).toBe('beta')
    // '\\', not String.raw — a raw template literal cannot END with a backslash, because the
    // backslash escapes the closing backtick even in raw mode. This is the one place the usual
    // String.raw advice does not apply.
    expect(hits[0].projectLabel).not.toContain('\\')
  })

  it('still labels a POSIX cwd correctly', () => {
    const entries: TranscriptIndexEntry[] = [
      { sessionId: 's1', transcriptPath: '/p/s1.jsonl', cwd: '/Users/me/alpha', mtime: 1, title: 'x', text: 'tmux' }
    ]
    expect(searchEntries(entries, 'tmux', 20)[0].projectLabel).toBe('alpha')
  })

  it('falls back to the cwd when there is no folder name to take', () => {
    const entries: TranscriptIndexEntry[] = [
      { sessionId: 's1', transcriptPath: '/p/s1.jsonl', cwd: '/', mtime: 1, title: 'x', text: 'tmux' }
    ]
    expect(searchEntries(entries, 'tmux', 20)[0].projectLabel).toBe('/')
  })
})
