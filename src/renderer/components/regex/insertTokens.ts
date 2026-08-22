/** One insertable/wrappable regex building block, shown as a button in the guided-construction
 *  token palette. `insert` is spliced in at the cursor; when `wraps` is set and text is selected,
 *  the selection is wrapped with `insert`'s two halves instead (see `applyToken` in
 *  RegexBuilder.tsx) — select `foo`, click `(…)`, get `(foo)` with the cursor left after it. */
export interface RegexToken {
  label: string
  insert: string
  hint: string
  /** [before, after] to wrap a selection instead of inserting `insert` verbatim. */
  wraps?: [string, string]
}

export interface RegexTokenGroup {
  title: string
  tokens: RegexToken[]
}

export const REGEX_TOKEN_GROUPS: RegexTokenGroup[] = [
  {
    title: 'Character classes',
    tokens: [
      { label: '\\d', insert: '\\d', hint: 'Any digit (0–9).' },
      { label: '\\D', insert: '\\D', hint: 'Any non-digit.' },
      { label: '\\w', insert: '\\w', hint: 'A word character (letter, digit, underscore).' },
      { label: '\\W', insert: '\\W', hint: 'Not a word character.' },
      { label: '\\s', insert: '\\s', hint: 'Whitespace (space, tab, newline…).' },
      { label: '\\S', insert: '\\S', hint: 'Not whitespace.' },
      { label: '.', insert: '.', hint: 'Any character except a line break (unless the s flag is on).' },
      { label: '[abc]', insert: '[abc]', hint: 'Any one of a, b, or c.' },
      { label: '[^abc]', insert: '[^abc]', hint: 'Any character EXCEPT a, b, or c.' },
      { label: '[a-z]', insert: '[a-z]', hint: 'Any character in the range a to z.' },
      { label: '\\p{L}', insert: '\\p{L}', hint: 'Any Unicode letter — needs the u flag.' }
    ]
  },
  {
    title: 'Anchors & boundaries',
    tokens: [
      { label: '^', insert: '^', hint: 'Start of the string (or line, with the m flag).' },
      { label: '$', insert: '$', hint: 'End of the string (or line, with the m flag).' },
      { label: '\\b', insert: '\\b', hint: 'A word boundary.' },
      { label: '\\B', insert: '\\B', hint: 'NOT a word boundary.' }
    ]
  },
  {
    title: 'Quantifiers',
    tokens: [
      { label: '+', insert: '+', hint: 'One or more of the preceding token.' },
      { label: '*', insert: '*', hint: 'Zero or more of the preceding token.' },
      { label: '?', insert: '?', hint: 'Zero or one of the preceding token (optional).' },
      { label: '{3}', insert: '{3}', hint: 'Exactly 3 of the preceding token.' },
      { label: '{2,5}', insert: '{2,5}', hint: 'Between 2 and 5 of the preceding token.' },
      { label: '{2,}', insert: '{2,}', hint: '2 or more of the preceding token.' },
      { label: '+?', insert: '+?', hint: 'One or more, LAZY — matches as little as possible.' },
      { label: '*?', insert: '*?', hint: 'Zero or more, LAZY — matches as little as possible.' }
    ]
  },
  {
    title: 'Groups & references',
    tokens: [
      { label: '(…)', insert: '()', wraps: ['(', ')'], hint: 'Capturing group — remembers what it matched.' },
      { label: '(?:…)', insert: '(?:)', wraps: ['(?:', ')'], hint: 'Non-capturing group — groups without remembering.' },
      { label: '(?<name>…)', insert: '(?<name>)', wraps: ['(?<name>', ')'], hint: 'Named capturing group.' },
      { label: '\\1', insert: '\\1', hint: 'Backreference to capturing group 1.' },
      { label: '\\k<name>', insert: '\\k<name>', hint: 'Backreference to a named group, by name.' },
      { label: 'a|b', insert: '|', hint: 'Alternation — matches whatever is on either side ("a or b").' }
    ]
  },
  {
    title: 'Lookaround',
    tokens: [
      { label: '(?=…)', insert: '(?=)', wraps: ['(?=', ')'], hint: 'Lookahead — matches only if followed by this, without consuming it.' },
      { label: '(?!…)', insert: '(?!)', wraps: ['(?!', ')'], hint: 'Negative lookahead — matches only if NOT followed by this.' },
      { label: '(?<=…)', insert: '(?<=)', wraps: ['(?<=', ')'], hint: 'Lookbehind — matches only if preceded by this, without consuming it.' },
      { label: '(?<!…)', insert: '(?<!)', wraps: ['(?<!', ')'], hint: 'Negative lookbehind — matches only if NOT preceded by this.' }
    ]
  },
  {
    title: 'Escapes',
    tokens: [
      { label: '\\.', insert: '\\.', hint: 'A literal dot (escaped — . alone means "any character").' },
      { label: '\\/', insert: '\\/', hint: 'A literal forward slash.' },
      { label: '\\\\', insert: '\\\\', hint: 'A literal backslash.' },
      { label: '\\n', insert: '\\n', hint: 'A newline.' },
      { label: '\\t', insert: '\\t', hint: 'A tab.' },
      { label: '\\uFFFF', insert: '\\uFFFF', hint: 'A Unicode code point, by its hex value.' }
    ]
  }
]

/** Filters every group's tokens against a plain (non-regex) query — matching on either the
 *  token's own glyph or its hint — and drops a group entirely once it has no surviving tokens, so
 *  a section header never sits over an empty list. This is a deliberately plain substring filter,
 *  not another `useRegexSearchField` instance: it filters the regex BUILDER's own token palette,
 *  and giving that filter its own nested anchored-regex-builder chip would be a builder opening a
 *  builder to filter its own contents — the app's other search fields keep their `.*` chip, this
 *  one is intentionally exempt as the tool's own internal furniture. */
export function filterTokenGroups(groups: RegexTokenGroup[], query: string): RegexTokenGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) return groups
  return groups
    .map((g) => ({ ...g, tokens: g.tokens.filter((t) => t.label.toLowerCase().includes(q) || t.hint.toLowerCase().includes(q)) }))
    .filter((g) => g.tokens.length > 0)
}
