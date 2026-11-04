import { describe, expect, it } from 'vitest'
import { analysePattern, convertRegex, escapeSlashes, grepLines, tokenizePattern } from './convert'

describe('analysePattern', () => {
  it('finds constructs outside classes and escapes only', () => {
    const f = analysePattern('(?<year>\\d{4})-(?=x)\\k<year>[(?<no>]\\(?<no>')
    expect(f.namedGroups).toEqual(['year'])
    expect(f.lookahead).toBe(true)
    expect(f.namedBackrefs).toBe(true)
    expect(f.lookbehind).toBe(false)
  })

  it('tells fixed from variable lookbehind', () => {
    expect(analysePattern('(?<=ab)c').variableLookbehind).toBe(false)
    expect(analysePattern('(?<=a+)c').variableLookbehind).toBe(true)
    expect(analysePattern('(?<=a|bc)c').variableLookbehind).toBe(true)
    expect(analysePattern('(?<=[+*])c').variableLookbehind).toBe(false)
  })

  it('tokenizes a pattern back to itself', () => {
    const p = '(?<a>x)\\k<a>\\1\\u{1F600}\\p{L}(?<=y)(?!z)[\\]]'
    expect(tokenizePattern(p).map((t) => t.raw).join('')).toBe(p)
  })
})

describe('convertRegex', () => {
  it('Python rewrites named groups and backrefs and maps flags', () => {
    const r = convertRegex('(?<y>\\d+)-\\k<y>', 'im', 'python')
    expect(r.ok).toBe(true)
    expect(r.pattern).toBe('(?P<y>\\d+)-(?P=y)')
    expect(r.code).toContain("re.compile(r'(?P<y>\\d+)-(?P=y)', re.IGNORECASE | re.MULTILINE)")
  })

  it('Python refuses \\p{} and variable lookbehind instead of guessing', () => {
    const a = convertRegex('\\p{L}+', 'u', 'python')
    expect(a.ok).toBe(false)
    expect(a.unsupported[0]).toMatch(/\\p\{/)
    expect(a.code).toBeUndefined()
    expect(convertRegex('(?<=a+)b', '', 'python').ok).toBe(false)
  })

  it('Go and Rust refuse lookaround and backreferences, and inline the flags otherwise', () => {
    for (const t of ['go', 'rust'] as const) {
      expect(convertRegex('a(?=b)', '', t).ok).toBe(false)
      expect(convertRegex('(?<=a)b', '', t).ok).toBe(false)
      expect(convertRegex('(a)\\1', '', t).ok).toBe(false)
      const ok = convertRegex('(?<w>\\w+)', 'is', t)
      expect(ok.ok).toBe(true)
      expect(ok.pattern).toBe('(?is)(?P<w>\\w+)')
    }
    expect(convertRegex('a`b', '', 'go').code).toContain('"a`b"')
  })

  it('.NET keeps named syntax, warns about Unicode \\d, and refuses astral escapes', () => {
    const r = convertRegex('(?<n>\\d)\\u{41}', 'i', 'csharp')
    expect(r.ok).toBe(true)
    expect(r.pattern).toBe('(?<n>\\d)\\u0041')
    expect(r.code).toContain('RegexOptions.IgnoreCase')
    expect(r.warnings.join(' ')).toMatch(/Unicode/)
    expect(convertRegex('\\u{1F600}', 'u', 'csharp').ok).toBe(false)
    expect(convertRegex("it's", '', 'powershell').code).toContain("'it''s'")
  })

  it('JavaScript escapes slashes for a literal and sticky warns elsewhere', () => {
    expect(convertRegex('a/b\\/c', 'g', 'javascript').code).toContain('/a\\/b\\/c/g')
    expect(escapeSlashes('\\\\/')).toBe('\\\\\\/')
    expect(convertRegex('a', 'y', 'java').warnings[0]).toMatch(/Sticky/)
  })
})

describe('grepLines', () => {
  it('reports each matching line once with its hit count', () => {
    expect(grepLines('one\ntwo two\nthree', [0, 4, 8])).toEqual([
      { line: 1, text: 'one', hits: 1 },
      { line: 2, text: 'two two', hits: 2 }
    ])
    expect(grepLines('abc', [])).toEqual([])
  })
})
