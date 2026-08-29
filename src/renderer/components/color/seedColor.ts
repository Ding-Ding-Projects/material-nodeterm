/**
 * Which colour a picker opened over `colors` should OPEN on.
 *
 * The `colors` MenuItem documents `value` as optional precisely because a multi-target selection
 * can make "the current colour" a lie: seeding a five-node selection from whichever node happens
 * to be first tells the user their selection is that colour, and the picker then applies its very
 * first drag from a value four of the five nodes never had. Omitting the seed (undefined) is the
 * honest answer there — the picker starts from a neutral preset and the user is choosing, not
 * "adjusting".
 *
 * Agreement is compared case-insensitively on the trimmed text, because `#FF0000` and `#ff0000`
 * are one colour and reporting them as a disagreement would throw away a seed we really do have.
 * The FIRST original spelling is returned so the picker echoes what is stored rather than a
 * normalised rewrite of it.
 */
export function seedColor(colors: readonly (string | undefined | null)[]): string | undefined {
  const first = colors[0]
  if (first == null || first.trim() === '') return undefined
  const key = first.trim().toLowerCase()
  for (const c of colors) {
    if (c == null || c.trim().toLowerCase() !== key) return undefined
  }
  return first
}
