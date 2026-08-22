/**
 * Token-by-token, indentation-aware explanation of a pattern — "what a human would say reading
 * this left to right". This walks the pattern as a plain STRING; it never constructs or runs a
 * `RegExp`, so a malformed or adversarial-looking pattern is exactly as safe to explain as a
 * valid one — none of the catastrophic-backtracking concerns `looksCatastrophic`/the Worker guard
 * exist here, because nothing here executes against sample text.
 */
export interface RegexExplainToken {
  tok: string
  desc: string
  /** Group nesting depth at the point this token appears — the UI indents by this. */
  depth: number
}

const ESCAPE_DESCRIPTIONS: Record<string, string> = {
  '\\d': 'Any digit 0–9',
  '\\D': 'Any non-digit',
  '\\w': 'Word character [A-Za-z0-9_]',
  '\\W': 'Non-word character',
  '\\s': 'Whitespace',
  '\\S': 'Non-whitespace',
  '\\b': 'Word boundary',
  '\\B': 'Non-boundary',
  '\\n': 'Newline',
  '\\t': 'Tab',
  '\\.': 'Literal dot',
  '\\/': 'Literal slash'
}

/** A row cap on the explanation itself — this is about not rendering an unbounded list into the
 *  DOM for a very long pattern, not a safety measure (see the module doc above: this never runs
 *  the pattern, so there's no runaway-compute risk to guard against here). */
const MAX_EXPLAIN_ROWS = 80

const LITERAL_STOP_CHARS = '\\()[{}+*?^$.|'

export function explainPattern(pattern: string): RegexExplainToken[] {
  const rows: RegexExplainToken[] = []
  let i = 0
  let depth = 0
  const push = (tok: string, desc: string): void => {
    rows.push({ tok, desc, depth })
  }

  while (i < pattern.length && rows.length < MAX_EXPLAIN_ROWS) {
    const c = pattern[i]

    if (c === '\\') {
      const two = pattern.slice(i, i + 2)
      push(two, ESCAPE_DESCRIPTIONS[two] ?? `Escaped literal "${pattern[i + 1] ?? ''}"`)
      i += 2
      continue
    }

    if (c === '(') {
      let end = i + 1
      let tok = '('
      let desc = 'Capturing group'
      if (pattern.slice(i, i + 3) === '(?:') {
        tok = '(?:'
        desc = 'Non-capturing group'
        end = i + 3
      } else if (pattern.slice(i, i + 3) === '(?=') {
        tok = '(?='
        desc = 'Positive lookahead'
        end = i + 3
      } else if (pattern.slice(i, i + 3) === '(?!') {
        tok = '(?!'
        desc = 'Negative lookahead'
        end = i + 3
      } else if (pattern.slice(i, i + 4) === '(?<=') {
        tok = '(?<='
        desc = 'Positive lookbehind'
        end = i + 4
      } else if (pattern.slice(i, i + 4) === '(?<!') {
        tok = '(?<!'
        desc = 'Negative lookbehind'
        end = i + 4
      } else if (pattern.slice(i, i + 3) === '(?<') {
        const close = pattern.indexOf('>', i)
        const name = close > 0 ? pattern.slice(i + 3, close) : ''
        tok = `(?<${name}>`
        desc = `Named capturing group "${name}"`
        end = close > 0 ? close + 1 : i + 3
      }
      push(tok, desc)
      depth++
      i = end
      continue
    }

    if (c === ')') {
      depth = Math.max(0, depth - 1)
      push(')', 'End of group')
      i++
      continue
    }

    if (c === '[') {
      const close = pattern.indexOf(']', i + 1)
      const body = close > 0 ? pattern.slice(i, close + 1) : c
      push(body, body[1] === '^' ? 'Negated character class' : 'Character class — any listed character')
      i = close > 0 ? close + 1 : i + 1
      continue
    }

    if (c === '{') {
      const close = pattern.indexOf('}', i)
      const body = close > 0 ? pattern.slice(i, close + 1) : c
      push(body, close > 0 ? `Repeat exactly ${body.slice(1, -1)} times` : 'Literal "{"')
      i = close > 0 ? close + 1 : i + 1
      continue
    }

    if (c === '+') {
      const lazy = pattern[i + 1] === '?'
      push(lazy ? '+?' : '+', lazy ? 'One or more — lazy' : 'One or more — greedy')
      i += lazy ? 2 : 1
      continue
    }

    if (c === '*') {
      const lazy = pattern[i + 1] === '?'
      push(lazy ? '*?' : '*', lazy ? 'Zero or more — lazy' : 'Zero or more — greedy')
      i += lazy ? 2 : 1
      continue
    }

    if (c === '?') {
      push('?', 'Optional (zero or one)')
      i++
      continue
    }

    if (c === '^') {
      push('^', 'Start of line/string')
      i++
      continue
    }

    if (c === '$') {
      push('$', 'End of line/string')
      i++
      continue
    }

    if (c === '.') {
      push('.', 'Any character (except a newline, unless the s flag is on)')
      i++
      continue
    }

    if (c === '|') {
      push('|', 'Alternation — or')
      i++
      continue
    }

    // A run of plain literal characters. Guarantees at least one character of progress even for
    // a lone stray metacharacter (a `}` with no matching `{`, say) that none of the branches
    // above claimed — without that guarantee this would loop forever pushing empty rows.
    let j = i
    while (j < pattern.length && !LITERAL_STOP_CHARS.includes(pattern[j])) j++
    if (j === i) j++
    push(pattern.slice(i, j), `Literal "${pattern.slice(i, j)}"`)
    i = j
  }

  return rows
}
