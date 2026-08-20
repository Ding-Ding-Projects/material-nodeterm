import type { BrowserProfile } from './types'

/**
 * Browser profiles per project (see `BrowserProfile` in `shared/types.ts`): a project can hold
 * several named browser profiles, and every browser node assigned to a given profile SHARES that
 * profile's cookies/localStorage/session state — two nodes on the same profile are the same
 * logged-in identity; two nodes on different profiles are isolated from each other.
 *
 * The mechanism is Electron's `partition` session attribute on `<webview>`: a named persistent
 * partition (`persist:...`) IS a profile in Electron's own terms — same partition means shared
 * cookies, different partitions mean isolated ones. This module is the one place that decides the
 * partition string, so a browser surface never derives it inline and two call sites can never
 * disagree about what profile "browser-1" on project "proj-a" actually maps to.
 *
 * Electron-free and pure: importable from `src/core`/`src/main`/`src/renderer` alike, and unit
 * tested without spinning up Electron.
 */

/** Prefix every derived partition carries, so a partition string can always be recognized as
 *  ours (never collides with a partition another part of the app might create for another
 *  purpose) and grepped for during support/debugging. */
const PARTITION_PREFIX = 'persist:browser-profile-'

/**
 * The Electron `partition` a browser node's `<webview>` should use.
 *
 * `undefined` (no `partition` attribute at all) means the DEFAULT, unpartitioned Electron
 * session — this is deliberately what every existing browser node keeps using: a node with no
 * `browserProfileId` (every node saved before this feature existed, and every new node until the
 * user explicitly picks a profile) is bit-for-bit the pre-feature behavior, cookies included.
 *
 * A profile id — even a DANGLING one, referencing a profile the user has since removed from
 * `Project.browserProfiles` — still derives a stable partition. The profile LIST is just naming;
 * removing a profile's name from the list must not silently merge that node's session back into
 * the shared default one (a user who deletes a profile by mistake should not discover their
 * "isolated" banking tab now shares cookies with everything else). Profile REMOVAL is handled as
 * its own explicit, destructively-confirmed action (see `renderer/components/BrowserProfilePicker`)
 * that the user drives on purpose; the partition deriver itself never treats "profile not found in
 * the list" as "fall back to default".
 *
 * Partitioned per PROJECT as well as per profile: profile ids are only unique within one
 * project's `browserProfiles` list, so two different projects both minting a profile called
 * "work" (or reusing a short random id) must never collide into the same Electron partition.
 */
export function browserPartitionFor(projectId: string, profileId: string | undefined): string | undefined {
  if (!profileId) return undefined
  // Partition strings end up in an Electron session key and (indirectly) a filesystem path under
  // the app's userData dir, so keep them to a conservative safe charset rather than trusting
  // caller-supplied ids/names verbatim.
  return `${PARTITION_PREFIX}${sanitize(projectId)}-${sanitize(profileId)}`
}

/** Restricts a partition-string component to the id charset our own id generator already
 *  produces (`[a-z0-9-]`), so a hand-edited project.json can't smuggle path separators or other
 *  partition-breaking characters into the derived string. Never empty: an all-invalid input still
 *  produces a partition (never silently degrades to the default, unpartitioned session — see the
 *  dangling-reference note above). */
function sanitize(s: string): string {
  const cleaned = s.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  return cleaned || 'x'
}

/** True when `profileId` still names a live entry in `profiles` — used only to decide what a
 *  picker DISPLAYS (a dangling reference shows as "Unknown profile" rather than a name), never to
 *  decide the partition (see `browserPartitionFor`'s doc comment). */
export function findBrowserProfile(
  profiles: BrowserProfile[] | undefined,
  profileId: string | undefined
): BrowserProfile | undefined {
  if (!profileId) return undefined
  return profiles?.find((p) => p.id === profileId)
}
