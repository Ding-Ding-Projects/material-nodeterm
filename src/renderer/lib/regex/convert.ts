/**
 * Convert and Use (design/v3 `Regex.dc.html`): turns a pattern written for this app's engine
 * (JavaScript RegExp, see engine.ts) into a ready-to-paste snippet for another language, and says
 * plainly where that language cannot express it.
 *
 * Honesty rules, the same ones the rest of the builder keeps:
 * - A construct the target cannot express makes the conversion `ok: false` with the reason. It
 *   is never silently dropped or swapped for a "close enough" construct.
 * - A construct the target accepts with DIFFERENT meaning is converted and carries a warning.
 * - Only syntax is rewritten. Nothing here claims the converted pattern was run on the target
 *   engine; the tab says so.
 *
 * Pure: no evaluation, no network. A scanner walks the pattern once, tracking escapes and
 * character classes, so a `(?<` inside `[...]` or after a backslash is never mistaken for syntax.
 */

export type RegexTarget = 'javascript' | 'python' | 'go' | 'rust' | 'csharp' | 'java' | 'powershell'

export interface RegexTargetInfo {
  id: RegexTarget
  label: string
  /** The engine the snippet targets, named the way its own docs name it. */
  engine: string
}

export const REGEX_TARGETS: readonly RegexTargetInfo[] = [
  { id: 'javascript', label: 'JavaScript', engine: 'ECMAScript RegExp' },
  { id: 'python', label: 'Python', engine: 'Python re module' },
  { id: 'go', label: 'Go', engine: 'Go regexp (RE2 syntax)' },
  { id: 'rust', label: 'Rust', engine: 'Rust regex crate' },
  { id: 'csharp', label: 'C#', engine: '.NET System.Text.RegularExpressions' },
  { id: 'java', label: 'Java', engine: 'java.util.regex' },
  { id: 'powershell', label: 'PowerShell', engine: '.NET regex via [regex]' }
]

/** The constructs a conversion has to know about, found by one pass over the pattern. */
export interface PatternFeatures {
  lookahead: boolean
  lookbehind: boolean
  /** A lookbehind whose body contains a quantifier or alternation, so its width may vary. */
  variableLookbehind: boolean
  namedGroups: string[]
  namedBackrefs: boolean
  numberedBackrefs: boolean
  unicodeBraceEscape: boolean
  unicodeProperty: boolean
}

interface Token {
  kind:
    | 'text'
    | 'named-open'
    | 'named-backref'
    | 'numbered-backref'
    | 'lookahead'
    | 'lookbehind'
    | 'unicode-brace'
    | 'unicode-prop'
  raw: string
  name?: string
  hex?: string
}

/** One left-to-right pass. Outside a class: `(?<name>`, `(?=`, `(?!`, `(?<=`, `(?<!`, `\k<name>`,
 *  `\1`..`\9`, `\u{…}`, `\p{…}`/`\P{…}`. Inside a class only the escapes matter. */
export function tokenizePattern(pattern: string): Token[] {
  const out: Token[] = []
  let text = ''
  let inClass = false
  const flush = () => {
    if (text) out.push({ kind: 'text', raw: text })
    text = ''
  }
  for (let i = 0; i < pattern.length; ) {
    const c = pattern[i]
    if (c === '\\') {
      const n = pattern[i + 1] ?? ''
      const rest = pattern.slice(i)
      const ub = /^\\u\{([0-9a-fA-F]{1,6})\}/.exec(rest)
      if (ub) {
        flush()
        out.push({ kind: 'unicode-brace', raw: ub[0], hex: ub[1] })
        i += ub[0].length
        continue
      }
      const up = /^\\[pP]\{[^}]*\}/.exec(rest)
      if (up) {
        flush()
        out.push({ kind: 'unicode-prop', raw: up[0] })
        i += up[0].length
        continue
      }
      if (!inClass) {
        const nb = /^\\k<([A-Za-z_$][\w$]*)>/.exec(rest)
        if (nb) {
          flush()
          out.push({ kind: 'named-backref', raw: nb[0], name: nb[1] })
          i += nb[0].length
          continue
        }
        if (/[1-9]/.test(n)) {
          const num = /^\\[1-9]\d*/.exec(rest)!
          flush()
          out.push({ kind: 'numbered-backref', raw: num[0] })
          i += num[0].length
          continue
        }
      }
      text += c + n
      i += 2
      continue
    }
    if (inClass) {
      if (c === ']') inClass = false
      text += c
      i += 1
      continue
    }
    if (c === '[') {
      inClass = true
      text += c
      i += 1
      continue
    }
    if (c === '(' && pattern[i + 1] === '?') {
      const rest = pattern.slice(i)
      const named = /^\(\?<([A-Za-z_$][\w$]*)>/.exec(rest)
      if (named) {
        flush()
        out.push({ kind: 'named-open', raw: named[0], name: named[1] })
        i += named[0].length
        continue
      }
      if (rest.startsWith('(?<=') || rest.startsWith('(?<!')) {
        flush()
        out.push({ kind: 'lookbehind', raw: rest.slice(0, 4) })
        i += 4
        continue
      }
      if (rest.startsWith('(?=') || rest.startsWith('(?!')) {
        flush()
        out.push({ kind: 'lookahead', raw: rest.slice(0, 3) })
        i += 3
        continue
      }
    }
    text += c
    i += 1
  }
  flush()
  return out
}

/** Whether any lookbehind body (up to its matching close paren) holds a quantifier or `|`. */
function hasVariableLookbehind(pattern: string): boolean {
  const re = /\(\?<[=!]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(pattern)) !== null) {
    let depth = 1
    let i = m.index + m[0].length
    let inClass = false
    let body = ''
    for (; i < pattern.length && depth > 0; i++) {
      const c = pattern[i]
      if (c === '\\') {
        body += c + (pattern[i + 1] ?? '')
        i += 1
        continue
      }
      if (inClass) {
        if (c === ']') inClass = false
      } else if (c === '[') inClass = true
      else if (c === '(') depth++
      else if (c === ')') depth--
      if (depth > 0) body += c
    }
    // Strip escapes and classes, then look for anything that makes the width vary.
    const bare = body.replace(/\\./g, 'x').replace(/\[[^\]]*\]/g, 'x')
    if (/[*+?|]|\{\d+,\d*\}/.test(bare)) return true
  }
  return false
}

export function analysePattern(pattern: string): PatternFeatures {
  const tokens = tokenizePattern(pattern)
  return {
    lookahead: tokens.some((t) => t.kind === 'lookahead'),
    lookbehind: tokens.some((t) => t.kind === 'lookbehind'),
    variableLookbehind: hasVariableLookbehind(pattern),
    namedGroups: tokens.filter((t) => t.kind === 'named-open').map((t) => t.name!),
    namedBackrefs: tokens.some((t) => t.kind === 'named-backref'),
    numberedBackrefs: tokens.some((t) => t.kind === 'numbered-backref'),
    unicodeBraceEscape: tokens.some((t) => t.kind === 'unicode-brace'),
    unicodeProperty: tokens.some((t) => t.kind === 'unicode-prop')
  }
}

export interface ConversionResult {
  target: RegexTarget
  ok: boolean
  /** The rewritten pattern (present only when `ok`). */
  pattern?: string
  /** A paste-ready snippet (present only when `ok`). */
  code?: string
  /** Constructs the target cannot express. Non-empty exactly when `ok` is false. */
  unsupported: string[]
  /** Converted, but behaves differently on the target. */
  warnings: string[]
}

/** Rewrite token by token. `named` and `backref` decide the target's spelling. */
function rewrite(
  tokens: Token[],
  spell: { named: (n: string) => string; backref: (n: string) => string; brace: (hex: string) => string }
): string {
  return tokens
    .map((t) => {
      switch (t.kind) {
        case 'named-open':
          return spell.named(t.name!)
        case 'named-backref':
          return spell.backref(t.name!)
        case 'unicode-brace':
          return spell.brace(t.hex!)
        default:
          return t.raw
      }
    })
    .join('')
}

const quote = {
  /** Python raw string; falls back to an escaped ordinary string when a raw one cannot hold it
   *  (a trailing backslash, or both quote kinds). */
  python(p: string): string {
    if (!p.endsWith('\\') && !p.includes("'")) return `r'${p}'`
    if (!p.endsWith('\\') && !p.includes('"')) return `r"${p}"`
    return `'${p.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  },
  go(p: string): string {
    return p.includes('`') ? JSON.stringify(p) : `\`${p}\``
  },
  rust(p: string): string {
    let hashes = '#'
    while (p.includes(`"${hashes}`)) hashes += '#'
    return `r${hashes}"${p}"${hashes}`
  },
  csharp(p: string): string {
    return `@"${p.replace(/"/g, '""')}"`
  },
  java(p: string): string {
    return `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  },
  powershell(p: string): string {
    return `'${p.replace(/'/g, "''")}'`
  }
}

/** Escape every `/` that is not already escaped, so the pattern fits a `/…/` literal. */
export function escapeSlashes(pattern: string): string {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\') {
      out += c + (pattern[i + 1] ?? '')
      i += 1
    } else out += c === '/' ? '\\/' : c
  }
  return out
}

/** Convert `pattern`/`flags` (JavaScript syntax) for `target`. */
export function convertRegex(pattern: string, flags: string, target: RegexTarget): ConversionResult {
  const f = analysePattern(pattern)
  const tokens = tokenizePattern(pattern)
  const unsupported: string[] = []
  const warnings: string[] = []
  const has = (flag: string) => flags.includes(flag)
  const fail = (): ConversionResult => ({ target, ok: false, unsupported, warnings })

  if (target === 'javascript') {
    const literal = `/${escapeSlashes(pattern)}/${flags}`
    return {
      target,
      ok: true,
      pattern,
      code: `const re = ${literal};\nconst matches = [...text.matchAll(${has('g') ? 're' : `new RegExp(re.source, re.flags + 'g')`})];`,
      unsupported,
      warnings
    }
  }

  // Sticky has no flag on any other target: it is a matching mode, not syntax.
  if (has('y')) warnings.push('Sticky (y) has no flag here; anchor the match position in code instead.')

  if (target === 'go' || target === 'rust') {
    const name = target === 'go' ? 'Go (RE2)' : 'The Rust regex crate'
    if (f.lookahead) unsupported.push(`${name} has no lookahead (?= or (?!.`)
    if (f.lookbehind) unsupported.push(`${name} has no lookbehind (?<= or (?<!.`)
    if (f.namedBackrefs || f.numberedBackrefs) unsupported.push(`${name} has no backreferences.`)
    if (unsupported.length) return fail()
    const inline = ['i', 'm', 's'].filter(has).join('')
    const body = rewrite(tokens, {
      named: (n) => `(?P<${n}>`,
      backref: (n) => `\\k<${n}>`,
      brace: (hex) => `\\x{${hex}}`
    })
    const rewritten = (inline ? `(?${inline})` : '') + body
    if (f.unicodeProperty) warnings.push('Unicode property names must match this engine\'s list (for example \\p{Greek}).')
    const code =
      target === 'go'
        ? `re := regexp.MustCompile(${quote.go(rewritten)})\nmatches := re.FindAllStringSubmatch(text, -1)`
        : `let re = regex::Regex::new(${quote.rust(rewritten)}).unwrap();\nfor caps in re.captures_iter(text) { /* … */ }`
    return { target, ok: true, pattern: rewritten, code, unsupported, warnings }
  }

  if (target === 'python') {
    if (f.unicodeProperty) unsupported.push('The re module has no \\p{…} classes (the third-party regex module does).')
    if (f.variableLookbehind) unsupported.push('The re module only allows fixed-width lookbehind.')
    if (unsupported.length) return fail()
    const rewritten = rewrite(tokens, {
      named: (n) => `(?P<${n}>`,
      backref: (n) => `(?P=${n})`,
      brace: (hex) => (parseInt(hex, 16) <= 0xffff ? `\\u${hex.padStart(4, '0')}` : `\\U${hex.padStart(8, '0')}`)
    })
    const pyFlags = [has('i') && 're.IGNORECASE', has('m') && 're.MULTILINE', has('s') && 're.DOTALL'].filter(Boolean)
    if (!has('u')) warnings.push('Python 3 patterns are always Unicode-aware; \\w and \\d also match non-ASCII letters and digits.')
    const flagArg = pyFlags.length ? `, ${pyFlags.join(' | ')}` : ''
    return {
      target,
      ok: true,
      pattern: rewritten,
      code: `import re\npattern = re.compile(${quote.python(rewritten)}${flagArg})\nmatches = list(pattern.finditer(text))`,
      unsupported,
      warnings
    }
  }

  // .NET and Java share JavaScript's (?<name>…) and \k<name> spelling.
  if (target === 'java') {
    if (f.variableLookbehind) warnings.push('Java needs a bounded lookbehind; * and + inside one are rejected.')
    const rewritten = rewrite(tokens, { named: (n) => `(?<${n}>`, backref: (n) => `\\k<${n}>`, brace: (hex) => `\\x{${hex}}` })
    const jf = [has('i') && 'Pattern.CASE_INSENSITIVE', has('m') && 'Pattern.MULTILINE', has('s') && 'Pattern.DOTALL', has('u') && 'Pattern.UNICODE_CASE'].filter(Boolean)
    return {
      target,
      ok: true,
      pattern: rewritten,
      code: `Pattern p = Pattern.compile(${quote.java(rewritten)}${jf.length ? `, ${jf.join(' | ')}` : ''});\nMatcher m = p.matcher(text);\nwhile (m.find()) { /* … */ }`,
      unsupported,
      warnings
    }
  }

  // csharp and powershell: .NET.
  if (f.unicodeBraceEscape) {
    const big = tokens.some((t) => t.kind === 'unicode-brace' && parseInt(t.hex!, 16) > 0xffff)
    if (big) unsupported.push('.NET regex has no escape for code points above U+FFFF.')
  }
  if (unsupported.length) return fail()
  warnings.push('.NET \\d and \\w match Unicode digits and letters by default, unlike JavaScript.')
  const rewritten = rewrite(tokens, {
    named: (n) => `(?<${n}>`,
    backref: (n) => `\\k<${n}>`,
    brace: (hex) => `\\u${hex.padStart(4, '0')}`
  })
  const opts = [has('i') && 'IgnoreCase', has('m') && 'Multiline', has('s') && 'Singleline'].filter(Boolean) as string[]
  if (target === 'csharp') {
    const optArg = opts.length ? `, ${opts.map((o) => `RegexOptions.${o}`).join(' | ')}` : ''
    return {
      target,
      ok: true,
      pattern: rewritten,
      code: `var re = new Regex(${quote.csharp(rewritten)}${optArg});\nforeach (Match m in re.Matches(text)) { /* … */ }`,
      unsupported,
      warnings
    }
  }
  warnings.push('PowerShell -match is case-insensitive by default; this snippet uses [regex] so the flags above decide.')
  const optArg = opts.length ? `, '${opts.join(', ')}'` : ''
  return {
    target,
    ok: true,
    pattern: rewritten,
    code: `$matches = [regex]::Matches($text, ${quote.powershell(rewritten)}${optArg})`,
    unsupported,
    warnings
  }
}

/** GREP over the sample: the lines that contain at least one match, 1-based, in order. Uses the
 *  match offsets the Worker already produced, so nothing is evaluated again on this thread. */
export function grepLines(sample: string, matchStarts: readonly number[]): { line: number; text: string; hits: number }[] {
  if (matchStarts.length === 0) return []
  const lineStarts = [0]
  for (let i = 0; i < sample.length; i++) if (sample[i] === '\n') lineStarts.push(i + 1)
  const hits = new Map<number, number>()
  for (const s of matchStarts) {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= s) lo = mid
      else hi = mid - 1
    }
    hits.set(lo, (hits.get(lo) ?? 0) + 1)
  }
  return [...hits.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([idx, n]) => {
      const start = lineStarts[idx]
      const end = idx + 1 < lineStarts.length ? lineStarts[idx + 1] - 1 : sample.length
      return { line: idx + 1, text: sample.slice(start, end), hits: n }
    })
}
