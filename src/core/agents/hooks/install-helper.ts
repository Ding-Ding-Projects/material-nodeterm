// The ONE implementation of the per-agent settings.json hook merge. Each agent's thin
// service calls these with its own config path, script filename, and event list — claude,
// gemini and grok do (grok also passing per-event matchers); codex writes its own hooks.json
// (see its note) and opencode ships a plugin, so neither routes through here. Behavior (ported from the original claude-hooks.ts):
//   - write the managed script for `agentId` to <userData>/agent-hooks/<scriptFileName>
//     (chmod 0o755, best-effort), then reference it as `sh "<scriptPath>"` from each event;
//   - idempotent re-install: drop any prior managed entry for that event (command includes
//     the `agent-hooks` path segment OR the legacy `claude-signals` marker) before pushing
//     the fresh one;
//   - preserve every other hook (other tools', other events);
//   - fail open for sessions, preserve user settings on errors. Only ENOENT creates a new
//     shared config; malformed/read-error/concurrently modified files are left untouched, and a
//     blank file is treated as {} and restored. Grok alone owns its config outright and can heal
//     a malformed copy.
import path from 'path'
import { homedir } from 'os'
import { readFileSync, writeFileSync, mkdirSync, chmodSync, rmSync } from 'fs'
import type { ManagedHookEvent } from '@shared/agents/hook-events'
import { renameAtomicSync, tempNameFor } from '../../fs-atomic'
import { buildManagedScript } from './managed-script'
import { parseSettings, updateSettingsFile, updateTextFile } from './settings-file'

type HookDef = { matcher?: string; hooks?: { type: string; command: string }[] }
type Settings = { hooks?: Record<string, HookDef[]>; [k: string]: unknown }

/** Public alias for the hook settings shape, shared by local + remote merge callers. */
export type HookSettings = Settings

/**
 * Publish a file nodeterm owns (a shim, a skill, our own hook config) by temp + rename, so a
 * running CLI never reads it half written. Not for the user's files: a rename replaces a symlink,
 * and those go through the guarded `updateTextFile` / `updateSettingsFile` transaction instead.
 */
export function writeManagedHookFileAtomic(
  target: string,
  data: string,
  publish: (tmp: string, target: string) => void = renameAtomicSync,
  mode?: number
): void {
  const tmp = tempNameFor(target)
  try {
    writeFileSync(tmp, data, { encoding: 'utf8', flag: 'wx', ...(mode === undefined ? {} : { mode }) })
    // Exact, not umask-filtered: the rename carries the temp's mode, so set it before publishing.
    if (mode !== undefined) chmodSync(tmp, mode)
    publish(tmp, target)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}

/**
 * ONE script location per MACHINE — `~/.nodeterm/agent-hooks/<agent>.sh` — not one per instance.
 *
 * `settings.json` is shared by every agent session on the machine, but the path used to come from
 * each instance's own `userDataDir`. So a second nodeterm (a Server Edition install, a dev build,
 * an E2E run started with `--data-dir` under a temp path) rewrote the hook to ITS copy, and when
 * that data dir later vanished the guarded command silently swallowed every event: hooks "worked"
 * and did nothing, on every session on the box, until something reinstalled (field report).
 *
 * Every instance now writes identical bytes to the same stable path — which is also where the SSH
 * remote installer already puts it (`$HOME/.nodeterm/agent-hooks/`), so local and remote agree.
 */
export function managedHookScriptPath(scriptFileName: string): string {
  return path.join(homedir(), '.nodeterm', 'agent-hooks', scriptFileName)
}

/** Write one stable, guarded hook target for any local agent installer. */
export function installManagedHookScript(agentId: string, scriptFileName: string): string | null {
  const scriptPath = managedHookScriptPath(scriptFileName)
  try {
    mkdirSync(path.dirname(scriptPath), { recursive: true })
    writeFileSync(scriptPath, buildManagedScript(agentId), 'utf8')
  } catch (e) {
    console.warn(`[agent-hooks] ${agentId} script write failed`, e)
    return null
  }
  try {
    chmodSync(scriptPath, 0o755)
  } catch {
    /* fail open */
  }
  return scriptPath
}

/**
 * The managed hook command: run our script, but ONLY if it is still on disk.
 *
 * The guard is not cosmetic. A bare `sh "<path>"` exits non-zero when the script is gone, and a
 * non-zero UserPromptSubmit hook BLOCKS the prompt — so one stale entry bricks every Claude
 * session on that machine ("cannot open …: No such file", nothing can be submitted) until the
 * user hand-edits settings.json. The entry goes stale in ordinary situations: the app is
 * uninstalled, its user-data dir is cleared, or the server edition ran with a `--data-dir` under
 * a temp path that later got cleaned (see the installHooks note in src/server/config.ts).
 *
 * Missing script → swallow stdin (hooks are fed JSON on stdin) and exit 0: the agent simply runs
 * without status, which is exactly what an uninstalled nodeterm should look like.
 *
 * Codex builds its own equivalent (`buildManagedCommand` in codex.ts) — its exact bytes are
 * hashed into config.toml's trust entries, so the two must stay separate.
 */
export function buildManagedHookCommand(scriptPath: string): string {
  // POSIX single-quote escape so $, `, " and \ in the path are taken literally.
  const q = `'${scriptPath.replaceAll("'", "'\\''")}'`
  return `if [ -r ${q} ]; then sh ${q}; else cat >/dev/null 2>&1 || :; fi`
}

// The marker identifying OUR entry: the `agent-hooks/<scriptFile>` (or, on win32,
// `agent-hooks\<scriptFile>`) tail of the managed command. A bare "agent-hooks" substring is NOT
// enough — other tools use the same dir name (e.g. `~/.someapp/agent-hooks/claude-hook.sh`), and
// matching them would delete a foreign app's hooks from any event we both subscribe to.
//
// The extracted marker is later matched with a plain `.includes()` against OTHER commands built
// the same way in this same process — i.e. through `scriptPathFor`'s `path.join`, which emits
// `\`-separated paths on win32. Normalizing the marker's separator to `/` here used to make that
// `.includes()` check compare a forward-slash marker against a backslash command on Windows,
// which never matches: a second `installGrokHooks()` call could never recognize its own prior
// entry, so installs piled up duplicates instead of replacing them, and `mergeManagedHook`'s sweep
// of no-longer-subscribed events could never find (or remove) a managed entry either. Keep the
// marker in whatever separator it was actually extracted with so the substring check matches
// what is actually on disk.
function managedMarkerFor(command: string): string {
  const m = command.match(/agent-hooks[\\/][^"'\s]+/)
  return m ? m[0] : 'agent-hooks'
}

/** A subscription's event name, whichever form it was declared in. */
const eventNameOf = (e: ManagedHookEvent): string => (typeof e === 'string' ? e : e.event)
/** The matcher to write for it — undefined for the plain string form, so nothing changes for the
 *  agents that never needed one (grok's tool events are the only case; see ManagedHookEvent). */
const matcherOf = (e: ManagedHookEvent): string | undefined => (typeof e === 'string' ? undefined : e.matcher)

/** One handler is ours: OUR script under `agent-hooks/` or the legacy `claude-signals` marker.
 *  A hand-edited handler with no string `command` is simply not ours, never a thrown install. */
const isManagedCommand = (command: unknown, marker: string): boolean =>
  typeof command === 'string' && (command.includes(marker) || command.includes('claude-signals'))

/** A definition holding at least one of our handlers. */
function isManaged(d: HookDef, marker: string): boolean {
  return !!d.hooks?.some((h) => isManagedCommand(h.command, marker))
}

/**
 * Drop OUR handlers out of a definition list, keeping everything else byte-for-byte.
 *
 * Handler-level, not definition-level: our own entry always holds exactly one handler, so for
 * anything we wrote the two are identical — but a user who hand-merged our command INTO their
 * own definition would otherwise lose their handler alongside ours. A definition left with no
 * handlers disappears; a definition holding none of ours is returned by identity.
 */
function stripManaged(defs: HookDef[], marker: string): HookDef[] {
  return defs.flatMap((d) => {
    if (!isManaged(d, marker)) return [d]
    const kept = (d.hooks ?? []).filter((h) => !isManagedCommand(h.command, marker))
    return kept.length ? [{ ...d, hooks: kept }] : []
  })
}

/**
 * Pure: make the config's managed hooks EXACTLY ours — our command on every event in `events`, and
 * no managed entry anywhere else.
 *
 * The second half is the repair. A managed entry is recognized by our own `agent-hooks/<agent>.sh`
 * tail, so it is ours (or another nodeterm instance's) by construction — never a foreign tool's.
 * Sweeping the events we DON'T subscribe to is what heals a settings.json two installers have
 * fought over: whoever wrote last used to leave the loser's command behind on every event its own
 * list lacked, and if the loser's script had since been deleted those events silently did nothing.
 * It also cleans up after ourselves when an event leaves the list between versions.
 */
export function mergeManagedHook(
  config: HookSettings,
  command: string,
  events: readonly ManagedHookEvent[]
): HookSettings {
  // A shape we cannot interpret is the user's data, not ours to normalize: throw, so the guarded
  // settings transaction leaves the file exactly as found (spreading a string `hooks` would
  // otherwise write it back as an object of single characters).
  if (config.hooks !== undefined) {
    if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) throw new Error('Invalid hooks')
    for (const defs of Object.values(config.hooks)) {
      if (!Array.isArray(defs)) continue
      for (const d of defs) {
        if (!d || typeof d !== 'object' || (d.hooks !== undefined &&
          (!Array.isArray(d.hooks) || d.hooks.some((h) => !h || typeof h !== 'object')))) throw new Error('Invalid hook handlers')
      }
    }
  }
  const marker = managedMarkerFor(command)
  const next: HookSettings = { ...config, hooks: { ...(config.hooks ?? {}) } }
  const definitionsAt = (ev: string): HookDef[] => {
    const defs = next.hooks![ev]
    if (defs !== undefined && !Array.isArray(defs)) throw new Error('Invalid hook definitions')
    return defs ?? []
  }
  for (const e of events) {
    const ev = eventNameOf(e)
    const matcher = matcherOf(e)
    const existing = stripManaged(definitionsAt(ev), marker)
    // Spread the matcher CONDITIONALLY: an explicit `matcher: undefined` would serialize as a
    // missing key here but still change the object shape snapshots compare. The test is
    // `!== undefined`, not truthiness — the type permits `matcher: ''`, and silently dropping an
    // empty matcher would emit a subscription that does not say what its declaration said.
    existing.push({ ...(matcher !== undefined ? { matcher } : {}), hooks: [{ type: 'command', command }] })
    next.hooks![ev] = existing
  }
  const managedEvents = new Set(events.map(eventNameOf))
  for (const ev of Object.keys(next.hooks!)) {
    if (managedEvents.has(ev)) continue
    const defs = next.hooks![ev]
    // A non-array on an event we do not subscribe to is a hand-edited value we cannot interpret:
    // leave it exactly as found rather than failing the whole install over it.
    if (!Array.isArray(defs) || !defs.some((d) => isManaged(d, marker))) continue
    const kept = stripManaged(defs, marker)
    if (kept.length === 0) delete next.hooks![ev]
    else next.hooks![ev] = kept
  }
  return next
}

export interface InstallHooksOptions {
  agentId: string
  scriptFileName: string
  configPath: string
  events: readonly ManagedHookEvent[]
  /** Set only when nodeterm owns the config file outright (Grok): a malformed copy is healed and
   *  the file is replaced by temp + rename. Shared settings (Claude, Gemini) go through the guarded
   *  settings transaction, which never replaces a file it could not read or parse. */
  atomicConfig?: boolean
}

export function installHooksInto(opts: InstallHooksOptions): void {
  const { agentId, scriptFileName, configPath, events, atomicConfig = false } = opts

  const sp = installManagedHookScript(agentId, scriptFileName)
  if (!sp) return

  const command = buildManagedHookCommand(sp)
  if (!atomicConfig) {
    // The user's shared settings.json: only ENOENT means "new file"; a blank file is restored;
    // malformed, unreadable or concurrently modified files are left untouched; a symlink and the
    // file's mode are kept.
    updateSettingsFile(configPath, (config) => mergeManagedHook(config as Settings, command, events))
    return
  }
  let config: Settings
  try {
    config = mergeManagedHook(JSON.parse(readFileSync(configPath, 'utf8')) as Settings, command, events)
  } catch {
    // This branch owns the entire config, including malformed hook shapes.
    config = mergeManagedHook({}, command, events)
  }
  try {
    mkdirSync(path.dirname(configPath), { recursive: true })
    writeManagedHookFileAtomic(configPath, JSON.stringify(config, null, 2))
  } catch (e) {
    console.warn(`[agent-hooks] ${agentId} install failed`, e)
  }
}

export interface RemoveHooksOptions {
  configPath: string
  events: readonly ManagedHookEvent[]
  /** Our script's file name — narrows the match so foreign agent-hooks entries survive. */
  scriptFileName: string
  /** Same meaning as `InstallHooksOptions.atomicConfig` (Grok's own file). */
  atomicConfig?: boolean
}

/** Drop our entries from the subscribed events. Mutates and returns `config`. */
function stripManagedEvents(config: Settings, events: readonly ManagedHookEvent[], markers: readonly string[]): Settings {
  if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) return config
  for (const e of events) {
    const ev = eventNameOf(e)
    const defs = config.hooks[ev]
    if (!Array.isArray(defs)) continue
    // Handler-level, like the install (`stripManaged`): a user's own handler that shares a
    // definition with ours survives the uninstall.
    const ours = (h: unknown): boolean => {
      const command = (h as { command?: unknown } | null)?.command
      return typeof command === 'string' && markers.some((marker) => command.includes(marker))
    }
    config.hooks[ev] = defs.flatMap((d) => {
      if (!d || !Array.isArray(d.hooks) || !d.hooks.some(ours)) return [d]
      const kept = d.hooks.filter((h) => !ours(h))
      return kept.length ? [{ ...d, hooks: kept }] : []
    })
    if (config.hooks[ev].length === 0) delete config.hooks[ev]
  }
  return config
}

export function removeHooksFrom(opts: RemoveHooksOptions): void {
  const { configPath, events, scriptFileName, atomicConfig = false } = opts
  // Match either separator: the command was built by `scriptPathFor`'s `path.join`, which emits
  // `\`-joined paths on win32 — a marker hardcoded to `/` alone never matches there (see the
  // `managedMarkerFor` note above for the identical failure this fix mirrors).
  const markers = [`agent-hooks/${scriptFileName}`, `agent-hooks\\${scriptFileName}`]
  if (!atomicConfig) {
    // The user's shared settings: the same guarded transaction as the install. A missing file
    // stays missing (there is nothing of ours to remove, and an uninstall must not create one);
    // a blank, malformed or unreadable file is left exactly as found.
    updateTextFile(configPath, (before) => {
      if (before === null || before.trim() === '') return null
      const config = parseSettings(before) as Settings
      const original = JSON.stringify(config)
      const next = stripManagedEvents(config, events, markers)
      return JSON.stringify(next) === original ? null : JSON.stringify(next, null, 2)
    })
    return
  }
  let config: Settings
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8')) as Settings
  } catch {
    return
  }
  if (!config || typeof config !== 'object') return
  const original = JSON.stringify(config)
  stripManagedEvents(config, events, markers)
  if (JSON.stringify(config) === original) return
  try {
    writeManagedHookFileAtomic(configPath, JSON.stringify(config, null, 2))
  } catch {
    /* fail open */
  }
}
