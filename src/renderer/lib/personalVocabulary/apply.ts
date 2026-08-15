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
