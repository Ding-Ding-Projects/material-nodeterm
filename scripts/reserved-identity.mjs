/**
 * The one definition of "this address can never receive mail".
 *
 * RFC 2606 and RFC 6761 reserve these names so they can never resolve, which is exactly what
 * makes them safe to refuse without guessing whether a human is legitimate: a real contributor's
 * address cannot land in this set. Two callers need the same answer and must not drift apart —
 * `check-commit-identity.mjs` refuses a push carrying one, and `count-lines.mjs` declines to
 * attribute its surviving lines to a person. A second copy of this list is how one of them
 * quietly stops agreeing with the other.
 */
export const RESERVED_SUFFIXES = [
  '.invalid',
  '.test',
  '.example',
  '.localhost',
  '@example.com',
  '@example.net',
  '@example.org'
]

/** True when `address` sits on a reserved, un-routable domain. Blank/absent is NOT reserved:
 *  an address we failed to read is unknown, and unknown is not evidence of a placeholder. */
export function reservedAddress(address) {
  const value = String(address ?? '')
    .trim()
    .toLowerCase()
  if (!value) return false
  return RESERVED_SUFFIXES.some((suffix) => value.endsWith(suffix))
}
