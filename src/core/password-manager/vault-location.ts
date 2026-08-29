// Where a project's password-manager vault lives - and, in particular, where it lives for a
// project that has no folder to put it in.
//
// The original rule was one line: the vault is `<cwd>/.nodeterm/vault.json`, a git-shareable
// sibling of project.json. That is still true and unchanged for a folder project, and it is the
// better home when there is one - it travels with the repo, and a teammate who clones gets the
// vault with it.
//
// It also meant that an SSH project, a cwd-less canvas, and a project opened from a one-file save
// simply could not have a password manager at all: the panel said "Not available for this
// project" and there was nothing the user could do about it. That is what this fixes.
//
// A folder-less project keeps its vault in a WORKING COPY under the app's own data directory,
// which the one-file save (`core/project-archive.ts`) carries inside the project file the same way
// it carries a folder project's committed vault. That is the Word model the user asked for: the
// document is where the data lives, and while it is open there is a working copy beside the app.
//
// Two things this deliberately does NOT do:
//   · It does not mangle an unusable project id into a "safe" one. A mangled id can collide two
//     projects onto one vault, and a shared vault between two projects is a credential leak, not a
//     tidy fallback. An id that cannot be a path segment gets no vault and says so.
//   · It does not invent a vault for an id the workspace has never heard of. A relay tab is the
//     case that matters: its project lives on somebody else's machine, and its vault belongs
//     there too.

import path from 'path'

/** Under the app's data directory - never in a user folder, because a working copy is machine
 *  state and must not appear in anyone's repository. */
export const APP_VAULT_DIR = 'project-vaults'

/**
 * A project id may be written into `workspace.json` by hand, and it ends up as a directory name
 * here. Accept only the charset project ids are actually minted from (`freshProjectId`,
 * `derivedProjectId` - both base36/hex plus separators) and refuse everything else outright.
 *
 * `.` and `..` are refused by name as well as by charset: both pass a naive character check and
 * both escape or collapse the directory they are supposed to be.
 */
export function isUsableVaultSegment(projectId: string): boolean {
  if (!projectId || projectId.length > 128) return false
  if (projectId === '.' || projectId === '..') return false
  return /^[A-Za-z0-9._-]+$/.test(projectId)
}

/**
 * The working-copy vault root for a folder-less project, or `undefined` when the id cannot safely
 * name a directory.
 *
 * Returns a ROOT rather than a file: `VaultStore` appends `.nodeterm/vault.json` to whatever root
 * it is given, so a folder project and a folder-less one differ only in which root they name and
 * share every byte of the store, the crypto and the cross-process locking.
 */
export function appVaultRootFor(userDataDir: string, projectId: string): string | undefined {
  if (!isUsableVaultSegment(projectId)) return undefined
  return path.join(userDataDir, APP_VAULT_DIR, projectId)
}

export interface VaultRootInput {
  projectId: string
  /** The project's own folder, when it has one. */
  cwd?: string
  userDataDir: string
  /** False for a project this workspace does not hold - a relay tab, or an id from nowhere. */
  known: boolean
}

/**
 * The one decision both shells make: which root this project's vault lives under, or `undefined`
 * for "this project cannot have one" (which the handlers report as `unsupported`, exactly as they
 * always did for a folder-less project).
 *
 * A folder wins whenever there is one, including for a project that was opened from a one-file
 * save into a real directory - its vault belongs beside its project.json, where a commit will
 * carry it to the rest of the team.
 */
export function vaultRootFor(input: VaultRootInput): string | undefined {
  if (input.cwd) return input.cwd
  if (!input.known) return undefined
  return appVaultRootFor(input.userDataDir, input.projectId)
}
