import type { PersonalVocabularyEntries } from './schema'

/**
 * Apply approved replacements at the user-facing TEXT boundary only — a literal substring
 * substitution, never a regex over `text` (the term comes from an untrusted uploaded file; a
 * user-controlled RegExp pattern is a classic catastrophic-backtracking / injection vector, and
 * `split(term).join(replacement)` sidesteps it completely while still being exact-match).
 *
 * Longest term first, so a short entry that happens to be a substring of a longer one (e.g. "PR"
 * inside "PR review") never pre-empts the more specific match.
 */
export function applyVocabulary(text: string, entries: PersonalVocabularyEntries): string {
  if (!text) return text
  const terms = Object.keys(entries)
  if (terms.length === 0) return text
  const ordered = [...terms].sort((a, b) => b.length - a.length)
  let result = text
  for (const term of ordered) {
    if (!term) continue
    if (!result.includes(term)) continue
    result = result.split(term).join(entries[term])
  }
  return result
}

/**
 * Map only the prose portions of a template, then insert dynamic facts unchanged. Parsing the
 * placeholders instead of mapping a formatted string is important: a user's term may be a path,
 * id, count, provider name, or even a placeholder key, but those values are not this feature's
 * prose and must never be rewritten.
 */
export function applyVocabularyToTemplate(
  text: string,
  entries: PersonalVocabularyEntries,
  params?: Record<string, string>
): string {
  if (!params) return applyVocabulary(text, entries)
  const placeholder = /\{(\w+)\}/g
  let output = ''
  let cursor = 0
  for (const match of text.matchAll(placeholder)) {
    const index = match.index ?? cursor
    output += applyVocabulary(text.slice(cursor, index), entries)
    const key = match[1]
    output += Object.prototype.hasOwnProperty.call(params, key) ? params[key] : match[0]
    cursor = index + match[0].length
  }
  return output + applyVocabulary(text.slice(cursor), entries)
}
