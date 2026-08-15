/** One insertable/wrappable regex building block, shown as a button in the guided-construction
 *  palette. `insert` is spliced in at the cursor; when `wraps` is set and text is selected, the
 *  selection is wrapped with `insert`'s two halves instead (see applyToken in RegexBuilder.tsx). */
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
    title: 'Literals & escapes',
    tokens: [
      { label: '\\d', insert: '\\d', hint: 'A digit (0–9).' },
      { label: '\\D', insert: '\\D', hint: 'Not a digit.' },
      { label: '\\w', insert: '\\w', hint: 'A word character (letter, digit, underscore).' },
      { label: '\\W', insert: '\\W', hint: 'Not a word character.' },
      { label: '\\s', insert: '\\s', hint: 'Whitespace (space, tab, newline…).' },
      { label: '\\S', insert: '\\S', hint: 'Not whitespace.' },
      { label: '\\.', insert: '\\.', hint: 'A literal dot (escaped — `.` alone means "any character").' },
      { label: '\\n', insert: '\\n', hint: 'A newline.' },
      { label: '\\t', insert: '\\t', hint: 'A tab.' }
    ]
  },
  {
    title: 'Character classes',
    tokens: [
      { label: '.', insert: '.', hint: 'Any character except a line break (unless the s flag is on).' },
      { label: '[abc]', insert: '[abc]', hint: 'Any one of a, b, or c.' },
      { label: '[^abc]', insert: '[^abc]', hint: 'Any character EXCEPT a, b, or c.' },
      { label: '[a-z]', insert: '[a-z]', hint: 'Any character in the range a to z.' },
      { label: '[0-9]', insert: '[0-9]', hint: 'Any digit, written as a range.' }
    ]
  },
  {
    title: 'Anchors',
    tokens: [
      { label: '^', insert: '^', hint: 'Start of the string (or line, with the m flag).' },
      { label: '$', insert: '$', hint: 'End of the string (or line, with the m flag).' },
      { label: '\\b', insert: '\\b', hint: 'A word boundary.' },
      { label: '\\B', insert: '\\B', hint: 'NOT a word boundary.' }
    ]
  },
  {
    title: 'Groups',
    tokens: [
      { label: '(…)', insert: '()', wraps: ['(', ')'], hint: 'Capturing group — remembers what it matched.' },
      { label: '(?:…)', insert: '(?:)', wraps: ['(?:', ')'], hint: 'Non-capturing group — groups without remembering.' },
      { label: '(?<name>…)', insert: '(?<name>)', wraps: ['(?<name>', ')'], hint: 'Named capturing group.' },
      { label: '(?=…)', insert: '(?=)', wraps: ['(?=', ')'], hint: 'Lookahead — matches only if followed by this, without consuming it.' },
      { label: '(?!…)', insert: '(?!)', wraps: ['(?!', ')'], hint: 'Negative lookahead — matches only if NOT followed by this.' }
    ]
  },
  {
    title: 'Alternation',
    tokens: [{ label: 'a|b', insert: '|', hint: 'Matches whatever is on either side — "a or b".' }]
  },
  {
    title: 'Quantifiers',
    tokens: [
      { label: '*', insert: '*', hint: 'Zero or more of the preceding token.' },
      { label: '+', insert: '+', hint: 'One or more of the preceding token.' },
      { label: '?', insert: '?', hint: 'Zero or one of the preceding token (optional).' },
      { label: '{2,4}', insert: '{2,4}', hint: 'Between 2 and 4 of the preceding token.' },
      { label: '*?', insert: '*?', hint: 'Zero or more, LAZY — matches as little as possible.' }
    ]
  }
]
