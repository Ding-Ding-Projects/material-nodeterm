// What this running artifact is, and when it was built.
//
// The rule this exists for: a user-facing surface shows its running version AND that exact
// version's build time, on the front screen, before anybody navigates anywhere. Not because a
// timestamp is interesting, but because "which build am I actually looking at" is the first
// question in every bug report and the app is the only thing that can answer it truthfully.
//
// The values are stamped into the bundle at BUILD time (see `electron.vite.config.ts`), so they
// describe the artifact rather than the moment it was launched. That distinction is the whole
// point: launch time, a file's mtime, or a hand-written constant would all render something that
// looks like provenance and is not, and the first two would silently change every run.
//
// When the stamp is absent or malformed - a dev server, a build that predates this, a hand-edited
// bundle - the answer is an honest `unavailable`. Never a guess, and never today's date.

/** What the build stamps in. Deliberately small: anything derived belongs in the formatter. */
export interface BuildStamp {
  /** ISO 8601, UTC, from the machine that produced the artifact. */
  builtAt: string
  /** The exact commit the artifact was built from, or `unknown` outside a git checkout. */
  commit: string
  /**
   * The app's own version, from package.json at build time.
   *
   * Stamped rather than read from `app.getVersion()` at runtime, because Electron's `getVersion`
   * returns ELECTRON's version in an unpackaged run: the front screen showed "v42.8.1" before this
   * was measured. The runtime value is right only in a packaged build; the stamp is right in both.
   */
  version?: string
}

export type BuildProvenance =
  | { available: true; version: string; builtAt: Date; commit: string }
  | { available: false; version: string; reason: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Read a stamp that came from the bundle. Returns `available: false` with a reason rather than
 * throwing, because a missing stamp is a normal state (a dev run) and not an error to handle.
 *
 * A malformed date is refused as firmly as a missing one. `new Date('nonsense')` is an Invalid
 * Date that renders as the literal text "Invalid Date" in most formatters, which is a worse
 * outcome than saying plainly that the build time is unknown.
 */
export function readBuildProvenance(runtimeVersion: string, stamp: unknown): BuildProvenance {
  if (!isRecord(stamp)) {
    return { available: false, version: runtimeVersion, reason: 'this build carries no build stamp' }
  }
  const { builtAt, commit } = stamp
  // The STAMPED version wins: see `BuildStamp.version` for why the runtime one cannot be trusted
  // outside a packaged build.
  const version = typeof stamp.version === 'string' && stamp.version.length > 0 ? stamp.version : runtimeVersion
  if (typeof builtAt !== 'string' || builtAt.length === 0) {
    return { available: false, version, reason: 'this build carries no build time' }
  }
  const when = new Date(builtAt)
  if (Number.isNaN(when.getTime())) {
    return { available: false, version, reason: 'this build’s recorded build time is not a valid date' }
  }
  return {
    available: true,
    version,
    builtAt: when,
    commit: typeof commit === 'string' && commit.length > 0 ? commit : 'unknown'
  }
}

/**
 * The build time as a person reads it: local time, to the SECOND, with the timezone named.
 *
 * Seconds because two builds a minute apart are routine while somebody is bisecting, and the
 * timezone because a bare local time is ambiguous the moment the report crosses a border - which
 * is exactly when this line gets copied into an issue.
 *
 * `locale`/`timeZone` are injectable so a test can assert a fixed rendering rather than whatever
 * the machine running it happens to be set to.
 */
export function formatBuildTime(
  when: Date,
  opts: { locale?: string; timeZone?: string } = {}
): string {
  const formatter = new Intl.DateTimeFormat(opts.locale ?? undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {})
  })
  return formatter.format(when)
}

/** The one line a front screen shows. Short, because it sits under a product name, not in a table. */
export function buildProvenanceLine(
  provenance: BuildProvenance,
  opts: { locale?: string; timeZone?: string } = {}
): string {
  if (!provenance.available) {
    // Names the version it DOES know. A line that said only "unavailable" would throw away the
    // half of the answer that is available and certain.
    return `v${provenance.version} · build time ${provenance.reason}`
  }
  return `v${provenance.version} · built ${formatBuildTime(provenance.builtAt, opts)}`
}
