// Local Minecraft server create-and-manage (docs/minecraft-server-manager.md). Shared types only
// — no Node/Electron imports, safe for the renderer. The metadata fetch, download/verification,
// Java detection and process lifecycle all live in src/core/minecraft/*, which this file's
// interfaces describe the shape of without depending on any of it.
//
// SCOPE, STATED PLAINLY: this manages a server that runs ON THE MACHINE THE SHELL IS RUNNING ON
// (this desktop, or the Server Edition host) — a real `java -jar server.jar` child process, tied
// to that shell's own lifetime. It does not reach a remote host over SSH the way the `dockerhost`/
// `proxmox` service kinds' address field anticipates; that remains a real, separate, unbuilt
// feature, and the endpoint field on `ServiceConnection` is untouched by this one.

/** One entry from Mojang's own version manifest. `type` is carried through rather than
 *  interpreted (release/snapshot/old_beta/old_alpha, or anything a future manifest adds) so the
 *  UI can show it honestly instead of silently dropping an unfamiliar value. */
export interface MinecraftVersionSummary {
  id: string
  type: string
}

/**
 * The full manifest, as the UI needs it. `latestRelease`/`latestSnapshot` are Mojang's own
 * pointer — never a guess derived from sorting `versions`, which is not documented as ordered —
 * so a version picker can default to "the current release" without hardcoding a version string
 * that goes stale the moment Mojang ships a new one. Both are `null` only when the manifest
 * itself carried no usable `latest` object; that is reported, never silently substituted.
 */
export interface MinecraftVersionList {
  versions: MinecraftVersionSummary[]
  latestRelease: string | null
  latestSnapshot: string | null
}

/**
 * Where one managed server instance currently stands. Every field is a fact re-derived from real
 * disk state, the real process table and a real Java probe each time `status()` is called — never
 * a cached guess. `phase` is the single thing a UI should switch on; everything else is detail.
 */
export type MinecraftServerPhase =
  /** No directory has been chosen for this node yet. */
  | 'unconfigured'
  /** A directory is set but nothing has been downloaded into it. */
  | 'not-installed'
  | 'downloading'
  /** The jar is present but `eula.txt` does not yet say `eula=true` — the user has not accepted
   *  Mojang's EULA. Nothing may start until they do, and nothing accepts it but them. */
  | 'needs-eula'
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  /** Something concrete went wrong — see `error`. Never used for "unknown". */
  | 'error'

export interface MinecraftServerStatus {
  id: string
  phase: MinecraftServerPhase
  dir: string | null
  versionId: string | null
  eulaAccepted: boolean
  /** Java actually detected on this machine right now — independent of what this version needs. */
  installedJavaMajor: number | null
  installedJavaPath: string | null
  /** null when the version's manifest doesn't state a requirement (older versions predate the
   *  field) — see JavaCompatibility in core/minecraft/version-resolve.ts for why that is not 0. */
  requiredJavaMajor: number | null
  javaOk: boolean
  /** Populated only when `javaOk` is false, or when there is nothing to check yet. */
  javaReason: string | null
  /** The exact failure, present only while `phase === 'error'`. Never a generic message. */
  error: string | null
  pid: number | null
  startedAt: number | null
  /**
   * Real download progress, honestly bounded by what Mojang's metadata actually states: the
   * per-version document does not always publish a `size`, so a percentage cannot always be
   * computed — measured directly against the live manifest, where it was absent for the current
   * release. `downloadedBytes` is always populated while downloading; `totalBytes` (and therefore
   * `downloadPercent`) is populated only when the HTTP response itself carried a `Content-Length`.
   * A UI showing neither total nor percent should render an indeterminate indicator plus the byte
   * count — never a fabricated percentage.
   */
  downloadedBytes: number | null
  totalBytes: number | null
  downloadPercent: number | null
}

export type MinecraftPropertyFieldKind = 'string' | 'boolean' | 'integer' | 'enum'

export interface MinecraftPropertyFieldSpec {
  key: string
  label: string
  kind: MinecraftPropertyFieldKind
  /** Only for kind:'enum'. */
  options?: readonly string[]
  /** Only for kind:'integer'. Inclusive. */
  min?: number
  max?: number
  help: string
}

/** The subset of server.properties the GUI renders a typed control for, in display order — see
 *  core/minecraft/properties.ts for the parser/serializer this describes the shape of. Shared
 *  (rather than core-only) because the renderer needs it to build the properties editor and the
 *  renderer may only ever import `@shared/*`, never `core/*` directly. */
export const MANAGED_PROPERTY_FIELDS: readonly MinecraftPropertyFieldSpec[] = [
  { key: 'motd', label: 'Message of the day', kind: 'string', help: 'Shown in the server list on the multiplayer screen.' },
  {
    key: 'gamemode',
    label: 'Default game mode',
    kind: 'enum',
    options: ['survival', 'creative', 'adventure', 'spectator'],
    help: 'Applied to a player the first time they join.'
  },
  {
    key: 'difficulty',
    label: 'Difficulty',
    kind: 'enum',
    options: ['peaceful', 'easy', 'normal', 'hard'],
    help: 'Peaceful disables hostile mobs and hunger.'
  },
  { key: 'hardcore', label: 'Hardcore', kind: 'boolean', help: 'A player is banned instead of respawning on death.' },
  { key: 'pvp', label: 'Player vs player', kind: 'boolean', help: 'Whether players can damage each other.' },
  { key: 'white-list', label: 'Whitelist enabled', kind: 'boolean', help: 'Only players on the whitelist may join.' },
  {
    key: 'online-mode',
    label: 'Online mode',
    kind: 'boolean',
    help: 'Verifies players against Mojang accounts. Turn off only for a fully offline/LAN server.'
  },
  { key: 'enable-command-block', label: 'Command blocks', kind: 'boolean', help: 'Whether command blocks are functional.' },
  { key: 'allow-nether', label: 'Allow the Nether', kind: 'boolean', help: '' },
  {
    key: 'allow-flight',
    label: 'Allow flight',
    kind: 'boolean',
    help: 'Without this, a flying survival player is kicked as cheating.'
  },
  {
    key: 'spawn-protection',
    label: 'Spawn protection radius',
    kind: 'integer',
    min: 0,
    max: 1000,
    help: 'Blocks around spawn only ops may edit. 0 disables it.'
  },
  { key: 'max-players', label: 'Max players', kind: 'integer', min: 1, max: 2000, help: '' },
  { key: 'view-distance', label: 'View distance (chunks)', kind: 'integer', min: 3, max: 32, help: '' },
  { key: 'simulation-distance', label: 'Simulation distance (chunks)', kind: 'integer', min: 3, max: 32, help: '' },
  {
    key: 'level-name',
    label: 'World folder name',
    kind: 'string',
    help: 'Renaming this points the server at a different (or new) world folder.'
  },
  { key: 'level-seed', label: 'World seed', kind: 'string', help: 'Only used the first time a world is generated.' }
] as const

export function minecraftFieldSpec(key: string): MinecraftPropertyFieldSpec | undefined {
  return MANAGED_PROPERTY_FIELDS.find((f) => f.key === key)
}

export interface MinecraftPlayerEntry {
  name: string
  uuid: string
}

export interface MinecraftBannedPlayerEntry extends MinecraftPlayerEntry {
  reason: string | null
  expires: string | null
}

/** Read from vanilla's own whitelist.json / ops.json / banned-players.json — see
 *  core/minecraft/players.ts for why these are read-only from this side; every mutation goes
 *  through `sendCommand` against the running server's console instead. */
export interface MinecraftPlayerLists {
  whitelist: MinecraftPlayerEntry[]
  ops: MinecraftPlayerEntry[]
  banned: MinecraftBannedPlayerEntry[]
}

export interface MinecraftCreateInput {
  /** The canvas node id this instance belongs to. One instance per node. */
  id: string
  /** Absolute local directory the server is installed into. Chosen via the native/in-app folder
   *  picker, never typed freehand into a trust-sensitive field. */
  dir: string
  versionId: string
}

export interface MinecraftConsoleLine {
  seq: number
  stream: 'stdout' | 'stderr'
  text: string
  at: number
}

/** One multiplexed broadcast channel, keyed by `id` like the Ollama chat stream — the console can
 *  produce many lines per second and a per-line IPC round trip per IPC.* constant would be its own
 *  kind of waste; a listener filters to the instance it owns. */
export type MinecraftEvent =
  | { kind: 'status'; id: string; status: MinecraftServerStatus }
  | { kind: 'console'; id: string; line: MinecraftConsoleLine }

export interface MinecraftApi {
  /** The real, current version manifest from Mojang — every version it publishes, release and
   *  snapshot alike, plus which ids currently count as "the release" and "the snapshot". Cached
   *  briefly in core; safe to call on every node mount. */
  versions(): Promise<MinecraftVersionList>
  status(id: string): Promise<MinecraftServerStatus>
  /**
   * Downloads the chosen version's server jar into `dir`, verifies its sha1 against the value
   * Mojang's own per-version metadata publishes, and reports Java compatibility. Never throws —
   * a failure is reported as `phase: 'error'` with `error` set, so the UI never needs try/catch to
   * render the honest outcome. Does NOT accept the EULA; see `acceptEula`.
   */
  create(input: MinecraftCreateInput): Promise<MinecraftServerStatus>
  /** The user's own explicit acceptance of Mojang's EULA (https://aka.ms/MinecraftEULA). This is
   *  the only call that may write `eula=true`; nothing in `create` ever does. */
  acceptEula(id: string): Promise<MinecraftServerStatus>
  start(id: string): Promise<MinecraftServerStatus>
  stop(id: string): Promise<MinecraftServerStatus>
  /** Writes a raw line to the running server's console (stdin). Resolves `false` when the server
   *  is not running rather than throwing — the UI already shows that in `status().phase`. */
  sendCommand(id: string, command: string): Promise<boolean>
  /** Forgets this instance's local record. `deleteFiles` also removes the server directory from
   *  disk — real, irreversible deletion. The caller is responsible for gating that behind the
   *  destructive-action confirmation; this call performs whatever it is asked to perform. */
  remove(id: string, deleteFiles: boolean): Promise<void>
  /** Console history already buffered, for a node that remounts after the stream has some. */
  recentConsole(id: string): Promise<MinecraftConsoleLine[]>
  /**
   * The instance's server.properties as a flat key/value map, or `null` when nothing has been
   * installed for this node yet (there is no file to read). Every key present in the real file is
   * returned, not only the ones the GUI renders a typed control for — see
   * `core/minecraft/properties.ts`'s `MANAGED_PROPERTY_FIELDS`.
   */
  readProperties(id: string): Promise<Record<string, string> | null>
  /**
   * Writes `updates` into server.properties, preserving every other line exactly as it was.
   * Refused (reported as `phase: 'error'`, never thrown) while the server is running — the file is
   * only read at startup, so a live edit would silently do nothing until a restart, and reporting
   * success would be a lie about what just happened.
   */
  writeProperties(id: string, updates: Record<string, string>): Promise<MinecraftServerStatus>
  /** The current whitelist/ops/ban lists straight from vanilla's own JSON files on disk. Always
   *  safe to call — an instance that has never run has none of these files, which reads as three
   *  empty lists rather than an error. */
  readPlayerLists(id: string): Promise<MinecraftPlayerLists>
  onEvent(listener: (event: MinecraftEvent) => void): () => void
}
