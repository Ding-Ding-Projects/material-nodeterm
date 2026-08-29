/**
 * A group frame bound to a WSL instance — the same shape as `GroupWorktree` in `./worktree.ts`:
 * the frame carries the binding, and every node created inside it inherits the distribution
 * (mirrored by `wslProfileIdFor`, which reuses the already-existing `wsl:<distribution>`
 * terminal-profile machinery in `src/core/windows-terminal-profiles.ts` — opening a terminal
 * "in" a distribution is nothing more than stamping that stable profile id on the new node).
 *
 * IMPORTANT — this is content, not authority. `.nodeterm/project.json` is git-shared, hostile
 * input (see `src/shared/node-exec.ts`'s header comment for the fuller version of this rule):
 * `distroName` says which distribution this frame WANTS to run in, and nothing here says the app
 * is allowed to sleep, wake or delete it. A cloned repository must never be able to make this
 * machine touch a real distribution.
 *
 * Ownership is therefore never read from this record. It comes from a durable, machine-local
 * record the core WSL service keeps at creation time (this app's own `src/core/wsl/`, out of
 * scope for this file) and is asked for fresh, by name, immediately before any destructive or
 * sleep/wake action — never inferred from a name, a prefix, or anything persisted here. This
 * mirrors `GroupWorktree.createdByApp`, whose own doc comment says the same thing: "UI provenance
 * only; never core deletion authority." A `wsl` binding does not even keep a local provenance
 * hint field, to make it impossible for a future edit to quietly start trusting one.
 */
export interface GroupWsl {
  /** Stable canvas-binding generation, so a rebind/relabel doesn't look like a fresh binding. */
  bindingId: string
  /** The WSL distribution this frame is bound to. Re-validate against the machine's actually
   *  enumerated distributions before using it for anything — see `revalidateWslBinding`. */
  distroName: string
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_DISTRO_NAME = 256

/**
 * Shape validation only — this says "a string that COULD be a WSL distribution name", not "a
 * distribution that exists" and never "a distribution this app may touch". Mirrors the rejections
 * `windows-terminal-profiles.ts` already enforces for `wsl:<distribution>` profile ids: empty,
 * outer whitespace, and control characters are all refused, because those are exactly the shapes
 * that would either mean nothing to `wsl.exe` or smuggle something through a shell/argv boundary.
 */
export function isSafeWslDistroName(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > MAX_DISTRO_NAME) return false
  if (value.trim() !== value) return false
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}

/** The stable terminal-profile id a distribution resolves to. Never build this string by hand at
 *  a call site — one spelling, here, so a future rename of the `wsl:` prefix has one place to
 *  change. */
export function wslProfileIdFor(distroName: string): string {
  return `wsl:${distroName}`
}

/**
 * Tolerant read of `data.wsl` off a node that may have come from a shared/hand-edited project
 * file, a peer canvas mutation, or an old build. Same discipline as `validKanban`: an unknown or
 * malformed shape degrades to `undefined` rather than throwing or being trusted as-is.
 */
export function sanitizeGroupWsl(value: unknown): GroupWsl | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  if (!isSafeWslDistroName(raw.distroName)) return undefined
  const bindingId = typeof raw.bindingId === 'string' && UUID_V4.test(raw.bindingId)
    ? raw.bindingId
    : undefined
  if (!bindingId) return undefined
  return { bindingId, distroName: raw.distroName }
}

/**
 * The mandatory re-validation step before a binding may be used for ANYTHING — opening a terminal
 * in it, showing its live state, or offering a destructive action. `enumeratedNames` must come
 * from a fresh, real enumeration of this machine's WSL distributions (never from the binding
 * itself, never cached indefinitely): a binding naming a distribution that no longer exists, or
 * that never existed here, is exactly as untrustworthy as a directly forged one.
 */
export function revalidateWslBinding(
  binding: GroupWsl | undefined,
  enumeratedNames: ReadonlySet<string>
): GroupWsl | undefined {
  if (!binding) return undefined
  if (!isSafeWslDistroName(binding.distroName)) return undefined
  if (!enumeratedNames.has(binding.distroName)) return undefined
  return binding
}

/**
 * Looks up whether THIS app's own durable record says it created `distroName`. Always an
 * injected function, never a literal boolean captured from persisted/shared data — see the file
 * header. `undefined`/unknown state must read as "not owned", the fail-closed direction: an
 * un-owned distribution can only be looked at, never touched.
 */
export type WslOwnershipLookup = (distroName: string) => boolean

/**
 * May this app offer to sleep/wake/delete the bound distribution right now? Requires ALL of:
 * the binding to shape-validate, the distribution to be freshly enumerated (still real, on this
 * machine), and the ownership lookup to say this app created it. Any missing piece refuses —
 * there is no "probably fine" path here, because the actions this gates are irreversible
 * (delete) or affect a live process (sleep) on a resource nodeterm did not create.
 */
export function canManageWslDistro(
  binding: GroupWsl | undefined,
  enumeratedNames: ReadonlySet<string>,
  ownedByApp: WslOwnershipLookup
): boolean {
  const revalidated = revalidateWslBinding(binding, enumeratedNames)
  if (!revalidated) return false
  return ownedByApp(revalidated.distroName)
}

/** Plain-language reason shown beside a disabled sleep/wake/delete affordance for a distribution
 *  this app did not create. Named here once so the chip and any future surface say the same
 *  thing. */
export const WSL_NOT_OWNED_HINT =
  "nodeterm didn't create this WSL instance, so it can't sleep, wake, or delete it from here."

/** Same idea, for a binding whose distribution no longer exists on this machine at all. */
export const WSL_GONE_HINT =
  'This WSL distribution is no longer registered on this machine.'
