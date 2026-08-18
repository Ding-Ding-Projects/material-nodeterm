/**
 * Resolving a Minecraft server jar, honestly.
 *
 * Two facts drive this module, and both were found by an adversarial review of a plan that had
 * neither:
 *
 * 1. **Acquiring the jar takes TWO fetches, not one.** The version manifest lists version *ids* and
 *    a per-version URL. The download link and its **sha1** live in that second document. A design
 *    that stops at the manifest has neither an artifact nor a checksum to verify it against, which
 *    is how a truncated download becomes a server that will not start for reasons nobody can read.
 * 2. **Each version pins a required Java major version**, in that same second document. Skipping
 *    the check runs a server against a Java it does not support, and the failure looks like a
 *    corrupt jar rather than a wrong runtime — so the user is sent to debug the wrong thing.
 *
 * WHAT IS ASSUMED HERE, AND WHY IT IS SAID OUT LOUD: the exact field names could not be verified
 * from the environment this was written in — both Mojang metadata hosts were unreachable. So this
 * module does NOT quietly assume a shape. It states the shape it expects in one place, validates
 * what it actually receives, and REFUSES with a message naming the missing field rather than
 * returning a half-built record. If a name is wrong, the failure is loud, immediate and points at
 * the exact key to fix — which is the behaviour worth having when a schema is uncertain.
 *
 * No network calls live here. `fetchJson` is injected, so the whole module is testable without one,
 * and the Electron-free rule means both the desktop and the Server Edition can use it.
 */

/** The manifest entry for one version. Only the fields this module actually needs. */
export interface VersionSummary {
  id: string
  /** `release`, `snapshot`, `old_beta`, `old_alpha` — carried through rather than interpreted, so
   *  an unfamiliar value from a future manifest is shown to the user instead of being dropped. */
  type: string
  /** Where the per-version document lives. The second fetch. */
  url: string
}

export interface ServerDownload {
  /** Version id this resolves, echoed back so a caller cannot mismatch request and result. */
  id: string
  url: string
  sha1: string
  /** Bytes, when the document states it. Optional because a missing size is a weaker signal than a
   *  missing checksum and must not block a download that can still be verified by hash. */
  sizeBytes?: number
  /**
   * The Java major version this Minecraft version requires. `null` when the document does not state
   * one — older versions predate the field, and treating "unstated" as "any" is correct there,
   * while treating it as a specific number would invent a requirement.
   */
  requiredJavaMajor: number | null
}

export class MinecraftMetadataError extends Error {
  constructor(
    message: string,
    /** The document field that was missing or malformed, so a schema drift names itself. */
    readonly field: string
  ) {
    super(message)
    this.name = 'MinecraftMetadataError'
  }
}

/** Injected so nothing here needs a network, and so a caller can supply its own timeouts. */
export type FetchJson = (url: string) => Promise<unknown>

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function requireString(source: Record<string, unknown>, key: string, where: string): string {
  const value = source[key]
  if (typeof value !== 'string' || value === '') {
    throw new MinecraftMetadataError(
      `${where} is missing a usable "${key}". The metadata shape may have changed; this is the exact field to check.`,
      key
    )
  }
  return value
}

/**
 * Reads the version list. Deliberately tolerant about ENTRIES and strict about the ENVELOPE: one
 * malformed entry in a list of six hundred should not deny the user every other version, but a
 * document with no versions array at all is not a manifest and must not be reported as an empty
 * one — "there are no versions" and "this is not the manifest" are different answers.
 */
export function parseVersionManifest(doc: unknown): VersionSummary[] {
  if (!isRecord(doc)) {
    throw new MinecraftMetadataError('The version manifest was not a JSON object.', 'root')
  }
  const versions = doc.versions
  if (!Array.isArray(versions)) {
    throw new MinecraftMetadataError('The version manifest has no "versions" array.', 'versions')
  }
  const out: VersionSummary[] = []
  for (const entry of versions) {
    if (!isRecord(entry)) continue
    const { id, type, url } = entry
    if (typeof id !== 'string' || typeof url !== 'string') continue
    out.push({ id, type: typeof type === 'string' ? type : 'unknown', url })
  }
  return out
}

/**
 * Reads the per-version document — the SECOND fetch, and the one that carries everything that
 * matters.
 *
 * A missing sha1 is fatal rather than a warning. The whole reason to make this second request is to
 * obtain something to verify the download against; proceeding without it would mean downloading an
 * artifact nobody can check, which is worse than not downloading it, because it looks like success.
 */
export function parseServerDownload(id: string, doc: unknown): ServerDownload {
  if (!isRecord(doc)) {
    throw new MinecraftMetadataError(`The document for ${id} was not a JSON object.`, 'root')
  }
  const downloads = doc.downloads
  if (!isRecord(downloads)) {
    throw new MinecraftMetadataError(`The document for ${id} has no "downloads".`, 'downloads')
  }
  const server = downloads.server
  if (!isRecord(server)) {
    // A real and important case rather than a schema failure: client-only versions exist, and very
    // old versions shipped no server jar at all. Saying so is far more useful than "malformed".
    throw new MinecraftMetadataError(
      `Minecraft ${id} publishes no server download. Client-only and very old versions have none.`,
      'downloads.server'
    )
  }

  const url = requireString(server, 'url', `The server download for ${id}`)
  const sha1 = requireString(server, 'sha1', `The server download for ${id}`)
  const size = server.size
  const javaVersion = doc.javaVersion

  return {
    id,
    url,
    sha1,
    sizeBytes: typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : undefined,
    requiredJavaMajor:
      isRecord(javaVersion) && typeof javaVersion.majorVersion === 'number'
        ? javaVersion.majorVersion
        : null
  }
}

/** Both fetches, in the order that makes the second one meaningful. */
export async function resolveServerDownload(
  versionId: string,
  fetchJson: FetchJson,
  manifestUrl: string
): Promise<ServerDownload> {
  const manifest = parseVersionManifest(await fetchJson(manifestUrl))
  const summary = manifest.find((v) => v.id === versionId)
  if (!summary) {
    throw new MinecraftMetadataError(
      `Minecraft ${versionId} is not in the version manifest.`,
      'versions'
    )
  }
  return parseServerDownload(versionId, await fetchJson(summary.url))
}

export interface JavaCompatibility {
  ok: boolean
  /** Present only when the answer is a real refusal, so a caller cannot render an empty complaint. */
  reason?: string
}

/**
 * Compares an installed Java against what a version requires.
 *
 * NEWER JAVA IS NOT AUTOMATICALLY FINE, and that is the whole reason this returns a reason string
 * rather than a boolean. A Minecraft version pins a major version because its bytecode and its
 * launcher expect it; running a much newer Java is a documented source of failures that read as
 * anything but a Java problem. But refusing outright would block combinations that work today, so
 * the honest position is: refuse when it is definitely too old, and let a newer one through while
 * saying which was expected.
 *
 * "Unstated" is not "any": a version with no pin genuinely has no requirement to check, which is
 * different from one whose requirement we failed to read — and that difference is why
 * `requiredJavaMajor` is `null` rather than `0`.
 */
export function checkJavaCompatibility(
  requiredJavaMajor: number | null,
  installedJavaMajor: number | null
): JavaCompatibility {
  if (requiredJavaMajor === null) return { ok: true }
  if (installedJavaMajor === null) {
    return {
      ok: false,
      reason: `This version needs Java ${requiredJavaMajor}, and no Java could be detected. Install it, or point the server at one.`
    }
  }
  if (installedJavaMajor < requiredJavaMajor) {
    return {
      ok: false,
      reason: `This version needs Java ${requiredJavaMajor}, but Java ${installedJavaMajor} is installed. It will fail to start in a way that looks like a corrupt download.`
    }
  }
  return { ok: true }
}

/**
 * Verifies a downloaded artifact against the sha1 the metadata promised.
 *
 * Case-insensitive because hex digests are written both ways and a case mismatch is not a
 * corruption. The comparison is length-checked first so a truncated or empty digest cannot pass by
 * accident, and the failure message deliberately does NOT include the expected value in a form
 * anybody would paste back in — a checksum mismatch means the artifact is wrong, not that the
 * expectation needs adjusting to match it.
 */
export function verifySha1(expected: string, actual: string): { ok: boolean; reason?: string } {
  const a = expected.trim().toLowerCase()
  const b = actual.trim().toLowerCase()
  if (a.length !== 40 || !/^[0-9a-f]{40}$/.test(a)) {
    return { ok: false, reason: 'The published checksum is not a sha1; refusing to accept the download on trust.' }
  }
  if (a !== b) {
    return { ok: false, reason: 'The downloaded jar does not match its published checksum. It is incomplete or has been tampered with.' }
  }
  return { ok: true }
}
